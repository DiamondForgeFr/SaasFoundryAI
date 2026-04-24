import path from 'node:path'

import { Client, isFullPage } from '@notionhq/client'

import { renderEpicPage } from '../../builders/srs/templates/pages/epic.tpl'
import { renderFrPage } from '../../builders/srs/templates/pages/fr.tpl'
import { EpicSpec, FrSpec, PageContent, PageRef, RawContent, ResolvedParent, SrsAdapter } from '../../builders/srs/types'
import { loadEnvFile } from '../../utils/env-file'
import { renderPageContentToNotionBlocks } from './page-content.renderer'

export interface NotionSrsAdapterOptions {
  apiToken: string
  notionVersion?: string
  client?: Client
}

type BlocksChildrenListResponse = Awaited<ReturnType<Client['blocks']['children']['list']>>
type BlockResult = BlocksChildrenListResponse['results'][number]
type RawBlock = RawContent['blocks'][number]
type AnyBlockRequest = Parameters<Client['blocks']['children']['append']>[0]['children'][number]

const NOTION_MAX_CHILDREN_PER_REQUEST = 100

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

  async resolveParent(input: string): Promise<ResolvedParent> {
    const trimmed = input.trim()
    if (!trimmed) {
      throw new Error('NotionSrsAdapter.resolveParent: input is empty — paste the Notion page URL or page ID.')
    }

    const pageId = extractNotionPageId(trimmed)
    if (!pageId) {
      throw new Error(`NotionSrsAdapter.resolveParent: could not extract a Notion page ID from "${trimmed}". Paste the full URL (e.g. https://www.notion.so/My-page-<id>) or the 32-character ID.`)
    }

    try {
      const page = await this.client.pages.retrieve({ page_id: pageId })
      const title = extractPageTitle(page)
      const url = isFullPage(page) ? page.url : undefined
      return { id: pageId, name: title || pageId, url }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`NotionSrsAdapter.resolveParent: could not access page "${pageId}" — ${message}. Make sure the page is shared with your Notion integration.`)
    }
  }

  async createPage(parentPageId: string, title: string, content?: PageContent): Promise<PageRef> {
    const blocks = content ? renderPageContentToNotionBlocks({ blocks: content.blocks }) : []
    return this.createPageWithChildren({ page_id: parentPageId }, title, blocks)
  }

  async createEpicPage(spec: EpicSpec): Promise<PageRef> {
    const pageContent = renderEpicPage(spec)
    const children = renderPageContentToNotionBlocks({ blocks: pageContent.blocks })
    return this.createPageWithChildren({ page_id: spec.parentPageId }, spec.title, children)
  }

  async createFrPage(spec: FrSpec): Promise<PageRef> {
    if (!spec.parentEpicPageId) {
      throw new Error(`NotionSrsAdapter.createFrPage: FR "${spec.fr.id}" has no parentEpicPageId resolved. write-srs must resolve FrSpec.parentEpicId to a concrete page id before calling the adapter.`)
    }
    const pageContent = renderFrPage(spec)
    const title = pageContent.title ?? `${spec.fr.id} — ${spec.fr.title}`
    const children = renderPageContentToNotionBlocks({ blocks: pageContent.blocks })
    return this.createPageWithChildren({ page_id: spec.parentEpicPageId }, title, children)
  }

  async updatePage(pageId: string, content: PageContent): Promise<void> {
    const blocks = renderPageContentToNotionBlocks(content)
    if (blocks.length === 0) return
    await this.appendChildrenInChunks(pageId, blocks)
  }

  async fetchPage(pageId: string): Promise<RawContent> {
    const [page, allBlocks] = await Promise.all([this.client.pages.retrieve({ page_id: pageId }), this.listAllChildren(pageId)])
    const url = isFullPage(page) ? page.url : ''
    const title = extractPageTitle(page)
    return { pageId, title, url, blocks: allBlocks.map(mapBlockToRaw) }
  }

  async listChildren(parentPageId: string): Promise<PageRef[]> {
    const allBlocks = await this.listAllChildren(parentPageId)
    const refs: PageRef[] = []
    for (const block of allBlocks) {
      if (!isChildPageBlock(block)) continue
      refs.push({ id: block.id, url: '', title: block.child_page.title })
    }
    return refs
  }

  private async createPageWithChildren(parent: { page_id: string }, titleContent: string, children: AnyBlockRequest[]): Promise<PageRef> {
    const firstChunk = children.slice(0, NOTION_MAX_CHILDREN_PER_REQUEST)
    const rest = children.slice(NOTION_MAX_CHILDREN_PER_REQUEST)

    const response = await this.client.pages.create({
      parent,
      properties: { title: { title: [{ type: 'text', text: { content: titleContent } }] } },
      children: firstChunk
    })

    const pageId = response.id
    const url = isFullPage(response) ? response.url : ''

    if (rest.length > 0) {
      try {
        await this.appendChildrenInChunks(pageId, rest)
      } catch (error) {
        // Rollback: archive the partially-created page so we do not leave orphans.
        try {
          await this.client.pages.update({ page_id: pageId, archived: true })
        } catch {
          // best-effort; surface the original error
        }
        throw error
      }
    }

    return { id: pageId, url, title: titleContent }
  }

  private async appendChildrenInChunks(pageId: string, children: AnyBlockRequest[]): Promise<void> {
    for (let i = 0; i < children.length; i += NOTION_MAX_CHILDREN_PER_REQUEST) {
      const chunk = children.slice(i, i + NOTION_MAX_CHILDREN_PER_REQUEST)
      await this.client.blocks.children.append({ block_id: pageId, children: chunk })
    }
  }

  private async listAllChildren(pageId: string): Promise<BlockResult[]> {
    const all: BlockResult[] = []
    let cursor: string | undefined = undefined
    do {
      const response: BlocksChildrenListResponse = await this.client.blocks.children.list({
        block_id: pageId,
        page_size: NOTION_MAX_CHILDREN_PER_REQUEST,
        start_cursor: cursor
      })
      all.push(...response.results)
      cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined
    } while (cursor)
    return all
  }
}

