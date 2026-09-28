import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EpicSpec, FrSpec, PageContent, PageRef, RawContent, ResolvedParent, SrsAdapter } from '../../../builders/srs/types'
import { registerSrsBackend, unregisterSrsBackend } from '../../../srs'
import { runDraftFromNotionPages } from '../../../srs/bin/draft-from-notion-pages'

class StubAdapter implements SrsAdapter {
  fetched: string[] = []
  constructor(private readonly byId: Record<string, RawContent> = {}) {}
  async init(): Promise<void> {}
  async resolveParent(input: string): Promise<ResolvedParent> {
    return { id: input, name: input }
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
    this.fetched.push(pageId)
    const hit = this.byId[pageId]
    if (hit) return hit
    return { pageId, title: `Stub ${pageId}`, url: `https://notion.so/${pageId}`, blocks: [] }
  }
  async listChildren(): Promise<PageRef[]> {
    return []
  }
  async move(pageId: string, newParentPageId: string): Promise<void> {
    void pageId
    void newParentPageId
  }
}

describe('runDraftFromNotionPages', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-srs-draft-'))
  })

  afterEach(() => {
    unregisterSrsBackend('draft-stub')
    rmSync(tmp, { recursive: true, force: true })
  })

  const writeManifest = (body: unknown): string => {
    const p = join(tmp, '.saasfoundry.json')
    writeFileSync(p, JSON.stringify(body))
    return p
  }

  it('fetches each ID and emits a RawContent list', async () => {
    const adapter = new StubAdapter({
      'id-1': { pageId: 'id-1', title: 'Existing Feature', url: 'https://notion.so/id-1', blocks: [{ kind: 'heading', text: 'Goal' }] }
    })
    registerSrsBackend('draft-stub', () => adapter)
    const stdout: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })

    const manifestPath = writeManifest({ tools: { srs: { backend: 'draft-stub' } } })
    const code = await runDraftFromNotionPages({ pageIds: ['id-1', 'id-2'], manifestPath })

    expect(code).toBe(0)
    expect(adapter.fetched).toEqual(['id-1', 'id-2'])
    const body = JSON.parse(stdout.join(''))
    expect(body.source).toBe('notion-pages')
    expect(body.pages).toHaveLength(2)
    expect(body.pages[0].pageId).toBe('id-1')
    expect(body.pages[0].title).toBe('Existing Feature')
    expect(body.pages[1].pageId).toBe('id-2')
  })

  it('ignores empty IDs inside the list', async () => {
    const adapter = new StubAdapter()
    registerSrsBackend('draft-stub', () => adapter)
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: { srs: { backend: 'draft-stub' } } })

    const code = await runDraftFromNotionPages({ pageIds: ['id-1', '', '  ', 'id-2'], manifestPath })

    expect(code).toBe(0)
    expect(adapter.fetched).toEqual(['id-1', 'id-2'])
  })

  it('returns 2 when pageIds is empty', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: { srs: { backend: 'draft-stub' } } })
    const code = await runDraftFromNotionPages({ pageIds: [], manifestPath })
    expect(code).toBe(2)
  })

  it('returns 2 when every pageId is blank / whitespace', async () => {
    const adapter = new StubAdapter()
    registerSrsBackend('draft-stub', () => adapter)
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: { srs: { backend: 'draft-stub' } } })
    const code = await runDraftFromNotionPages({ pageIds: ['', '   ', '\t'], manifestPath })
    expect(code).toBe(2)
    expect(adapter.fetched).toEqual([])
  })

  it('returns 3 when backend is missing', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: {} })
    const code = await runDraftFromNotionPages({ pageIds: ['id-1'], manifestPath })
    expect(code).toBe(3)
  })

  it('returns 5 when fetchPage throws', async () => {
    class ExplodingAdapter extends StubAdapter {
      async fetchPage(): Promise<RawContent> {
        throw new Error('404 page not found')
      }
    }
    registerSrsBackend('draft-stub', () => new ExplodingAdapter())
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: { srs: { backend: 'draft-stub' } } })
    const code = await runDraftFromNotionPages({ pageIds: ['id-1'], manifestPath })
    expect(code).toBe(5)
  })
})
