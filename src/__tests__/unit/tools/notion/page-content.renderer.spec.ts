import { PageContent } from '../../../../builders/srs/types'
import { renderPageContentToNotionBlocks } from '../../../../tools/notion/page-content.renderer'

describe('renderPageContentToNotionBlocks', () => {
  it('maps the optional title to a heading_1 block', () => {
    const content: PageContent = { title: 'Hello', blocks: [] }
    const out = renderPageContentToNotionBlocks(content)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: 'heading_1' })
  })

  it('maps each heading level to its Notion counterpart', () => {
    const content: PageContent = {
      blocks: [
        { kind: 'heading', level: 1, text: 'H1' },
        { kind: 'heading', level: 2, text: 'H2' },
        { kind: 'heading', level: 3, text: 'H3' }
      ]
    }
    expect(renderPageContentToNotionBlocks(content).map((b) => ('type' in b ? b.type : ''))).toEqual(['heading_1', 'heading_2', 'heading_3'])
  })

  it('maps paragraph and divider kinds directly', () => {
    const content: PageContent = {
      blocks: [{ kind: 'paragraph', text: 'hello' }, { kind: 'divider' }]
    }
    expect(renderPageContentToNotionBlocks(content).map((b) => ('type' in b ? b.type : ''))).toEqual(['paragraph', 'divider'])
  })

  it('expands bulleted_list into one bulleted_list_item per entry', () => {
    const content: PageContent = { blocks: [{ kind: 'bulleted_list', items: ['a', 'b', 'c'] }] }
    const out = renderPageContentToNotionBlocks(content)
    expect(out.map((b) => ('type' in b ? b.type : ''))).toEqual(['bulleted_list_item', 'bulleted_list_item', 'bulleted_list_item'])
  })

  it('expands numbered_list into one numbered_list_item per entry', () => {
    const content: PageContent = { blocks: [{ kind: 'numbered_list', items: ['x', 'y'] }] }
    const out = renderPageContentToNotionBlocks(content)
    expect(out.map((b) => ('type' in b ? b.type : ''))).toEqual(['numbered_list_item', 'numbered_list_item'])
  })

  it('maps table into a Notion table block with header row + data rows', () => {
    const content: PageContent = {
      blocks: [
        {
          kind: 'table',
          header: ['col1', 'col2'],
          rows: [
            ['a', 'b'],
            ['c', 'd']
          ]
        }
      ]
    }
    const out = renderPageContentToNotionBlocks(content)
    expect(out).toHaveLength(1)
    const tableBlock = out[0] as { type: 'table'; table: { table_width: number; has_column_header: boolean; children: unknown[] } }
    expect(tableBlock.type).toBe('table')
    expect(tableBlock.table.table_width).toBe(2)
    expect(tableBlock.table.has_column_header).toBe(true)
    expect(tableBlock.table.children).toHaveLength(3)
  })

  it('maps code block with default language when unset', () => {
    const content: PageContent = { blocks: [{ kind: 'code', text: 'console.log(1)' }] }
    const out = renderPageContentToNotionBlocks(content)
    const codeBlock = out[0] as { type: 'code'; code: { language: string } }
    expect(codeBlock.type).toBe('code')
    expect(codeBlock.code.language).toBe('plain text')
  })
})
