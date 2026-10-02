import { PageContent, RawContent } from '../../builders/srs/types'

/** The page as a backend reads it back: what the Notion adapter's fetchPage returns. */
export function asRead(page: PageContent, pageId = 'page'): RawContent {
  const blocks: RawContent['blocks'] = []
  for (const block of page.blocks) {
    if (block.kind === 'heading') blocks.push({ kind: 'heading', text: block.text })
    else if (block.kind === 'paragraph') blocks.push({ kind: 'paragraph', text: block.text })
    else if (block.kind === 'bulleted_list' || block.kind === 'numbered_list') blocks.push(...block.items.map((item) => ({ kind: 'list' as const, text: item })))
    else if (block.kind === 'table') blocks.push({ kind: 'table', text: '', rows: [block.header, ...block.rows] })
    else blocks.push({ kind: 'other', text: '' })
  }
  return { pageId, title: page.title ?? '', url: `https://example.test/${pageId}`, blocks }
}