export function createNotionSrsAdapterFromEnv(): NotionSrsAdapter {
  if (!process.env.NOTION_API_TOKEN) {
    loadEnvFile(path.join(process.cwd(), '.env'))
  }
  const apiToken = process.env.NOTION_API_TOKEN
  if (!apiToken) {
    throw new Error('createNotionSrsAdapterFromEnv: NOTION_API_TOKEN is not set (checked process.env and .env). Run `sf update` to persist it, or export it manually.')
  }
  return new NotionSrsAdapter({
    apiToken,
    notionVersion: process.env.NOTION_API_VERSION
  })
}

const NOTION_ID_LENGTH = 32
const NOTION_ID_REGEX = /[0-9a-f]{32}/i
// Only match a 32-hex id sitting at a natural URL boundary: preceded by
// start-of-string, `/`, or `-` (standard Notion slug-id pattern) and followed
// by end-of-string, `?`, `#`, or `/`. Rejects stray hex blobs buried in query
// strings or other URL positions to avoid resolving to the wrong page.
const ANCHORED_NOTION_ID_REGEX = /(?:^|[-/])([0-9a-f]{32})(?=$|[?#/])/gi

export function extractNotionPageId(input: string): string | null {
  const clean = input.trim().replace(/^<|>$/g, '')
  const direct = clean.replace(/-/g, '')
  if (direct.length === NOTION_ID_LENGTH && NOTION_ID_REGEX.test(direct)) {
    return formatNotionId(direct)
  }
  const matches = Array.from(clean.matchAll(ANCHORED_NOTION_ID_REGEX))
  if (matches.length === 1) return formatNotionId(matches[0][1])
  // Ambiguous (multiple candidates) or none — refuse to guess.
  return null
}

function formatNotionId(raw: string): string {
  const normalized = raw.toLowerCase()
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`
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
