import type { Client } from '@notionhq/client'

import { NotionSrsAdapter } from '../../../../tools/notion/srs.adapter'

const text = (content: string) => [{ type: 'text', plain_text: content, text: { content } }]
const h2 = (id: string, content: string) => ({ id, object: 'block', type: 'heading_2', heading_2: { rich_text: text(content) } })
const p = (id: string, content: string) => ({ id, object: 'block', type: 'paragraph', paragraph: { rich_text: text(content) } })
const li = (id: string, content: string) => ({ id, object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: text(content) } })
const table = (id: string, width: number) => ({ id, object: 'block', type: 'table', table: { table_width: width, has_column_header: true } })
const row = (id: string, cells: string[]) => ({ id, object: 'block', type: 'table_row', table_row: { cells: cells.map(text) } })

/** A Notion client serving fixed children per block id, recording appends and deletions. */
function fakeClient(children: Record<string, unknown[]>) {
  const appends: Array<Record<string, unknown>> = []
  const deletes: string[] = []
  const client = {
    blocks: {
      children: {
        list: async ({ block_id }: { block_id: string }) => ({ results: children[block_id] ?? [], next_cursor: null, has_more: false }),
        append: async (args: Record<string, unknown>) => {
          appends.push(args)
          return { results: [] }
        }
      },
      delete: async ({ block_id }: { block_id: string }) => {
        deletes.push(block_id)
        return {}
      }
    }
  }
  return { adapter: new NotionSrsAdapter({ apiToken: 'secret', client: client as unknown as Client }), appends, deletes }
}

const featurePage = [
  h2('b-scope', 'Scope'),
  p('b-scope-text', 'Live meetings.'),
  h2('b-versions', 'Versions'),
  p('b-versions-intro', 'Each version below holds the FRs that belong to it.'),
  li('b-v0', 'v0 — Bootstrap'),
  h2('b-trace', 'Traceability'),
  h2('b-ur', 'User Requirements (UR)'),
  table('t-ur', 4),
  h2('b-ds', 'Design Specifications (DS)'),
  p('b-ds-empty', 'No design specifications yet.')
]

