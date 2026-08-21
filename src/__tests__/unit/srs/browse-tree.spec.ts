import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EpicSpec, FrSpec, PageContent, PageRef, RawContent, ResolvedParent, SrsAdapter } from '../../../builders/srs/types'
import { registerSrsBackend, unregisterSrsBackend } from '../../../srs'
import { runBrowseTree } from '../../../srs/bin/browse-tree'

class StubAdapter implements SrsAdapter {
  listed: string[] = []
  constructor(private readonly children: PageRef[] = []) {}
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
    return { pageId, title: '', url: '', blocks: [] }
  }
  async listChildren(parentPageId: string): Promise<PageRef[]> {
    this.listed.push(parentPageId)
    return this.children
  }
  async move(pageId: string, newParentPageId: string): Promise<void> {
    void pageId
    void newParentPageId
  }
}

describe('runBrowseTree', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-srs-browse-'))
  })

  afterEach(() => {
    unregisterSrsBackend('browse-stub')
    rmSync(tmp, { recursive: true, force: true })
  })

  const writeManifest = (body: unknown): string => {
    const p = join(tmp, '.saasfoundry.json')
    writeFileSync(p, JSON.stringify(body))
    return p
  }

  it('returns 0 and prints JSON list of children on success', async () => {
    const adapter = new StubAdapter([
      { id: 'child-1', url: 'https://notion.so/child-1', title: 'Child 1' },
      { id: 'child-2', url: 'https://notion.so/child-2', title: 'Child 2' }
    ])
    registerSrsBackend('browse-stub', () => adapter)
    const stdout: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })

    const manifestPath = writeManifest({ tools: { srs: { backend: 'browse-stub' } } })
    const code = await runBrowseTree({ parentId: 'parent-X', manifestPath })

    expect(code).toBe(0)
    expect(adapter.listed).toEqual(['parent-X'])
    const body = JSON.parse(stdout.join(''))
    expect(body).toEqual({
      parentId: 'parent-X',
      children: [
        { id: 'child-1', url: 'https://notion.so/child-1', title: 'Child 1' },
        { id: 'child-2', url: 'https://notion.so/child-2', title: 'Child 2' }
      ]
    })
  })

  it('returns 2 when parentId is empty', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: { srs: { backend: 'browse-stub' } } })
    const code = await runBrowseTree({ parentId: '', manifestPath })
    expect(code).toBe(2)
  })

  it('returns 2 when parentId is just whitespace', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: { srs: { backend: 'browse-stub' } } })
    const code = await runBrowseTree({ parentId: '   ', manifestPath })
    expect(code).toBe(2)
  })

  it('returns 3 when tools.srs.backend is missing', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: {} })
    const code = await runBrowseTree({ parentId: 'parent-X', manifestPath })
    expect(code).toBe(3)
  })

  it('returns 4 when the backend key is unknown', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: { srs: { backend: 'nope' } } })
    const code = await runBrowseTree({ parentId: 'parent-X', manifestPath })
    expect(code).toBe(4)
  })

  it('returns 5 when the adapter throws at runtime', async () => {
    class ExplodingAdapter extends StubAdapter {
      async listChildren(): Promise<PageRef[]> {
        throw new Error('notion unreachable')
      }
    }
    registerSrsBackend('browse-stub', () => new ExplodingAdapter())
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: { srs: { backend: 'browse-stub' } } })
    const code = await runBrowseTree({ parentId: 'parent-X', manifestPath })
    expect(code).toBe(5)
  })

  it('returns 2 when the manifest file is missing / unparseable', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const code = await runBrowseTree({ parentId: 'parent-X', manifestPath: join(tmp, 'does-not-exist.json') })
    expect(code).toBe(2)
  })
})
