import { EpicSpec, FrSpec, PageContent, PageRef, RawContent, ResolvedParent, SrsAdapter } from '../../../builders/srs/types'
import { bootstrapSrs } from '../../../runners/srs.runner'

interface RecordedCall {
  parentPageId: string
  title: string
  hasContent: boolean
}

class FakeSrsAdapter implements SrsAdapter {
  public initCalls = 0
  public resolveCalls: string[] = []
  public createCalls: RecordedCall[] = []

  constructor(private readonly overrides: { resolveImpl?: (input: string) => Promise<ResolvedParent>; createImpl?: (parentId: string, title: string) => Promise<PageRef> } = {}) {}

  async init(): Promise<void> {
    this.initCalls += 1
  }

  async resolveParent(input: string): Promise<ResolvedParent> {
    this.resolveCalls.push(input)
    if (this.overrides.resolveImpl) return this.overrides.resolveImpl(input)
    return { id: 'resolved_parent_id', name: 'Parent Page', url: 'https://notion.so/resolved' }
  }

  async createPage(parentPageId: string, title: string, content?: PageContent): Promise<PageRef> {
    this.createCalls.push({ parentPageId, title, hasContent: Boolean(content) })
    if (this.overrides.createImpl) return this.overrides.createImpl(parentPageId, title)
    const id = `${parentPageId}__${title.replace(/\s+/g, '_')}`
    return { id, url: `https://notion.so/${id}`, title }
  }

  async createEpicPage(spec: EpicSpec): Promise<PageRef> {
    return { id: 'epic', url: '', title: spec.title }
  }

  async createFrPage(spec: FrSpec): Promise<PageRef> {
    return { id: 'fr', url: '', title: spec.fr.title }
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
}

describe('bootstrapSrs', () => {
  it('runs init → resolveParent → create root and returns the root ref', async () => {
    const adapter = new FakeSrsAdapter()

    const result = await bootstrapSrs({ projectName: 'acme', parentInput: 'https://notion.so/parent', adapter })

    expect(adapter.initCalls).toBe(1)
    expect(adapter.resolveCalls).toEqual(['https://notion.so/parent'])
    expect(adapter.createCalls).toEqual([{ parentPageId: 'resolved_parent_id', title: 'acme-srs', hasContent: false }])

    expect(result.rootPage).toEqual({
      id: 'resolved_parent_id__acme-srs',
      url: 'https://notion.so/resolved_parent_id__acme-srs',
      name: 'acme-srs'
    })
  })

  it('creates only the root page — Epics land directly under it, no intermediate layer', async () => {
    const adapter = new FakeSrsAdapter({
      createImpl: async (parentId, title) => ({ id: `id-${title}`, url: `url-${title}`, title })
    })

    await bootstrapSrs({ projectName: 'demo', parentInput: 'abc', adapter })

    expect(adapter.createCalls).toHaveLength(1)
    expect(adapter.createCalls[0].parentPageId).toBe('resolved_parent_id')
    expect(adapter.createCalls[0].title).toBe('demo-srs')
  })

  it('propagates errors from resolveParent without calling createPage', async () => {
    const adapter = new FakeSrsAdapter({
      resolveImpl: async () => {
        throw new Error('no access')
      }
    })

    await expect(bootstrapSrs({ projectName: 'x', parentInput: 'bad', adapter })).rejects.toThrow(/no access/)
    expect(adapter.createCalls).toHaveLength(0)
  })

  it('propagates errors from the root page creation', async () => {
    const adapter = new FakeSrsAdapter({
      createImpl: async () => {
        throw new Error('create failed')
      }
    })

    await expect(bootstrapSrs({ projectName: 'x', parentInput: 'ok', adapter })).rejects.toThrow(/create failed/)
    expect(adapter.createCalls).toHaveLength(1)
  })
})
