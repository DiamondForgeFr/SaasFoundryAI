import { Client, isFullPage } from '@notionhq/client'

import { EpicSpec, FrSpec, PageContent, PageRef, RawContent, SrsAdapter } from '../../builders/srs/types'
import { buildEpicPageBlocks, buildFrPageBlocks } from './srs.blocks'

export interface NotionSrsAdapterOptions {
  apiToken: string
  notionVersion?: string
  client?: Client
}

type BlocksChildrenListResponse = Awaited<ReturnType<Client['blocks']['children']['list']>>
type BlockResult = BlocksChildrenListResponse['results'][number]
type RawBlock = RawContent['blocks'][number]

export class NotionSrsAdapter implements SrsAdapter {
  private readonly client: Client

  constructor(options: NotionSrsAdapterOptions) {
    if (!options.apiToken && !options.client) {
      throw new Error('NotionSrsAdapter: apiToken is required')
    }
    this.client =
      options.client ??
      new Client({
        auth: options.apiToken,
        notionVersion: options.notionVersion
      })
  }

  async init(): Promise<void> {
    try {
      await this.client.users.me({})
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`NotionSrsAdapter: token validation failed — ${message}`)
    }
  }

  async createEpicPage(spec: EpicSpec): Promise<PageRef> {
    const response = await this.client.pages.create({
      parent: { page_id: spec.parentPageId },
      properties: { title: { title: [{ type: 'text', text: { content: spec.title } }] } },
      children: buildEpicPageBlocks(spec)
    })
    return { id: response.id, url: isFullPage(response) ? response.url : '', title: spec.title }
  }

  async createFrPage(spec: FrSpec): Promise<PageRef> {
    const title = `${spec.fr.id} — ${spec.fr.title}`
    const response = await this.client.pages.create({
      parent: { page_id: spec.parentEpicPageId },
      properties: { title: { title: [{ type: 'text', text: { content: title } }] } },
      children: buildFrPageBlocks(spec)
    })
    return { id: response.id, url: isFullPage(response) ? response.url : '', title }
  }

  async updatePage(pageId: string, content: PageContent): Promise<void> {
    const blocks = renderPageContent(content)
    if (blocks.length === 0) return
    await this.client.blocks.children.append({ block_id: pageId, children: blocks })
  }

  async fetchPage(pageId: string): Promise<RawContent> {
    const [page, blocks] = await Promise.all([this.client.pages.retrieve({ page_id: pageId }), this.client.blocks.children.list({ block_id: pageId, page_size: 100 })])
    const url = isFullPage(page) ? page.url : ''
    const title = extractPageTitle(page)
    return { pageId, title, url, blocks: blocks.results.map(mapBlockToRaw) }
  }

  async listChildren(parentPageId: string): Promise<PageRef[]> {
    const blocks = await this.client.blocks.children.list({ block_id: parentPageId, page_size: 100 })
    const refs: PageRef[] = []
    for (const block of blocks.results) {
      if (!isChildPageBlock(block)) continue
      refs.push({ id: block.id, url: '', title: block.child_page.title })
    }
    return refs
  }
}

export function createNotionSrsAdapterFromEnv(): NotionSrsAdapter {
  const apiToken = process.env.NOTION_API_TOKEN
  if (!apiToken) {
    throw new Error('createNotionSrsAdapterFromEnv: NOTION_API_TOKEN is not set')
  }
  return new NotionSrsAdapter({
    apiToken,
    notionVersion: process.env.NOTION_API_VERSION
  })
}

type AnyBlockRequest = Parameters<Client['blocks']['children']['append']>[0]['children'][number]

function renderPageContent(content: PageContent): AnyBlockRequest[] {
  const blocks: AnyBlockRequest[] = []
  if (content.title) {
    blocks.push({ type: 'heading_1', heading_1: { rich_text: [{ type: 'text', text: { content: content.title } }] } })
  }
  for (const section of content.sections ?? []) {
    if (section.heading) {
      blocks.push({ type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: section.heading } }] } })
    }
    if (section.body) {
      blocks.push({ type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: section.body } }] } })
    }
  }
  return blocks
}

function extractPageTitle(page: Awaited<ReturnType<Client['pages']['retrieve']>>): string {
  if (!isFullPage(page)) return ''
  const title = page.properties['title'] ?? page.properties['Name']
  if (!title || title.type !== 'title') return ''
  return title.title.map((t) => (t.type === 'text' ? t.text.content : t.plain_text)).join('')
}

function isChildPageBlock(block: BlockResult): block is BlockResult & { type: 'child_page'; child_page: { title: string } } {
  return 'type' in block && block.type === 'child_page'
}

function mapBlockToRaw(block: BlockResult): RawBlock {
  if (!('type' in block)) return { kind: 'other', text: '' }
  switch (block.type) {
    case 'heading_1':
      return { kind: 'heading', text: extractRichText(block.heading_1.rich_text) }
    case 'heading_2':
      return { kind: 'heading', text: extractRichText(block.heading_2.rich_text) }
    case 'heading_3':
      return { kind: 'heading', text: extractRichText(block.heading_3.rich_text) }
    case 'paragraph':
      return { kind: 'paragraph', text: extractRichText(block.paragraph.rich_text) }
    case 'bulleted_list_item':
      return { kind: 'list', text: extractRichText(block.bulleted_list_item.rich_text) }
    case 'numbered_list_item':
      return { kind: 'list', text: extractRichText(block.numbered_list_item.rich_text) }
    case 'table':
      return { kind: 'table', text: '' }
    default:
      return { kind: 'other', text: '' }
  }
}

type RichTextResult = { type: string; plain_text?: string; text?: { content: string } }

function extractRichText(rich: RichTextResult[]): string {
  return rich.map((t) => t.plain_text ?? t.text?.content ?? '').join('')
}
