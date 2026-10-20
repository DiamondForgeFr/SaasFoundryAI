import type { Client } from '@notionhq/client'

/**
 * A Notion workspace in memory, behind the part of the SDK the SRS adapter calls. Pages and
 * blocks are stored the way the API returns them, so the adapter under test reads, writes and
 * lists exactly what it would on a real workspace — and a test can look at the result, count the
 * mutating calls, or make one of them fail. Nothing here ever reaches the network.
 */

type Json = Record<string, unknown>

interface StoredBlock {
  id: string
  object: 'block'
  type: string
  [key: string]: unknown
}

interface StoredPage {
  id: string
  title: string
  parent?: string
}

export type MutatingCall = 'pages.create' | 'pages.update' | 'pages.move' | 'blocks.update' | 'blocks.delete' | 'blocks.children.append'

/** A rich text as the API returns it, from one a request carried (or one it returned). */
function asResponseRichText(items: Array<Json>): Json[] {
  return items.map((item) => {
    const text = item.text as { content: string; link?: unknown } | undefined
    const content = text?.content ?? (item.plain_text as string) ?? ''
    return { ...item, type: item.type ?? 'text', plain_text: content, href: null, annotations: item.annotations ?? { bold: false }, text: { content, link: text?.link ?? null } }
  })
}

export class FakeNotion {
  private sequence = 0
  private readonly pages = new Map<string, StoredPage>()
  private readonly children = new Map<string, StoredBlock[]>()
  /** Every mutating call, in order: `blocks.update`, `blocks.children.append`… */
  readonly mutations: MutatingCall[] = []
  /** The arguments of every mutating call. */
  readonly calls: Array<{ method: MutatingCall; args: Json }> = []
  /** Returns an error to make that mutating call fail instead of being applied. */
  failWhen?: (method: MutatingCall, args: Json) => Error | undefined

  readonly client: Client

  constructor() {
    const mutate = async <T>(method: MutatingCall, args: Json, apply: () => T): Promise<T> => {
      const failure = this.failWhen?.(method, args)
      if (failure) throw failure
      this.mutations.push(method)
      this.calls.push({ method, args })
      return apply()
    }
    this.client = {
      users: { me: async () => ({ id: 'bot' }) },
      pages: {
        create: (args: Json) => mutate('pages.create', args, () => this.createPage(args)),
        retrieve: async ({ page_id }: { page_id: string }) => this.retrievePage(page_id),
        update: (args: Json) => mutate('pages.update', args, () => this.updatePage(args)),
        move: (args: Json) => mutate('pages.move', args, () => ({}))
      },
      blocks: {
        children: {
          list: async ({ block_id }: { block_id: string }) => ({ results: this.listChildren(block_id), next_cursor: null, has_more: false }),
          append: (args: Json) => mutate('blocks.children.append', args, () => this.append(args))
        },
        update: (args: Json) => mutate('blocks.update', args, () => this.updateBlock(args)),
        delete: (args: Json) => mutate('blocks.delete', args, () => this.deleteBlock(args.block_id as string))
      }
    } as unknown as Client
  }

  /** Forget the calls so far, so a test counts only what its subject does. */
  resetCalls(): void {
    this.mutations.length = 0
    this.calls.length = 0
  }

  /** The id of a page created under `parentId` (the root when omitted), as the adapter would create it. */
  addPage(title: string, parentId?: string): string {
    const id = this.newId('page')
    this.pages.set(id, { id, title, parent: parentId })
    this.children.set(id, this.children.get(id) ?? [])
    if (parentId) this.pushChild(parentId, { id, object: 'block', type: 'child_page', child_page: { title } })
    return id
  }

  /** The title of a page, as the tree walk reads it from its parent's `child_page` block. */
  titleOf(pageId: string): string {
    return this.pages.get(pageId)?.title ?? ''
  }

  /** The text of each row of the first table under `heading` on a page, header row first. */
  tableUnder(pageId: string, heading: string): string[][] {
    return this.rowsUnder(pageId, heading).map((row) => ((row.table_row as { cells: Json[][] }).cells ?? []).map((cell) => cell.map((item) => item.plain_text as string).join('')))
  }

  /** The id of the row of the table under `heading` whose first cell reads `key`. */
  rowIdOf(pageId: string, heading: string, key: string): string {
    const rows = this.rowsUnder(pageId, heading)
    const row = rows.find((candidate) => ((candidate.table_row as { cells: Json[][] }).cells[0] ?? []).map((item) => item.plain_text as string).join('') === key)
    if (!row) throw new Error(`no "${key}" row under "${heading}" on page ${pageId}`)
    return row.id
  }

  private rowsUnder(pageId: string, heading: string): StoredBlock[] {
    const blocks = this.children.get(pageId) ?? []
    const start = blocks.findIndex((block) => this.headingOf(block)?.trim().toLowerCase() === heading.trim().toLowerCase())
    if (start === -1) throw new Error(`no "${heading}" heading on page ${pageId}`)
    const table = blocks.slice(start + 1).find((block) => block.type === 'table' || this.headingOf(block) !== undefined)
    if (!table || table.type !== 'table') throw new Error(`no table under "${heading}" on page ${pageId}`)
    return this.children.get(table.id) ?? []
  }

