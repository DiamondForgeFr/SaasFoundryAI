import { PageContent } from '../../../../builders/srs/types'
import { renderFrPage } from '../../../../builders/srs/templates/pages/fr.tpl'
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

  // Notion refuses a text object over 2000 characters, and with it the whole page (#843)
  it('splits a long text into text objects of at most 2000 characters', () => {
    const text = 'x'.repeat(4500)
    const [block] = renderPageContentToNotionBlocks({ blocks: [{ kind: 'paragraph', text }] }) as unknown as [{ paragraph: { rich_text: { text: { content: string } }[] } }]

    const parts = block.paragraph.rich_text.map((item) => item.text.content)
    expect(parts.map((part) => part.length)).toEqual([2000, 2000, 500])
    expect(parts.join('')).toBe(text)
  })

  // #916 — an FR's acceptance criteria are joined into one table cell, which crossed the limit
  it('splits a table cell longer than 2000 characters, as an FR with many criteria produces', () => {
    const acceptanceCriteria = Array.from({ length: 12 }, (_, i) => `Criterion ${i + 1}: ${'the behaviour holds under every documented condition. '.repeat(4)}`)
    const blocks = renderPageContentToNotionBlocks(renderFrPage({ parentEpicPageId: 'version', fr: { id: 'FR-X-001', title: 'Long', acceptanceCriteria } })) as unknown as {
      type: string
      table?: { children: { table_row: { cells: { text: { content: string } }[][] } }[] }
    }[]

    const cells = blocks.flatMap((block) => block.table?.children ?? []).flatMap((row) => row.table_row.cells)
    const criteriaCell = cells.find((cell) =>
      cell
        .map((item) => item.text.content)
        .join('')
        .includes('Criterion 12')
    )
    expect(criteriaCell).toBeDefined()
    expect(criteriaCell!.length).toBeGreaterThan(1)
    for (const cell of cells) for (const item of cell) expect(item.text.content.length).toBeLessThanOrEqual(2000)
    expect(criteriaCell!.map((item) => item.text.content).join('')).toBe(acceptanceCriteria.map((criterion) => `• ${criterion}`).join('\n'))
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
