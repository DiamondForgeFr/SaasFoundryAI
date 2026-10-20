import type { Client } from '@notionhq/client'

import { NotionSrsAdapter } from '../../../../tools/notion/srs.adapter'

const text = (content: string) => [{ type: 'text', plain_text: content, href: null, annotations: { bold: false }, text: { content, link: null } }]
const h2 = (id: string, content: string) => ({ id, object: 'block', type: 'heading_2', heading_2: { rich_text: text(content) } })
const h3 = (id: string, content: string) => ({ id, object: 'block', type: 'heading_3', heading_3: { rich_text: text(content) } })
const divider = (id: string) => ({ id, object: 'block', type: 'divider', divider: {} })
const table = (id: string, width: number) => ({ id, object: 'block', type: 'table', table: { table_width: width, has_column_header: true } })
const row = (id: string, cells: string[]) => ({ id, object: 'block', type: 'table_row', table_row: { cells: cells.map(text) } })

interface UpdateCall {
  block_id: string
  [key: string]: unknown
}

/** A Notion client serving fixed children per block id and one page, recording every mutating call. */
function fakeClient(children: Record<string, unknown[]>, page: { title: string; propertyName?: string } = { title: 'FR-LIVE-001 — Notes' }) {
  const blockUpdates: UpdateCall[] = []
  const pageUpdates: Array<Record<string, unknown>> = []
  const mutations: string[] = []
  const client = {
    pages: {
      retrieve: async () => ({
        id: 'page',
        object: 'page',
        url: 'https://notion.so/page',
        properties: { [page.propertyName ?? 'title']: { type: 'title', title: text(page.title) } }
      }),
      update: async (args: Record<string, unknown>) => {
        mutations.push('pages.update')
        pageUpdates.push(args)
        return {}
      }
    },
    blocks: {
      children: {
        list: async ({ block_id }: { block_id: string }) => ({ results: children[block_id] ?? [], next_cursor: null, has_more: false })
      },
      update: async (args: UpdateCall) => {
        mutations.push('blocks.update')
        blockUpdates.push(args)
        return {}
      }
    }
  }
  return { adapter: new NotionSrsAdapter({ apiToken: 'secret', client: client as unknown as Client }), blockUpdates, pageUpdates, mutations }
}

/** The pages `sf srs write` produces for an FR: a Summary table, then a Field/Value table under the FR heading. */
const frPage = [h2('h-summary', 'Summary'), table('t-summary', 6), divider('d-1'), h2('h-detail', 'FR-LIVE-001 — Notes'), table('t-detail', 2)]
const frTables: Record<string, unknown[]> = {
  page: frPage,
  't-summary': [row('s-h', ['ID', 'Requirement', 'Priority', 'Related UR', 'Related DS', 'Related TC']), row('s-1', ['FR-LIVE-001', 'Notes', 'P2', 'UR-1', '—', '—'])],
  't-detail': [
    row('f-h', ['Field', 'Value']),
    row('f-id', ['ID', 'FR-LIVE-001']),
    row('f-title', ['Title', 'Notes']),
    row('f-priority', ['Priority', 'P2']),
    row('f-description', ['Description', 'Old description']),
    row('f-ac', ['Acceptance Criteria', '• First\n• Second'])
  ]
}

const contents = (call: UpdateCall): string[][] => ((call.table_row as { cells: Array<Array<{ text: { content: string } }>> }).cells ?? []).map((cell) => cell.map((item) => item.text.content))

