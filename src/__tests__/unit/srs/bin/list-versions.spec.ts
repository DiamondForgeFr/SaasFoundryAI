import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EpicSpec, FrSpec, PageContent, PageRef, RawContent, ResolvedParent, SrsAdapter } from '../../../../builders/srs/types'
import { runListVersions, ListVersionsIO, ListVersionsOptions } from '../../../../srs/bin/list-versions'
import { registerSrsBackend, unregisterSrsBackend } from '../../../../srs'

/**
 * #570 — what `plan-milestone` needs in order to stop running with `srsVersions: []`.
 */

class TreeAdapter implements SrsAdapter {
  constructor(
    private readonly tree: Record<string, PageRef[]>,
    private readonly onList: ((id: string) => void) | null = null
  ) {}

  async init(): Promise<void> {}
  async resolveParent(input: string): Promise<ResolvedParent> {
    return { id: input, name: input, url: input }
  }
  async createPage(parentPageId: string, title: string): Promise<PageRef> {
    void parentPageId
    return { id: 'p', url: '', title }
  }
  async createEpicPage(spec: EpicSpec): Promise<PageRef> {
    return { id: 'e', url: '', title: spec.title }
  }
  async createFrPage(spec: FrSpec): Promise<PageRef> {
    return { id: 'f', url: '', title: spec.fr.title }
  }
  async updatePage(pageId: string, content: PageContent): Promise<void> {
    void pageId
    void content
  }
  async fetchPage(pageId: string): Promise<RawContent> {
    return { pageId, title: '', url: '', blocks: [] }
  }
  async listChildren(parentPageId: string): Promise<PageRef[]> {
    if (this.onList) this.onList(parentPageId)
    return this.tree[parentPageId] ?? []
  }
  async move(pageId: string, newParentPageId: string): Promise<void> {
    void pageId
    void newParentPageId
  }
}

interface TestIO extends ListVersionsIO {
  out: string[]
  err: string[]
}

function makeIO(): TestIO {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    stdout: (c: string) => {
      out.push(c)
    },
    stderr: (c: string) => {
      err.push(c)
    }
  }
}

describe('sf srs versions (#570)', () => {
  let tmp: string

  const options = (overrides: Partial<ListVersionsOptions> = {}): ListVersionsOptions => ({
    manifestPath: join(tmp, '.saasfoundry.json'),
    ...overrides
  })

  const writeManifest = (body: unknown): void => writeFileSync(join(tmp, '.saasfoundry.json'), JSON.stringify(body))

  const manifestWithRoot = { tools: { srs: { backend: 'tree', rootPage: { id: 'root' } } } }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-versions-'))
  })

  afterEach(() => {
    unregisterSrsBackend('tree')
    unregisterSrsBackend('explode')
    rmSync(tmp, { recursive: true, force: true })
  })

  it('emits one entry per version, carrying its feature and FR count', async () => {
    registerSrsBackend(
      'tree',
      () =>
        new TreeAdapter({
          root: [{ id: 'feat', url: 'https://x/feat', title: 'Réunion live' }],
          feat: [
            { id: 'v1', url: 'https://x/v1', title: 'v1 — MVP' },
            { id: 'v2', url: 'https://x/v2', title: 'v2 — Live' }
          ],
          v1: [
            { id: 'a', url: 'https://x/a', title: 'FR-LIVE-001: Transcription' },
            { id: 'b', url: 'https://x/b', title: 'FR-LIVE-002: Notes' }
          ],
          v2: [{ id: 'c', url: 'https://x/c', title: 'FR-LIVE-003: Résumé' }]
        })
    )
    writeManifest(manifestWithRoot)

    const io = makeIO()
    const code = await runListVersions(options(), io)

    expect(code).toBe(0)
    const parsed = JSON.parse(io.out.join('')) as { versions: Array<{ title: string; url: string; feature: string; frCount: number }> }
    expect(parsed.versions).toEqual([
      { title: 'v1 — MVP', url: 'https://x/v1', pageId: 'v1', feature: 'Réunion live', frCount: 2 },
      { title: 'v2 — Live', url: 'https://x/v2', pageId: 'v2', feature: 'Réunion live', frCount: 1 }
    ])
  })

  it('returns an empty list — not an error — for an SRS whose features hold FRs directly', async () => {
    // This project's own SRS is in exactly that shape: 8 features, no version page,
    // because `normalize --apply` has never run against it. Reporting no versions is
    // the truthful answer, and it must not read as a failure.
    registerSrsBackend(
      'tree',
      () =>
        new TreeAdapter({
          root: [{ id: 'feat', url: 'https://x/feat', title: 'EPIC-COMMANDS — CLI entry points' }],
          feat: [{ id: 'a', url: 'https://x/a', title: 'FR-CMD-001: sf new' }]
        })
    )
    writeManifest(manifestWithRoot)

    const io = makeIO()
    const code = await runListVersions(options(), io)

    expect(code).toBe(0)
    expect(JSON.parse(io.out.join(''))).toEqual({ versions: [] })
  })

  it('prefers --root-page over the manifest', async () => {
    const seen: string[] = []
    registerSrsBackend('tree', () => new TreeAdapter({ other: [] }, (id) => seen.push(id)))
    writeManifest(manifestWithRoot)

    await runListVersions(options({ rootPageId: 'other' }), makeIO())

    expect(seen[0]).toBe('other')
  })

  it('returns 2 when no root page can be resolved', async () => {
    registerSrsBackend('tree', () => new TreeAdapter({}))
    writeManifest({ tools: { srs: { backend: 'tree' } } })

    const io = makeIO()
    const code = await runListVersions(options(), io)

    expect(code).toBe(2)
    expect(io.err.join('')).toMatch(/--root-page is required/)
  })

  it('returns 3 when no backend is configured', async () => {
    writeManifest({ tools: { srs: { rootPage: { id: 'root' } } } })

    expect(await runListVersions(options(), makeIO())).toBe(3)
  })

  it('returns 5 when the adapter fails, so the caller can tell it apart from "no versions"', async () => {
    registerSrsBackend('explode', () => {
      throw new Error('notion unreachable')
    })
    writeManifest({ tools: { srs: { backend: 'explode', rootPage: { id: 'root' } } } })

    const io = makeIO()
    const code = await runListVersions(options(), io)

    expect(code).toBe(5)
    expect(io.err.join('')).toMatch(/notion unreachable/)
  })
})
