import { EpicSpec, FrSpec, PageContent, PageRef, RawContent, ResolvedParent, SrsAdapter } from '../../../builders/srs/types'
import { createSrsAdapter, listSrsBackends, registerSrsBackend, SrsConfigError, unregisterSrsBackend } from '../../../srs'

class StubSrsAdapter implements SrsAdapter {
  readonly calls: string[] = []

  async init(): Promise<void> {
    this.calls.push('init')
  }
  async resolveParent(input: string): Promise<ResolvedParent> {
    this.calls.push(`resolveParent:${input}`)
    return { id: 'parent-stub', name: 'Stub Parent' }
  }
  async createPage(parentPageId: string, title: string): Promise<PageRef> {
    this.calls.push(`createPage:${parentPageId}:${title}`)
    return { id: 'page-stub', url: '', title }
  }
  async createEpicPage(spec: EpicSpec): Promise<PageRef> {
    this.calls.push('createEpicPage')
    return { id: 'epic-stub', url: '', title: spec.title }
  }
  async createFrPage(spec: FrSpec): Promise<PageRef> {
    this.calls.push('createFrPage')
    return { id: 'fr-stub', url: '', title: spec.fr.title }
  }
  async updatePage(pageId: string, content: PageContent): Promise<void> {
    this.calls.push(`updatePage:${pageId}:${content.title ?? ''}`)
  }
  async fetchPage(pageId: string): Promise<RawContent> {
    this.calls.push('fetchPage')
    return { pageId, title: '', url: '', blocks: [] }
  }
  async listChildren(parentPageId: string): Promise<PageRef[]> {
    this.calls.push(`listChildren:${parentPageId}`)
    return []
  }
  async move(pageId: string, newParentPageId: string): Promise<void> {
    void pageId
    void newParentPageId
  }
}

describe('createSrsAdapter', () => {
  afterEach(() => {
    unregisterSrsBackend('stub')
  })

  it('returns the adapter produced by the registered backend factory', async () => {
    const stub = new StubSrsAdapter()
    registerSrsBackend('stub', () => stub)

    const adapter = await createSrsAdapter({ tools: { srs: { backend: 'stub' } } })

    expect(adapter).toBe(stub)
    await adapter.init()
    expect(stub.calls).toEqual(['init'])
  })

  it('awaits async factories', async () => {
    const stub = new StubSrsAdapter()
    registerSrsBackend('stub', async () => stub)

    const adapter = await createSrsAdapter({ tools: { srs: { backend: 'stub' } } })
    expect(adapter).toBe(stub)
  })

  it('throws SrsConfigError(code=missing) when tools.srs.backend is not set', async () => {
    await expect(createSrsAdapter({})).rejects.toMatchObject({
      name: 'SrsConfigError',
      code: 'missing'
    })
    await expect(createSrsAdapter({ tools: {} })).rejects.toMatchObject({ code: 'missing' })
    await expect(createSrsAdapter({ tools: { srs: {} } })).rejects.toMatchObject({ code: 'missing' })
  })

  it('throws SrsConfigError(code=unknown) with the registered-backends hint when the key is unregistered', async () => {
    const error = await createSrsAdapter({ tools: { srs: { backend: 'not-a-real-backend' } } }).catch((e) => e)
    expect(error).toBeInstanceOf(SrsConfigError)
    expect(error.code).toBe('unknown')
    expect(error.message).toContain('not-a-real-backend')
    expect(error.message).toContain('notion')
  })

  it('surfaces the built-in notion backend in listSrsBackends()', () => {
    expect(listSrsBackends()).toEqual(expect.arrayContaining(['notion']))
  })
})