// #945 — an FR amended after it was written is changed where it is listed, not appended to
describe('NotionSrsAdapter.updateSections', () => {
  describe('table-cells', () => {
    it('rewrites only the named cell of the row, and sends the other cells back as they were read', async () => {
      const { adapter, blockUpdates } = fakeClient(frTables)

      const outcomes = await adapter.updateSections('page', [{ kind: 'table-cells', heading: 'Summary', rowKey: 'FR-LIVE-001', cells: { Priority: 'P1' } }])

      expect(outcomes).toEqual([{ status: 'updated', before: { Priority: 'P2' } }])
      expect(blockUpdates).toHaveLength(1)
      expect(blockUpdates[0].block_id).toBe('s-1')
      expect(contents(blockUpdates[0])).toEqual([['FR-LIVE-001'], ['Notes'], ['P1'], ['UR-1'], ['—'], ['—']])
    })

    it('finds the Field/Value row of the detail table under the heading that names the FR', async () => {
      const { adapter, blockUpdates } = fakeClient(frTables)

      const [outcome] = await adapter.updateSections('page', [{ kind: 'table-cells', heading: 'FR-LIVE-001 — Notes', rowKey: 'Description', cells: { Value: 'New description' } }])

      expect(outcome).toEqual({ status: 'updated', before: { Value: 'Old description' } })
      expect(blockUpdates[0].block_id).toBe('f-description')
      expect(contents(blockUpdates[0])).toEqual([['Description'], ['New description']])
    })

    it('changes several cells of one row in a single write', async () => {
      const { adapter, blockUpdates } = fakeClient(frTables)

      const [outcome] = await adapter.updateSections('page', [{ kind: 'table-cells', heading: 'Summary', rowKey: 'FR-LIVE-001', cells: { Requirement: 'Live notes', Priority: 'P1' } }])

      expect(outcome).toEqual({ status: 'updated', before: { Requirement: 'Notes', Priority: 'P2' } })
      expect(blockUpdates).toHaveLength(1)
      expect(contents(blockUpdates[0])[1]).toEqual(['Live notes'])
      expect(contents(blockUpdates[0])[2]).toEqual(['P1'])
    })

    it('writes nothing for a cell that already holds the value, whatever the spacing around it', async () => {
      const { adapter, mutations } = fakeClient(frTables)

      const outcomes = await adapter.updateSections('page', [{ kind: 'table-cells', heading: 'Summary', rowKey: 'FR-LIVE-001', cells: { Priority: ' P2 ' } }])

      expect(outcomes).toEqual([{ status: 'unchanged', before: { Priority: 'P2' } }])
      expect(mutations).toEqual([])
    })

    it('plans the same outcome and makes no mutating call with dryRun', async () => {
      const { adapter, mutations } = fakeClient(frTables)

      const outcomes = await adapter.updateSections('page', [{ kind: 'table-cells', heading: 'Summary', rowKey: 'FR-LIVE-001', cells: { Priority: 'P1' } }], { dryRun: true })

      expect(outcomes).toEqual([{ status: 'updated', before: { Priority: 'P2' } }])
      expect(mutations).toEqual([])
    })

    it('keeps the multi-line text of a cell and splits what Notion would refuse at 2000 characters', async () => {
      const { adapter, blockUpdates } = fakeClient(frTables)
      const long = 'x'.repeat(2500)

      await adapter.updateSections('page', [{ kind: 'table-cells', heading: 'FR-LIVE-001 — Notes', rowKey: 'Acceptance Criteria', cells: { Value: `• First\n• ${long}` } }])

      const [, value] = (blockUpdates[0].table_row as { cells: Array<Array<{ text: { content: string } }>> }).cells
      expect(value.map((item) => item.text.content.length)).toEqual([2000, 510])
      expect(value[0].text.content.startsWith('• First\n• ')).toBe(true)
    })

    it('keeps the formatting and the link of the cells it does not change, and drops the fields only a response carries', async () => {
      const styled = [{ type: 'text', plain_text: 'P2', href: 'https://example.test', annotations: { bold: true }, text: { content: 'P2', link: { url: 'https://example.test' } } }]
      const tables = {
        ...frTables,
        't-summary': [row('s-h', ['ID', 'Requirement', 'Priority']), { id: 's-1', object: 'block', type: 'table_row', table_row: { cells: [text('FR-LIVE-001'), text('Notes'), styled] } }]
      }
      const { adapter, blockUpdates } = fakeClient(tables)

      await adapter.updateSections('page', [{ kind: 'table-cells', heading: 'Summary', rowKey: 'FR-LIVE-001', cells: { Requirement: 'Live notes' } }])

      const sent = (blockUpdates[0].table_row as { cells: Array<Array<Record<string, unknown>>> }).cells
      expect(sent[2]).toEqual([{ type: 'text', text: { content: 'P2', link: { url: 'https://example.test' } }, annotations: { bold: true } }])
      expect(sent[0][0]).not.toHaveProperty('plain_text')
      expect(sent[0][0]).not.toHaveProperty('href')
    })

    it('matches the column header whatever its case', async () => {
      const { adapter } = fakeClient(frTables)

      const [outcome] = await adapter.updateSections('page', [{ kind: 'table-cells', heading: 'summary', rowKey: 'FR-LIVE-001', cells: { priority: 'P1' } }], { dryRun: true })

      expect(outcome.status).toBe('updated')
    })

    it('finds the row of a feature table that has group header rows and a Version column', async () => {
      const tables = {
        page: [h2('h-frs', 'Functional Requirements (FR)'), table('t-frs', 6)],
        't-frs': [
          row('r-h', ['ID', 'Requirement', 'Version', 'Priority', 'Related UR', 'Related DS']),
          row('r-g', ['Capture', '', '', '', '', '']),
          row('r-1', ['FR-LIVE-001', 'Notes', 'v1 — Topics', 'P2', 'UR-1', '—']),
          row('r-2', ['FR-LIVE-002', 'Topics', 'v1 — Topics', 'P3', 'UR-1', '—'])
        ]
      }
      const { adapter, blockUpdates } = fakeClient(tables)

      const [outcome] = await adapter.updateSections('page', [
        { kind: 'table-cells', heading: 'Functional Requirements (FR)', rowKey: 'FR-LIVE-002', cells: { Requirement: 'Topic list', Priority: 'P1' } }
      ])

      expect(outcome).toEqual({ status: 'updated', before: { Requirement: 'Topics', Priority: 'P3' } })
      expect(blockUpdates[0].block_id).toBe('r-2')
      expect(contents(blockUpdates[0])).toEqual([['FR-LIVE-002'], ['Topic list'], ['v1 — Topics'], ['P1'], ['UR-1'], ['—']])
    })

    it('leaves unplaced, with the reason and without a write, what the page does not hold', async () => {
      const duplicated = {
        ...frTables,
        't-summary': [row('s-h', ['ID', 'Requirement', 'Priority']), row('s-1', ['FR-LIVE-001', 'Notes', 'P2']), row('s-2', ['FR-LIVE-001', 'Notes again', 'P2'])]
      }
      const empty = { page: [h2('h-summary', 'Summary'), { id: 'p', object: 'block', type: 'paragraph', paragraph: { rich_text: text('No requirements yet.') } }] }
      const { adapter, mutations } = fakeClient(frTables)
      const duplicatedClient = fakeClient(duplicated)
      const emptyClient = fakeClient(empty)

      const outcomes = await adapter.updateSections('page', [
        { kind: 'table-cells', heading: 'Glossary', rowKey: 'FR-LIVE-001', cells: { Priority: 'P1' } },
        { kind: 'table-cells', heading: 'Summary', rowKey: 'FR-LIVE-009', cells: { Priority: 'P1' } },
        { kind: 'table-cells', heading: 'Summary', rowKey: 'FR-LIVE-001', cells: { Complexity: 'low' } }
      ])
      const [ambiguous] = await duplicatedClient.adapter.updateSections('page', [{ kind: 'table-cells', heading: 'Summary', rowKey: 'FR-LIVE-001', cells: { Priority: 'P1' } }])
      const [noTable] = await emptyClient.adapter.updateSections('page', [{ kind: 'table-cells', heading: 'Summary', rowKey: 'FR-LIVE-001', cells: { Priority: 'P1' } }])

      expect(outcomes.map((outcome) => outcome.status)).toEqual(['unplaced', 'unplaced', 'unplaced'])
      expect(outcomes[0].reason).toContain('"Glossary"')
      expect(outcomes[1].reason).toContain('"FR-LIVE-009"')
      expect(outcomes[2].reason).toContain('no "Complexity" column')
      expect(outcomes[2].reason).toContain('ID, Requirement, Priority')
      expect(ambiguous.reason).toContain('2 rows start with "FR-LIVE-001"')
      expect(noTable.reason).toContain('no table under "Summary"')
      expect([...mutations, ...duplicatedClient.mutations, ...emptyClient.mutations]).toEqual([])
    })
  })

  describe('heading', () => {
    it('rewrites the heading in place and keeps its level', async () => {
      const { adapter, blockUpdates } = fakeClient({ page: [h3('h-detail', 'FR-LIVE-001 — Notes')] })

      const [outcome] = await adapter.updateSections('page', [{ kind: 'heading', heading: 'FR-LIVE-001 — Notes', text: 'FR-LIVE-001 — Live notes' }])

      expect(outcome).toEqual({ status: 'updated', before: 'FR-LIVE-001 — Notes' })
      expect(blockUpdates).toEqual([{ block_id: 'h-detail', heading_3: { rich_text: [{ type: 'text', text: { content: 'FR-LIVE-001 — Live notes' } }] } }])
    })

    it('writes nothing when the heading already reads as asked, or on a dry run, and leaves a missing one unplaced', async () => {
      const { adapter, mutations } = fakeClient(frTables)

      const outcomes = await adapter.updateSections(
        'page',
        [
          { kind: 'heading', heading: 'FR-LIVE-001 — Notes', text: 'FR-LIVE-001 — Notes' },
          { kind: 'heading', heading: 'FR-LIVE-001 — Notes', text: 'FR-LIVE-001 — Live notes' },
          { kind: 'heading', heading: 'FR-LIVE-404 — Gone', text: 'FR-LIVE-404 — Back' }
        ],
        { dryRun: true }
      )

      expect(outcomes.map((outcome) => outcome.status)).toEqual(['unchanged', 'updated', 'unplaced'])
      expect(mutations).toEqual([])
    })
  })

  describe('title', () => {
    it('renames the page through its title property', async () => {
      const { adapter, pageUpdates } = fakeClient({}, { title: 'FR-LIVE-001 — Notes' })

      const [outcome] = await adapter.updateSections('page', [{ kind: 'title', text: 'FR-LIVE-001 — Live notes' }])

      expect(outcome).toEqual({ status: 'updated', before: 'FR-LIVE-001 — Notes' })
      expect(pageUpdates).toEqual([{ page_id: 'page', properties: { title: { title: [{ type: 'text', text: { content: 'FR-LIVE-001 — Live notes' } }] } } }])
    })

    it('finds the title property by its type when it is not called "title"', async () => {
      const { adapter, pageUpdates } = fakeClient({}, { title: 'Old', propertyName: 'Name' })

      await adapter.updateSections('page', [{ kind: 'title', text: 'New' }])

      expect(Object.keys((pageUpdates[0].properties as Record<string, unknown>) ?? {})).toEqual(['Name'])
    })

    it('writes nothing for a title already in place, or on a dry run', async () => {
      const { adapter, mutations } = fakeClient({}, { title: 'FR-LIVE-001 — Notes' })

      const outcomes = await adapter.updateSections(
        'page',
        [
          { kind: 'title', text: 'FR-LIVE-001 — Notes' },
          { kind: 'title', text: 'Other' }
        ],
        { dryRun: true }
      )

      expect(outcomes.map((outcome) => outcome.status)).toEqual(['unchanged', 'updated'])
      expect(mutations).toEqual([])
    })
  })

  it('answers each update in order', async () => {
    const { adapter } = fakeClient(frTables)

    const outcomes = await adapter.updateSections('page', [
      { kind: 'table-cells', heading: 'Summary', rowKey: 'FR-LIVE-001', cells: { Priority: 'P2' } },
      { kind: 'table-cells', heading: 'Summary', rowKey: 'FR-LIVE-001', cells: { Priority: 'P1' } },
      { kind: 'table-cells', heading: 'Nowhere', rowKey: 'x', cells: { Priority: 'P1' } }
    ])

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['unchanged', 'updated', 'unplaced'])
  })
})