// #899, #900 — an existing feature could only be appended to at the end of its page
describe('NotionSrsAdapter.extendSections', () => {
  it('adds a version right after the last one listed, and repeats none', async () => {
    const { adapter, appends } = fakeClient({ page: featurePage })

    const outcomes = await adapter.extendSections('page', [{ kind: 'list-items', heading: 'Versions', items: ['v0 — Bootstrap', 'v1 — Topics'] }])

    expect(outcomes).toEqual(['extended'])
    expect(appends).toHaveLength(1)
    expect(appends[0]).toMatchObject({ block_id: 'page', position: { type: 'after_block', after_block: { id: 'b-v0' } } })
    expect(JSON.stringify(appends[0].children)).toContain('v1 — Topics')
    expect(JSON.stringify(appends[0].children)).not.toContain('v0 — Bootstrap')
  })

  it('reports a list already holding every item as unchanged', async () => {
    const { adapter, appends } = fakeClient({ page: featurePage })

    await expect(adapter.extendSections('page', [{ kind: 'list-items', heading: 'Versions', items: ['v0 — Bootstrap'] }])).resolves.toEqual(['unchanged'])
    expect(appends).toEqual([])
  })

  it('creates a missing Versions section right before Traceability', async () => {
    const page = featurePage.filter((block) => !['b-versions', 'b-versions-intro', 'b-v0'].includes(block.id))
    const { adapter, appends } = fakeClient({ page })

    const outcomes = await adapter.extendSections('page', [{ kind: 'list-items', heading: 'Versions', items: ['v1 — Topics'], createBefore: 'Traceability', intro: 'Each version below…' }])

    expect(outcomes).toEqual(['extended'])
    expect(appends[0]).toMatchObject({ position: { type: 'after_block', after_block: { id: 'b-scope-text' } } })
    expect(JSON.stringify(appends[0].children)).toMatch(/Versions[\s\S]*Each version below…[\s\S]*v1 — Topics/)
  })

  it("appends rows to the section's table in the layout of its width, skipping known ids", async () => {
    const { adapter, appends } = fakeClient({ page: featurePage, 't-ur': [row('r-h', ['ID', 'Requirement', 'Priority', 'Related FR']), row('r-1', ['UR-1', 'Log in', 'P1', 'FR-1'])] })

    const outcomes = await adapter.extendSections('page', [
      {
        kind: 'table-rows',
        heading: 'User Requirements (UR)',
        layouts: [
          {
            header: ['ID', 'Requirement', 'Version', 'Priority', 'Related FR'],
            rows: [
              ['UR-1', 'Log in', 'v1', 'P1', 'FR-1'],
              ['UR-2', 'See topics', 'v1', 'P2', 'FR-2']
            ]
          },
          {
            header: ['ID', 'Requirement', 'Priority', 'Related FR'],
            rows: [
              ['UR-1', 'Log in', 'P1', 'FR-1'],
              ['UR-2', 'See topics', 'P2', 'FR-2']
            ]
          }
        ]
      }
    ])

    expect(outcomes).toEqual(['extended'])
    expect(appends).toEqual([{ block_id: 't-ur', children: [expect.objectContaining({ type: 'table_row' })] }])
    expect(JSON.stringify(appends[0].children)).toContain('UR-2')
    expect(JSON.stringify(appends[0].children)).not.toContain('UR-1')
  })

  it('replaces a "No … yet." placeholder with a table of the first layout', async () => {
    const { adapter, appends, deletes } = fakeClient({ page: featurePage })

    const outcomes = await adapter.extendSections('page', [
      {
        kind: 'table-rows',
        heading: 'Design Specifications (DS)',
        layouts: [{ header: ['ID', 'Specification', 'Description', 'Related FR', 'Version'], rows: [['DS-1', 'Topic store', 'One row per topic', 'FR-2', 'v1']] }]
      }
    ])

    expect(outcomes).toEqual(['extended'])
    expect(appends[0]).toMatchObject({ block_id: 'page', position: { type: 'after_block', after_block: { id: 'b-ds-empty' } } })
    expect(JSON.stringify(appends[0].children)).toContain('"table_width":5')
    expect(deletes).toEqual(['b-ds-empty'])
  })

  // #917 — a version written with no change listed gains its first one in place of the placeholder
  it('replaces a "No … yet." placeholder with the list it gains', async () => {
    const versionPage = [h2('b-changes', 'What changed in this version'), p('b-changes-empty', 'No changes listed yet.'), h2('b-frs', 'Functional Requirements (FR)')]
    const { adapter, appends, deletes } = fakeClient({ version: versionPage })

    const [outcome] = await adapter.extendSections('version', [{ kind: 'list-items', heading: 'What changed in this version', items: ['Adds FR-1 — One'] }])

    expect(outcome).toBe('extended')
    expect(appends[0]).toMatchObject({ block_id: 'version', position: { type: 'after_block', after_block: { id: 'b-changes-empty' } } })
    expect(deletes).toEqual(['b-changes-empty'])
  })

  it('leaves unplaced a table of an unknown width, or a missing section', async () => {
    const { adapter, appends } = fakeClient({ page: featurePage })

    const outcomes = await adapter.extendSections('page', [
      { kind: 'table-rows', heading: 'User Requirements (UR)', layouts: [{ header: ['ID', 'Requirement', 'Version'], rows: [['UR-2', 'See topics', 'v1']] }] },
      { kind: 'table-rows', heading: 'Test Cases (TC)', layouts: [{ header: ['ID'], rows: [['TC-1']] }] },
      { kind: 'list-items', heading: 'Glossary', items: ['Topic'] }
    ])

    expect(outcomes).toEqual(['unplaced', 'unplaced', 'unplaced'])
    expect(appends).toEqual([])
  })
})
