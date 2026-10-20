import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FrItem } from '../../../../builders/srs/types'
import { registerSrsBackend, unregisterSrsBackend } from '../../../../srs'
import { ApplyIO, runApplyUpdate } from '../../../../srs/bin/apply-srs-update'
import { ExistingSrsTicket } from '../../../../srs/spawn/reconciliation'
import { NotionSrsAdapter } from '../../../../tools/notion/srs.adapter'
import { FakeNotion } from '../../../helpers/fake-notion'

const BACKEND = 'update-fr-backend'
const VERSION_TITLE = 'v1 — Routing'
const FEATURE_TITLE = 'Agent execution'
const FR_TABLE = 'Functional Requirements (FR)'
const FR_14_HEADING = 'FR-AEX-014 — Routing adjustment'

const FR_13: FrItem = { id: 'FR-AEX-013', title: 'Delegation ledger', description: 'Records every delegation.', priority: 'P1', complexity: 'medium', urRefs: ['UR-AEX-1'] }
const FR_14: FrItem = {
  id: 'FR-AEX-014',
  title: 'Routing adjustment',
  description: 'Routes by cost per call.',
  priority: 'P1',
  complexity: 'complex',
  acceptanceCriteria: ['Adjusts one step at a time', 'Compares the expected cost of a tier'],
  validationRules: ['A tier above the ceiling is not chosen'],
  urRefs: ['UR-AEX-2'],
  dsRefs: ['DS-AEX-1']
}

interface Srs {
  fake: FakeNotion
  adapter: NotionSrsAdapter
  root: string
  feature: string
  version: string
  fr13: string
  fr14: string
}

/** root → feature → version → two FR pages, written by the adapter the way `sf srs write` writes them. */
async function seed(): Promise<Srs> {
  const fake = new FakeNotion()
  const adapter = new NotionSrsAdapter({ apiToken: 'secret', client: fake.client })
  const root = fake.addPage('SaaSFoundryAI-srs')
  const frs = [FR_13, FR_14]
  const feature = await adapter.createEpicPage({
    title: FEATURE_TITLE,
    parentPageId: root,
    urs: [],
    frs: [],
    versions: [VERSION_TITLE],
    versionFrs: frs.map((fr) => ({ ...fr, version: VERSION_TITLE }))
  })
  const version = await adapter.createEpicPage({ title: VERSION_TITLE, parentPageId: feature.id, parentId: 'AEX', urs: [], frs, version: { changes: ['Routing by cost'] } })
  const fr13 = await adapter.createFrPage({ parentEpicPageId: version.id, fr: FR_13 })
  const fr14 = await adapter.createFrPage({ parentEpicPageId: version.id, fr: FR_14 })
  fake.resetCalls()
  return { fake, adapter, root, feature: feature.id, version: version.id, fr13: fr13.id, fr14: fr14.id }
}

const notionUrl = (pageId: string): string => `https://www.notion.so/${pageId.replace(/-/g, '')}`

function ticketFor(pageId: string, overrides: Partial<ExistingSrsTicket> = {}): ExistingSrsTicket {
  return {
    number: '1017',
    title: 'Story',
    state: 'OPEN',
    boardStatus: 'In progress',
    parentNumber: '900',
    issueType: 'sf-story',
    url: 'https://github.test/1017',
    srsLinks: [notionUrl(pageId)],
    frIds: ['FR-AEX-014'],
    ...overrides
  }
}