  /** The text of the headings, paragraphs and bullets of a page, in order. */
  linesOf(pageId: string): string[] {
    return (this.children.get(pageId) ?? []).flatMap((block) => {
      const payload = block[block.type] as { rich_text?: Json[] } | undefined
      return payload?.rich_text ? [payload.rich_text.map((item) => item.plain_text as string).join('')] : []
    })
  }

  private newId(prefix: string): string {
    this.sequence += 1
    return `${prefix}-${this.sequence.toString().padStart(4, '0')}`
  }

  private pushChild(parentId: string, block: StoredBlock, after?: string): void {
    const list = this.children.get(parentId) ?? []
    const index = after ? list.findIndex((candidate) => candidate.id === after) : -1
    if (index === -1) list.push(block)
    else list.splice(index + 1, 0, block)
    this.children.set(parentId, list)
  }

  private headingOf(block: StoredBlock): string | undefined {
    if (!['heading_1', 'heading_2', 'heading_3'].includes(block.type)) return undefined
    const payload = block[block.type] as { rich_text: Json[] }
    return payload.rich_text.map((item) => item.plain_text as string).join('')
  }

  /** A request block, stored the way the API returns it (a table keeps its rows as its children). */
  private store(request: Json, parentId: string, after?: string): StoredBlock {
    const type = request.type as string
    const id = this.newId('block')
    const payload = request[type] as Json
    let block: StoredBlock
    if (type === 'table') {
      const { children, ...table } = payload as { children: Json[] } & Json
      block = { id, object: 'block', type, table }
      this.children.set(
        id,
        (children ?? []).map((row) => this.store(row, id))
      )
      this.pushChild(parentId, block, after)
      return block
    }
    if (type === 'table_row') {
      const cells = (payload.cells as Json[][]).map(asResponseRichText)
      return { id, object: 'block', type, table_row: { cells } }
    }
    if (payload && 'rich_text' in payload) block = { id, object: 'block', type, [type]: { ...payload, rich_text: asResponseRichText(payload.rich_text as Json[]) } }
    else block = { id, object: 'block', type, [type]: payload ?? {} }
    this.pushChild(parentId, block, after)
    return block
  }

  private createPage(args: Json): Json {
    const parent = (args.parent as { page_id: string }).page_id
    const titleProperty = (args.properties as { title: { title: Array<{ text: { content: string } }> } }).title
    const title = titleProperty.title.map((item) => item.text.content).join('')
    const id = this.addPage(title, parent)
    for (const child of (args.children as Json[] | undefined) ?? []) this.store(child, id)
    return { id, object: 'page', url: `https://notion.so/${id}`, properties: { title: { type: 'title', title: [{ plain_text: title }] } } }
  }

  private retrievePage(pageId: string): Json {
    const page = this.pages.get(pageId)
    if (!page) throw new Error(`fake notion: no page ${pageId}`)
    return {
      id: pageId,
      object: 'page',
      url: `https://notion.so/${pageId}`,
      properties: { title: { type: 'title', title: [{ type: 'text', plain_text: page.title, text: { content: page.title } }] } }
    }
  }

  private updatePage(args: Json): Json {
    const page = this.pages.get(args.page_id as string)
    if (!page) throw new Error(`fake notion: no page ${String(args.page_id)}`)
    const properties = (args.properties ?? {}) as Record<string, { title?: Array<{ text: { content: string } }> }>
    const title = Object.values(properties).find((property) => property.title)?.title
    if (title) {
      page.title = title.map((item) => item.text.content).join('')
      // The parent lists a child page by the title it has now
      for (const block of this.children.get(page.parent ?? '') ?? []) if (block.id === page.id) (block.child_page as { title: string }).title = page.title
    }
    return {}
  }

  private listChildren(blockId: string): StoredBlock[] {
    return this.children.get(blockId) ?? []
  }

  private append(args: Json): Json {
    const parentId = args.block_id as string
    const after = (args.position as { after_block?: { id: string } } | undefined)?.after_block?.id
    let anchor = after
    for (const child of args.children as Json[]) anchor = this.store(child, parentId, anchor).id
    return { results: [] }
  }

  private findBlock(blockId: string): { block: StoredBlock; siblings: StoredBlock[] } | undefined {
    for (const siblings of this.children.values()) {
      const block = siblings.find((candidate) => candidate.id === blockId)
      if (block) return { block, siblings }
    }
    return undefined
  }

  private updateBlock(args: Json): Json {
    const found = this.findBlock(args.block_id as string)
    if (!found) throw new Error(`fake notion: no block ${String(args.block_id)}`)
    const type = found.block.type
    const payload = args[type] as Json | undefined
    if (!payload) throw new Error(`fake notion: cannot update a ${type} block with ${Object.keys(args).join(', ')}`)
    if (type === 'table_row') found.block.table_row = { cells: (payload.cells as Json[][]).map(asResponseRichText) }
    else found.block[type] = { ...(found.block[type] as Json), ...payload, rich_text: asResponseRichText((payload.rich_text as Json[]) ?? []) }
    return {}
  }

  private deleteBlock(blockId: string): Json {
    const found = this.findBlock(blockId)
    if (found) found.siblings.splice(found.siblings.indexOf(found.block), 1)
    return {}
  }
}
