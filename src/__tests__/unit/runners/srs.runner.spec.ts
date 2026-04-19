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
  it('runs init → resolveParent → create root → create category and returns both refs', async () => {
    const adapter = new FakeSrsAdapter()

    const result = await bootstrapSrs({ projectName: 'acme', parentInput: 'https://notion.so/parent', adapter })

    expect(adapter.initCalls).toBe(1)
    expect(adapter.resolveCalls).toEqual(['https://notion.so/parent'])
    expect(adapter.createCalls).toEqual([
      { parentPageId: 'resolved_parent_id', title: 'acme — Project Overview', hasContent: false },
      { parentPageId: 'resolved_parent_id__acme_—_Project_Overview', title: 'User flows & Specifications', hasContent: false }
    ])

    expect(result.rootPage).toEqual({
      id: 'resolved_parent_id__acme_—_Project_Overview',
      url: 'https://notion.so/resolved_parent_id__acme_—_Project_Overview',
      name: 'acme — Project Overview'
    })
    expect(result.categoryPage).toEqual({
      id: 'resolved_parent_id__acme_—_Project_Overview__User_flows_&_Specifications',
      url: 'https://notion.so/resolved_parent_id__acme_—_Project_Overview__User_flows_&_Specifications',
      name: 'User flows & Specifications'
    })
  })

  it('creates the category under the root, not under the resolved parent', async () => {
    const adapter = new FakeSrsAdapter({
      createImpl: async (parentId, title) => ({ id: `id-${title}`, url: `url-${title}`, title })
    })

    await bootstrapSrs({ projectName: 'demo', parentInput: 'abc', adapter })

    const [rootCall, categoryCall] = adapter.createCalls
    expect(rootCall.parentPageId).toBe('resolved_parent_id')
    expect(categoryCall.parentPageId).toBe('id-demo — Project Overview')
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

  it('propagates errors from the root page creation without creating the category', async () => {
    let calls = 0
    const adapter = new FakeSrsAdapter({
      createImpl: async () => {
        calls += 1
        if (calls === 1) throw new Error('create failed')
        return { id: 'x', url: '', title: 'x' }
      }
    })

    await expect(bootstrapSrs({ projectName: 'x', parentInput: 'ok', adapter })).rejects.toThrow(/create failed/)
    expect(calls).toBe(1)
  })
})