describe('sf srs apply-update — update-fr', () => {
  let dir: string
  let manifestPath: string
  let srs: Srs

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sf-update-fr-'))
    manifestPath = join(dir, 'manifest.json')
    srs = await seed()
    writeFileSync(manifestPath, JSON.stringify({ tools: { srs: { backend: BACKEND, rootPage: { id: srs.root } } } }))
    registerSrsBackend(BACKEND, () => srs.adapter)
  })
  afterEach(() => {
    unregisterSrsBackend(BACKEND)
    rmSync(dir, { recursive: true, force: true })
  })

  const run = async (patch: unknown, options: { dryRun?: boolean; inspectTickets?: ApplyIO['inspectTickets'] } = {}) => {
    const out: string[] = []
    const err: string[] = []
    const io: ApplyIO = { stdout: (chunk) => out.push(chunk), stderr: (chunk) => err.push(chunk), readStdin: () => JSON.stringify(patch), inspectTickets: options.inspectTickets }
    const code = await runApplyUpdate({ patchPath: '', manifestPath, dryRun: options.dryRun }, io)
    const stdout = out.join('')
    return { code, stdout, stderr: err.join(''), json: stdout ? JSON.parse(stdout) : undefined }
  }
  const patch = (changes: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ kind: 'update-fr', frId: 'FR-AEX-014', changes, ...extra })
  const detailCell = (label: string, pageId = srs.fr14, heading = FR_14_HEADING) => srs.fake.tableUnder(pageId, heading).find((row) => row[0] === label)?.[1]
  const rowOf = (pageId: string, heading: string, id = 'FR-AEX-014') => srs.fake.tableUnder(pageId, heading).find((row) => row[0] === id)
  const wheres = (json: { changes: Array<{ where: string }> }) => json.changes.map((change) => change.where)

  // FR-AEX-014 is the first FR this is meant for: its criteria gain one, its description is reworded
  it('changes the description and gains a criterion in the detail table only, and records one line', async () => {
    const { code, json } = await run(
      patch(
        { description: 'Routes by the cost of delivering a ticket, duration included.', acceptanceCriteria: { add: ['Durations break ties between tiers'] } },
        { change: 'Amends FR-AEX-014 — cost per delivered ticket' }
      )
    )

    expect(code).toBe(0)
    expect(wheres(json)).toEqual(['FR page › Description', 'FR page › Acceptance Criteria'])
    expect(detailCell('Description')).toBe('Routes by the cost of delivering a ticket, duration included.')
    expect(detailCell('Acceptance Criteria')).toBe('• Adjusts one step at a time\n• Compares the expected cost of a tier\n• Durations break ties between tiers')
    expect(rowOf(srs.fr14, 'Summary')).toEqual(['FR-AEX-014', 'Routing adjustment', 'P1', 'UR-AEX-2', 'DS-AEX-1', '—'])
    expect(srs.fake.linesOf(srs.version)).toContain('Amends FR-AEX-014 — cost per delivered ticket')
    expect(json.changeLine).toMatchObject({ status: 'added', text: 'Amends FR-AEX-014 — cost per delivered ticket', versionTitle: VERSION_TITLE })
    // nothing is appended as a separate item: the only appended block is the change line
    expect(srs.fake.calls.filter((call) => call.method === 'blocks.children.append')).toHaveLength(1)
    expect(srs.fake.mutations.filter((method) => method !== 'blocks.update' && method !== 'blocks.children.append')).toEqual([])
    // the version and the feature tables do not show a description: they are left alone
    expect(rowOf(srs.version, FR_TABLE)).toEqual(['FR-AEX-014', 'Routing adjustment', 'P1'])
  })

  it('changes the title and the priority everywhere the FR is listed, the page title and heading included', async () => {
    const { code, json } = await run(patch({ title: 'Routing by delivery cost', priority: 'P2' }))

    expect(code).toBe(0)
    expect(rowOf(srs.fr14, 'Summary')).toEqual(['FR-AEX-014', 'Routing by delivery cost', 'P2', 'UR-AEX-2', 'DS-AEX-1', '—'])
    const heading = 'FR-AEX-014 — Routing by delivery cost'
    expect(detailCell('Title', srs.fr14, heading)).toBe('Routing by delivery cost')
    expect(detailCell('Priority', srs.fr14, heading)).toBe('P2')
    expect(srs.fake.titleOf(srs.fr14)).toBe(heading)
    expect(srs.fake.linesOf(srs.fr14)).toContain(heading)
    expect(rowOf(srs.version, FR_TABLE)).toEqual(['FR-AEX-014', 'Routing by delivery cost', 'P2'])
    expect(rowOf(srs.feature, FR_TABLE)).toEqual(['FR-AEX-014', 'Routing by delivery cost', VERSION_TITLE, 'P2', 'UR-AEX-2', 'DS-AEX-1'])
    expect(srs.fake.linesOf(srs.version)).toContain('Amends FR-AEX-014 — Routing by delivery cost (title, priority)')
    // the other FR is where it was, and nothing was created, moved or deleted
    expect(rowOf(srs.version, FR_TABLE, 'FR-AEX-013')).toEqual(['FR-AEX-013', 'Delegation ledger', 'P1'])
    expect(new Set(srs.fake.mutations)).toEqual(new Set(['blocks.update', 'pages.update', 'blocks.children.append']))
    expect(json.before).toEqual({ title: 'Routing adjustment', priority: 'P1' })
  })

  it('keeps the cells of a row it was not asked to change, even edited by hand', async () => {
    const featureRow = srs.fake.rowIdOf(srs.feature, FR_TABLE, 'FR-AEX-014')
    const edited = srs.fake.tableUnder(srs.feature, FR_TABLE).find((row) => row[0] === 'FR-AEX-014')!
    edited[4] = 'UR-AEX-2, UR-AEX-9'
    await srs.fake.client.blocks.update({ block_id: featureRow, table_row: { cells: edited.map((content) => [{ type: 'text', text: { content } }]) } })
    srs.fake.resetCalls()

    await run(patch({ title: 'Routing by delivery cost' }))

    expect(rowOf(srs.feature, FR_TABLE)).toEqual(['FR-AEX-014', 'Routing by delivery cost', VERSION_TITLE, 'P1', 'UR-AEX-2, UR-AEX-9', 'DS-AEX-1'])
  })

  it('makes no mutating call when the same patch is applied a second time', async () => {
    const first = patch({ title: 'Routing by delivery cost', description: 'New text.', acceptanceCriteria: { add: ['One more'] } })
    expect((await run(first)).code).toBe(0)
    const afterFirst = JSON.stringify([srs.fake.linesOf(srs.fr14), srs.fake.tableUnder(srs.fr14, 'Summary'), srs.fake.linesOf(srs.version)])
    srs.fake.resetCalls()

    const { code, json } = await run(first)

    expect(code).toBe(0)
    expect(srs.fake.mutations).toEqual([])
    expect(json.changes).toEqual([])
    expect(json.changeLine.status).toBe('present')
    expect(json.followUps).toBeUndefined()
    expect(JSON.stringify([srs.fake.linesOf(srs.fr14), srs.fake.tableUnder(srs.fr14, 'Summary'), srs.fake.linesOf(srs.version)])).toBe(afterFirst)
  })

  describe('--dry-run', () => {
    it('prints the old to new plan and makes no mutating call', async () => {
      const { code, json } = await run(patch({ priority: 'P3', acceptanceCriteria: { remove: ['Adjusts one step at a time'] } }), { dryRun: true })

      expect(code).toBe(0)
      expect(json.dryRun).toBe(true)
      expect(srs.fake.mutations).toEqual([])
      expect(json.changes).toEqual([
        expect.objectContaining({ page: 'fr', where: 'FR page › summary › Priority', before: 'P1', after: 'P3' }),
        expect.objectContaining({ page: 'fr', where: 'FR page › Priority', before: 'P1', after: 'P3' }),
        expect.objectContaining({
          page: 'fr',
          where: 'FR page › Acceptance Criteria',
          before: '• Adjusts one step at a time\n• Compares the expected cost of a tier',
          after: '• Compares the expected cost of a tier'
        }),
        expect.objectContaining({ page: 'version', where: `version "${VERSION_TITLE}" › FR table › Priority`, before: 'P1', after: 'P3' }),
        expect.objectContaining({ page: 'feature', where: `feature "${FEATURE_TITLE}" › FR table › Priority`, before: 'P1', after: 'P3' })
      ])
      expect(json.changeLine).toMatchObject({ status: 'would-add', text: 'Amends FR-AEX-014 — Routing adjustment (priority, acceptance criteria)' })
      expect(detailCell('Priority')).toBe('P1')
    })

    it('then says the line is present once the patch has been applied, and plans nothing', async () => {
      const p = patch({ priority: 'P3' })
      await run(p)
      srs.fake.resetCalls()

      const { json } = await run(p, { dryRun: true })

      expect(json.changes).toEqual([])
      expect(json.changeLine.status).toBe('present')
      expect(srs.fake.mutations).toEqual([])
    })

    it('is refused for a patch that adds, which would write at once', async () => {
      const { code, stderr } = await run({ kind: 'add-ur', pageId: srs.version, item: { id: 'UR-AEX-9', narrative: 'A need' } }, { dryRun: true })

      expect(code).toBe(2)
      expect(stderr).toContain('--dry-run applies to an update-fr patch only')
      expect(srs.fake.calls).toEqual([])
    })
  })

  describe('acceptance criteria and validation rules', () => {
    it('replaces the whole list, in the order given, when given an array', async () => {
      await run(patch({ acceptanceCriteria: ['Compares the expected cost of a tier', 'Adjusts one step at a time', 'Logs the figure'] }))

      expect(detailCell('Acceptance Criteria')).toBe('• Compares the expected cost of a tier\n• Adjusts one step at a time\n• Logs the figure')
    })

    it('removes an entry by its exact text and adds the new ones after the others', async () => {
      await run(patch({ acceptanceCriteria: { remove: ['Adjusts one step at a time'], add: ['Logs the figure'] }, validationRules: { add: ['Durations are in ms'] } }))

      expect(detailCell('Acceptance Criteria')).toBe('• Compares the expected cost of a tier\n• Logs the figure')
      expect(detailCell('Validation Rules')).toBe('• A tier above the ceiling is not chosen\n• Durations are in ms')
    })

    it('does nothing for an entry already listed, and warns about one it cannot remove', async () => {
      const { code, json, stderr } = await run(patch({ acceptanceCriteria: { add: ['Adjusts one step at a time'], remove: ['Never listed'] } }))

      expect(code).toBe(0)
      expect(json.changes).toEqual([])
      expect(json.warnings).toEqual(['acceptance criteria: "Never listed" is not in the list, so nothing was removed'])
      expect(stderr).toContain('warning — acceptance criteria: "Never listed"')
    })

    it('writes the placeholder for a list emptied by an empty array', async () => {
      await run(patch({ validationRules: [] }))

      expect(detailCell('Validation Rules')).toBe('—')
    })
  })

  describe('what it refuses before any write', () => {
    it('an unknown FR', async () => {
      const { code, stderr } = await run(patch({ priority: 'P2' }, { frId: 'FR-AEX-099' }))

      expect(code).toBe(2)
      expect(stderr).toContain('FR-AEX-099 is not an FR of this SRS')
      expect(srs.fake.mutations).toEqual([])
    })

    it('a page that is the page of another FR, or of no FR', async () => {
      const other = await run(patch({ priority: 'P2' }, { pageId: srs.fr13 }))
      const none = await run(patch({ priority: 'P2' }, { pageId: srs.version }))

      expect([other.code, none.code]).toEqual([2, 2])
      expect(other.stderr).toContain('is the page of FR-AEX-013, not of FR-AEX-014')
      expect(none.stderr).toContain('is not an FR page of this SRS')
      expect(srs.fake.mutations).toEqual([])
    })

    it('an id carried by two FR pages, unless the patch names the page', async () => {
      await srs.adapter.createFrPage({ parentEpicPageId: srs.version, fr: { ...FR_14, title: 'Routing copy' } })
      srs.fake.resetCalls()

      const ambiguous = await run(patch({ priority: 'P2' }))
      expect(ambiguous.code).toBe(2)
      expect(ambiguous.stderr).toContain('is the id of 2 FR pages')
      expect(srs.fake.mutations).toEqual([])

      const named = await run(patch({ priority: 'P2' }, { pageId: srs.fr14 }))
      expect(named.code).toBe(0)
      expect(rowOf(srs.fr14, 'Summary')?.[2]).toBe('P2')
    })

    it.each([
      ['the references of the FR', { urRefs: ['UR-AEX-9'] }, /cannot change `urRefs` yet.*#1056/],
      ['its dsRefs', { dsRefs: [] }, /#1056/],
      ['its id', { id: 'FR-AEX-099' }, /cannot change the `id`/],
      ['its group', { group: 'FR-AEX' }, /cannot change the `group`/],
      ['a field it does not know', { colour: 'blue' }, /cannot change "colour"/],
      ['no field at all', {}, /empty `changes`/],
      ['a priority that is not P1, P2 or P3', { priority: 'urgent' }, /must be P1, P2 or P3/],
      ['a complexity the workflow does not know', { complexity: 'huge' }, /must be one of bug, low, medium, complex/],
      ['an empty description', { description: '  ' }, /`changes.description` must be a non-empty string/],
      ['a list entry spanning lines', { acceptanceCriteria: ['one\ntwo'] }, /must be a single line/],
      ['an add and remove that are both empty', { acceptanceCriteria: { add: [] } }, /changes nothing/],
      ['a list given as a string', { validationRules: 'a rule' }, /must be an array/]
    ])('%s', async (_name, changes, message) => {
      const { code, stderr } = await run(patch(changes))

      expect(code).toBe(2)
      expect(stderr).toMatch(message)
      expect(srs.fake.calls).toEqual([])
    })

    it('a field of the patch the command does not know, and a missing changes object', async () => {
      const item = await run({ kind: 'update-fr', frId: 'FR-AEX-014', item: { priority: 'P2' } })
      const bare = await run({ kind: 'update-fr', frId: 'FR-AEX-014' })
      const badId = await run({ kind: 'update-fr', frId: 'ROUTING', changes: { priority: 'P2' } })

      expect([item.code, bare.code, badId.code]).toEqual([2, 2, 2])
      expect(item.stderr).toContain('unknown field "item"')
      expect(bare.stderr).toContain('needs `changes`')
      expect(badId.stderr).toContain('is not an FR id')
    })

    it('a manifest without the root page, which the FR is found under', async () => {
      writeFileSync(manifestPath, JSON.stringify({ tools: { srs: { backend: BACKEND } } }))

      const { code, stderr } = await run(patch({ priority: 'P2' }))

      expect(code).toBe(2)
      expect(stderr).toContain('tools.srs.rootPage.id')
    })

    it('an FR page that lacks a row the patch changes (a page written before Complexity existed)', async () => {
      await srs.fake.client.blocks.delete({ block_id: srs.fake.rowIdOf(srs.fr14, FR_14_HEADING, 'Complexity') })
      srs.fake.resetCalls()

      const refused = await run(patch({ complexity: 'low', priority: 'P2' }))

      expect(refused.code).toBe(2)
      expect(refused.stderr).toContain('FR page › Complexity: no "Complexity" row')
      expect(srs.fake.mutations).toEqual([])
      expect(rowOf(srs.fr14, 'Summary')?.[2]).toBe('P1')

      expect((await run(patch({ priority: 'P2' }))).code).toBe(0)
    })

    it('a version that is not one of the feature of the FR, or not a version at all', async () => {
      const other = await srs.adapter.createEpicPage({ title: 'Other feature', parentPageId: srs.root, urs: [], frs: [], versions: ['v1 — Other'] })
      const otherVersion = await srs.adapter.createEpicPage({ title: 'v1 — Other', parentPageId: other.id, parentId: 'OTH', urs: [], frs: [] })
      srs.fake.resetCalls()

      const foreign = await run(patch({ priority: 'P2' }, { versionPageId: otherVersion.id }))
      const notAVersion = await run(patch({ priority: 'P2' }, { versionPageId: srs.fr13 }))

      expect([foreign.code, notAVersion.code]).toEqual([2, 2])
      expect(foreign.stderr).toContain(`is not a version of "${FEATURE_TITLE}"`)
      expect(srs.fake.mutations).toEqual([])
    })
  })

  describe('a backend that cannot amend a page', () => {
    it('exits 5 with a clear error and writes nothing', async () => {
      const readOnly = Object.assign(Object.create(srs.adapter), { updateSections: undefined })
      unregisterSrsBackend(BACKEND)
      registerSrsBackend(BACKEND, () => readOnly)

      const { code, stderr } = await run(patch({ priority: 'P2' }))

      expect(code).toBe(5)
      expect(stderr).toContain('the "update-fr-backend" SRS backend cannot change a page that already exists')
      expect(stderr).toContain('Nothing was written')
      expect(srs.fake.mutations).toEqual([])
    })
  })

  describe('a write that stops midway', () => {
    it('exits 6 with what is applied, what is pending and the FR as it was; applying the patch again finishes it', async () => {
      const featureRow = srs.fake.rowIdOf(srs.feature, FR_TABLE, 'FR-AEX-014')
      srs.fake.failWhen = (_method, args) => (args.block_id === featureRow ? new Error('Notion is down') : undefined)
      const input = patch({ title: 'Routing by delivery cost', priority: 'P2' })

      const stopped = await run(input)

      expect(stopped.code).toBe(6)
      expect(stopped.stderr).toContain('stopped at feature "Agent execution" › FR table › Requirement, feature "Agent execution" › FR table › Priority: Notion is down')
      expect(stopped.json.applied).toEqual(
        expect.arrayContaining(['FR page › heading', 'FR page › page title', `version "${VERSION_TITLE}" › FR table › Requirement, version "${VERSION_TITLE}" › FR table › Priority`])
      )
      expect(stopped.json.pending).toEqual([`feature "${FEATURE_TITLE}" › FR table › Requirement, feature "${FEATURE_TITLE}" › FR table › Priority`, 'version change line'])
      expect(stopped.json.before).toEqual({ title: 'Routing adjustment', priority: 'P1' })
      // the history does not claim a change the feature table lacks
      expect(srs.fake.linesOf(srs.version).some((line) => line.startsWith('Amends'))).toBe(false)
      expect(rowOf(srs.feature, FR_TABLE)?.[3]).toBe('P1')

      srs.fake.failWhen = undefined
      srs.fake.resetCalls()
      const finished = await run(input)

      expect(finished.code).toBe(0)
      expect(wheres(finished.json)).toEqual([`feature "${FEATURE_TITLE}" › FR table › Requirement`, `feature "${FEATURE_TITLE}" › FR table › Priority`])
      expect(rowOf(srs.feature, FR_TABLE)).toEqual(['FR-AEX-014', 'Routing by delivery cost', VERSION_TITLE, 'P2', 'UR-AEX-2', 'DS-AEX-1'])
      expect(srs.fake.linesOf(srs.version)).toContain('Amends FR-AEX-014 — Routing by delivery cost (title, priority)')

      // the "before" of the stopped write is a patch that goes back
      const reverted = await run({ kind: 'update-fr', frId: 'FR-AEX-014', changes: stopped.json.before })
      expect(reverted.code).toBe(0)
      expect(rowOf(srs.fr14, 'Summary')?.slice(1, 3)).toEqual(['Routing adjustment', 'P1'])
      expect(srs.fake.titleOf(srs.fr14)).toBe(FR_14_HEADING)
      expect(rowOf(srs.feature, FR_TABLE)?.slice(1, 4)).toEqual(['Routing adjustment', VERSION_TITLE, 'P1'])
    })

    it('finishes a write that stopped inside the FR page, heading, page title and the other tables included', async () => {
      const priorityRow = srs.fake.rowIdOf(srs.fr14, FR_14_HEADING, 'Priority')
      srs.fake.failWhen = (_method, args) => (args.block_id === priorityRow ? new Error('Notion is down') : undefined)
      const input = patch({ title: 'Routing by delivery cost', priority: 'P2' })

      const stopped = await run(input)

      expect(stopped.code).toBe(6)
      expect(stopped.json.applied).toEqual(['FR page › summary › Requirement, FR page › summary › Priority', 'FR page › Title'])
      expect(stopped.json.pending).toEqual([
        'FR page › Priority',
        'FR page › heading',
        'FR page › page title',
        expect.stringContaining('version'),
        expect.stringContaining('feature'),
        'version change line'
      ])
      // the Title row already reads the new title, so a diff against the page would call the heading done
      expect(detailCell('Title')).toBe('Routing by delivery cost')
      expect(srs.fake.titleOf(srs.fr14)).toBe(FR_14_HEADING)

      srs.fake.failWhen = undefined
      const finished = await run(input)

      expect(finished.code).toBe(0)
      expect(srs.fake.titleOf(srs.fr14)).toBe('FR-AEX-014 — Routing by delivery cost')
      expect(rowOf(srs.version, FR_TABLE)).toEqual(['FR-AEX-014', 'Routing by delivery cost', 'P2'])
      expect(rowOf(srs.feature, FR_TABLE)).toEqual(['FR-AEX-014', 'Routing by delivery cost', VERSION_TITLE, 'P2', 'UR-AEX-2', 'DS-AEX-1'])
      expect(srs.fake.linesOf(srs.version)).toContain('Amends FR-AEX-014 — Routing by delivery cost (title, priority)')
      srs.fake.resetCalls()
      expect((await run(input)).code).toBe(0)
      expect(srs.fake.mutations).toEqual([])
    })

    it('exits 6 when only the change line cannot be written, with the tables already amended', async () => {
      srs.fake.failWhen = (method) => (method === 'blocks.children.append' ? new Error('append refused') : undefined)

      const { code, json } = await run(patch({ priority: 'P2' }))

      expect(code).toBe(6)
      expect(json.pending).toEqual(['version change line'])
      expect(json.applied.length).toBeGreaterThan(0)
      expect(rowOf(srs.feature, FR_TABLE)?.[3]).toBe('P2')
    })
  })

  describe('where the change is recorded', () => {
    it('is the version holding the FR, unless versionPageId names another for later work on an older FR', async () => {
      const v2 = await srs.adapter.createEpicPage({ title: 'v2 — Ledger', parentPageId: srs.feature, parentId: 'AEX', urs: [], frs: [] })
      srs.fake.resetCalls()

      const { code, json } = await run(patch({ priority: 'P3' }, { change: 'Reprioritised for the ledger work', versionPageId: v2.id }))

      expect(code).toBe(0)
      expect(json.changeLine).toMatchObject({ pageId: v2.id, versionTitle: 'v2 — Ledger', status: 'added' })
      expect(srs.fake.linesOf(v2.id)).toContain('Reprioritised for the ledger work')
      expect(srs.fake.linesOf(v2.id)).not.toContain('No changes listed yet.')
      // the FR keeps its row in the version it belongs to
      expect(srs.fake.linesOf(srs.version)).not.toContain('Reprioritised for the ledger work')
      expect(rowOf(srs.version, FR_TABLE)?.[2]).toBe('P3')
    })

    it('reports an FR no version lists, and still amends its page', async () => {
      await srs.adapter.createFrPage({ parentEpicPageId: srs.feature, fr: { id: 'FR-AEX-020', title: 'Flat', priority: 'P3' } })
      srs.fake.resetCalls()

      const { code, json, stderr } = await run(patch({ priority: 'P1' }, { frId: 'FR-AEX-020' }))

      expect(code).toBe(0)
      expect(json.changeLine).toBeUndefined()
      expect(json.notPlaced).toEqual(
        expect.arrayContaining([expect.stringContaining('FR-AEX-020 on feature "Agent execution"'), 'FR-AEX-020: no version page lists it, so no change line was recorded.'])
      )
      expect(stderr).toContain('no version page lists it')
      expect(json.changes[0].where).toBe('FR page › summary › Priority')
    })
  })

  describe('the Story spawned from the FR', () => {
    it('is named in a followUps line, since its text is not rewritten', async () => {
      const inspect = jest.fn(() => [ticketFor(srs.fr14), ticketFor(srs.fr14, { number: '1020', state: 'CLOSED', url: 'https://github.test/1020' })])

      const { json } = await run(patch({ priority: 'P2' }), { inspectTickets: inspect })

      expect(inspect).toHaveBeenCalledTimes(1)
      expect(json.followUps).toEqual([
        expect.stringMatching(/^Story #1017 \(open\) was spawned from FR-AEX-014 and keeps the old text: edit its body by hand.*#1057\.$/),
        expect.stringMatching(/^Story #1020 \(closed\) was spawned from FR-AEX-014/)
      ])
    })

    it('ignores a ticket that does not carry the FR page, and says none was found', async () => {
      const { json } = await run(patch({ priority: 'P2' }), { inspectTickets: () => [ticketFor(srs.fr13)] })

      expect(json.followUps).toEqual([expect.stringContaining('No Story spawned from FR-AEX-014 was found on the board')])
    })

    it('says so when the board cannot be read, or when there is no board to read', async () => {
      const failing = await run(patch({ priority: 'P2' }), {
        inspectTickets: () => {
          throw new Error('gh: not logged in')
        }
      })
      expect(failing.code).toBe(0)
      expect(failing.json.followUps).toEqual([expect.stringContaining('The board could not be read for the Story spawned from FR-AEX-014 (gh: not logged in)')])

      const none = await run(patch({ priority: 'P3' }))
      expect(none.json.followUps).toEqual([expect.stringContaining('If a Story was spawned from FR-AEX-014, it keeps the old text')])
    })

    it('is left out when nothing changes', async () => {
      const inspect = jest.fn(() => [ticketFor(srs.fr14)])
      const { json } = await run(patch({ priority: 'P1' }), { inspectTickets: inspect })

      expect(json.followUps).toBeUndefined()
      expect(inspect).not.toHaveBeenCalled()
    })
  })

  it('echoes the note and writes it nowhere', async () => {
    const { json } = await run(patch({ priority: 'P2' }, { note: 'Agreed on the call' }))

    expect(json.note).toBe('Agreed on the call')
    expect(JSON.stringify(srs.fake.calls)).not.toContain('Agreed on the call')
  })
})
