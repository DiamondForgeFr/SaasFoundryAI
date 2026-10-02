import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EpicSpec, FrSpec, PageContent, PageRef, RawContent, ResolvedParent, SrsAdapter } from '../../../builders/srs/types'
import { registerSrsBackend, unregisterSrsBackend } from '../../../srs'
import { runValidate } from '../../../srs/bin/validate'

class RecordingAdapter implements SrsAdapter {
  initCount = 0
  constructor(private readonly onInit: () => Promise<void> | void) {}
  async init(): Promise<void> {
    this.initCount += 1
    await this.onInit()
  }
  async resolveParent(input: string): Promise<ResolvedParent> {
    return { id: input, name: input }
  }
  async createPage(parentPageId: string, title: string): Promise<PageRef> {
    void parentPageId
    return { id: 'page', url: '', title }
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
    void parentPageId
    return []
  }
  async move(pageId: string, newParentPageId: string): Promise<void> {
    void pageId
    void newParentPageId
  }
}

describe('runValidate', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-srs-validate-'))
  })

  afterEach(() => {
    unregisterSrsBackend('recording')
    unregisterSrsBackend('exploding')
    rmSync(tmp, { recursive: true, force: true })
  })

  const writeManifest = (body: unknown): string => {
    const p = join(tmp, '.saasfoundry.json')
    writeFileSync(p, JSON.stringify(body))
    return p
  }

  it('returns 0 and calls adapter.init() on a valid manifest', async () => {
    const stdout: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })
    const adapter = new RecordingAdapter(async () => {})
    registerSrsBackend('recording', () => adapter)

    const manifestPath = writeManifest({ tools: { srs: { backend: 'recording' } } })
    const code = await runValidate({ manifestPath })

    expect(code).toBe(0)
    expect(adapter.initCount).toBe(1)
    expect(stdout.join('')).toContain('backend "recording" is reachable')
  })

  it('returns 3 when tools.srs.backend is missing', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: {} })

    const code = await runValidate({ manifestPath })
    expect(code).toBe(3)
  })

  it('returns 4 when the backend key is unknown', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: { srs: { backend: 'nope' } } })

    const code = await runValidate({ manifestPath })
    expect(code).toBe(4)
  })

  it('returns 5 when the adapter init() throws a non-config error', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    registerSrsBackend(
      'exploding',
      () =>
        new RecordingAdapter(async () => {
          throw new Error('auth rejected')
        })
    )
    const manifestPath = writeManifest({ tools: { srs: { backend: 'exploding' } } })

    const code = await runValidate({ manifestPath })
    expect(code).toBe(5)
  })

  it('returns 2 when the manifest file is missing / unparseable', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const code = await runValidate({ manifestPath: join(tmp, 'does-not-exist.json') })
    expect(code).toBe(2)
  })
})

// #877 — a spec passed where the manifest goes read as "tools.srs.backend is not set"
describe('runValidate with a DraftCandidate spec', () => {
  let tmp: string
  const out: string[] = []
  const err: string[] = []

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-srs-validate-spec-'))
    out.length = 0
    err.length = 0
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk))
      return true
    })
    jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err.push(String(chunk))
      return true
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
    rmSync(tmp, { recursive: true, force: true })
  })

  const spec = (candidates: unknown): string => {
    const path = join(tmp, 'spec.json')
    writeFileSync(path, JSON.stringify(candidates))
    return path
  }
  const feature = { kind: 'epic', confidence: 'high', epic: { id: 'auth', title: 'Auth', urs: [], frs: [] }, source: { kind: 'codebase' } }
  const version = { kind: 'epic', confidence: 'high', epic: { id: 'auth-v1', parentId: 'auth', title: 'v1', urs: [], frs: [] }, source: { kind: 'codebase' } }
  const fr = (parentEpicId: string) => ({ kind: 'fr', confidence: 'high', fr: { parentEpicId, fr: { id: 'FR-1', title: 'Sign in' } }, source: { kind: 'codebase' } })

  it('names a spec passed as the manifest instead of reporting a missing backend', async () => {
    const path = spec([feature])

    await expect(runValidate({ manifestPath: path })).resolves.toBe(2)
    expect(err.join('')).toContain('is a DraftCandidate spec, not a manifest')
    expect(err.join('')).toContain(`sf srs validate --spec ${path}`)
    expect(err.join('')).not.toContain('backend is not set')
  })

  it('accepts a spec write could apply, without a manifest or a backend', async () => {
    await expect(runValidate({ manifestPath: join(tmp, 'absent.json'), specPath: spec([feature, version, fr('auth-v1')]) })).resolves.toBe(0)
    expect(out.join('')).toContain('3 candidates (2 epic, 1 fr) can be written')
  })

  it.each([
    ['an FR whose parent is declared nowhere', [feature, fr('missing')], 'parentEpicId="missing"'],
    ['a version whose feature comes after it', [version, feature], 'parentId="auth"'],
    ['an FR attached to a feature instead of a version', [feature, fr('auth')], 'which is a feature, not a version'],
    ['a candidate missing its spec', [{ kind: 'fr', confidence: 'high', source: { kind: 'codebase' } }], 'the "fr" spec is missing']
  ])('rejects %s', async (_case, candidates, message) => {
    await expect(runValidate({ manifestPath: '.saasfoundry.json', specPath: spec(candidates) })).resolves.toBe(2)
    expect(err.join('')).toContain(message)
  })
})
