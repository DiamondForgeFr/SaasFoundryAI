import type { BlockObjectRequest } from '@notionhq/client'

import { PageBlock, PageContent } from '../../builders/srs/types'

type ParagraphRequest = Extract<BlockObjectRequest, { paragraph: { rich_text: unknown } }>
type TableRequest = Extract<BlockObjectRequest, { table: { table_width: unknown } }>
type TableRowChild = TableRequest['table']['children'][number]
type RichTextItemRequest = ParagraphRequest['paragraph']['rich_text'][number]

function rt(text: string): RichTextItemRequest[] {
  if (!text) return []
  return [{ type: 'text', text: { content: text } }]
}

function headingRequest(level: 1 | 2 | 3, text: string): BlockObjectRequest {
  if (level === 1) return { type: 'heading_1', heading_1: { rich_text: rt(text) } }
  if (level === 2) return { type: 'heading_2', heading_2: { rich_text: rt(text) } }
  return { type: 'heading_3', heading_3: { rich_text: rt(text) } }
}

function tableRow(cells: string[]): TableRowChild {
  return { type: 'table_row', table_row: { cells: cells.map(rt) } }
}

function renderBlock(block: PageBlock): BlockObjectRequest | BlockObjectRequest[] {
  switch (block.kind) {
    case 'heading':
      return headingRequest(block.level, block.text)
    case 'paragraph':
      return { type: 'paragraph', paragraph: { rich_text: rt(block.text) } }
    case 'bulleted_list':
      return block.items.map(
        (item): BlockObjectRequest => ({
          type: 'bulleted_list_item',
          bulleted_list_item: { rich_text: rt(item) }
        })
      )
    case 'numbered_list':
      return block.items.map(
        (item): BlockObjectRequest => ({
          type: 'numbered_list_item',
          numbered_list_item: { rich_text: rt(item) }
        })
      )
    case 'table':
      return {
        type: 'table',
        table: {
          table_width: block.header.length,
          has_column_header: true,
          has_row_header: false,
          children: [tableRow(block.header), ...block.rows.map(tableRow)]
        }
      }
    case 'code':
      return {
        type: 'code',
        code: {
          rich_text: rt(block.text),
          language: (block.language ?? 'plain text') as never
        }
      }
    case 'divider':
      return { type: 'divider', divider: {} }
  }
}

export function renderPageContentToNotionBlocks(content: PageContent): BlockObjectRequest[] {
  const out: BlockObjectRequest[] = []
  if (content.title) {
    out.push(headingRequest(1, content.title))
  }
  for (const block of content.blocks) {
    const result = renderBlock(block)
    if (Array.isArray(result)) out.push(...result)
    else out.push(result)
  }
  return out
}
