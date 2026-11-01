import { renderFrPage } from '../../../builders/srs/templates/pages/fr.tpl'
import { FrItem } from '../../../builders/srs/types'
import { applyChanges, FrChanges, mergeList, readFrPage, revertChanges, validateUpdateFrPatch } from '../../../srs/update-fr'
import { SrsTree } from '../../../srs/tree/walk'
import { locateFr } from '../../../srs/version-extension'
import { asRead } from '../../helpers/srs-pages'

const FR: FrItem = {
  id: 'FR-AEX-014',
  title: 'Routing adjustment',
  description: 'Routes by cost per call.',
  endpoint: 'POST /routing',
  requestBody: '{ ticket }',
  securityRationale: 'No secret leaves the ledger',
  priority: 'P1',
  complexity: 'complex',
  acceptanceCriteria: ['Adjusts one step at a time', 'Compares the expected cost of a tier'],
  validationRules: ['A tier above the ceiling is not chosen'],
  urRefs: ['UR-AEX-2'],
  dsRefs: ['DS-AEX-1', 'DS-AEX-2'],
  tcRefs: ['TC-AEX-1']
}

const patch = (changes: unknown, extra: Record<string, unknown> = {}) => ({ kind: 'update-fr', frId: 'FR-AEX-014', changes, ...extra })

describe('validateUpdateFrPatch', () => {
  it('returns the patch normalized: the id upper-cased, the texts trimmed, the title without its own id', () => {
    const valid = validateUpdateFrPatch(
      patch(
        {
          title: ' FR-AEX-014 — Routing by delivery cost ',
          description: '  New text  ',
          priority: 'P2',
          complexity: 'medium',
          acceptanceCriteria: { add: [' one '], remove: ['two'] },
          validationRules: [' a ', 'b']
        },
        { frId: ' fr-aex-014 ', change: ' Amends it ', note: ' agreed ', pageId: ' page ', versionPageId: ' version ' }
      )
    )

    expect(valid).toEqual({
      kind: 'update-fr',
      frId: 'FR-AEX-014',
      changes: {
        title: 'Routing by delivery cost',
        description: 'New text',
        priority: 'P2',
        complexity: 'medium',
        acceptanceCriteria: { add: ['one'], remove: ['two'] },
        validationRules: ['a', 'b']
      },
      change: 'Amends it',
      note: 'agreed',
      pageId: 'page',
      versionPageId: 'version'
    })
  })

  it('keeps a description over several lines', () => {
    expect(validateUpdateFrPatch(patch({ description: 'First.\n\nSecond.' })).changes.description).toBe('First.\n\nSecond.')
  })

  it.each([
    ['not an object', 'x', /patch must be a JSON object/],
    ['an unknown top-level field', { ...patch({ priority: 'P1' }), item: {} }, /unknown field "item"/],
    ['an id that is not an FR id', patch({ priority: 'P1' }, { frId: 'FR-AEX' }), /is not an FR id/],
    ['an id with text after it', patch({ priority: 'P1' }, { frId: 'FR-AEX-014 — Routing' }), /is not an FR id/],
    ['changes that is an array', patch([]), /needs `changes`/],
    ['a title over two lines', patch({ title: 'a\nb' }), /single line/],
    ['a change line over two lines', patch({ priority: 'P1' }, { change: 'a\nb' }), /single line/],
    ['references', patch({ tcRefs: ['TC-1'] }), /#1056/],
    ['an empty add and remove', patch({ validationRules: { add: [], remove: [] } }), /changes nothing/],
    ['a key besides add and remove', patch({ validationRules: { replace: ['a'] } }), /unknown key "replace"/]
  ])('refuses %s', (_name, input, message) => {
    expect(() => validateUpdateFrPatch(input)).toThrow(message)
  })

  it('keeps a title that is nothing but the id, which has no text to strip it down to', () => {
    expect(validateUpdateFrPatch(patch({ title: 'FR-AEX-014' })).changes.title).toBe('FR-AEX-014')
  })
})

describe('mergeList', () => {
  const current = ['a', 'b', 'c']

  it('replaces the list with an array, keeping its order', () => {
    expect(mergeList('criteria', current, ['c', 'a'])).toEqual({ next: ['c', 'a'], warnings: [] })
  })

  it('removes by exact text, then adds what is not listed, at the end', () => {
    expect(mergeList('criteria', current, { remove: ['b'], add: ['d', 'a'] })).toEqual({ next: ['a', 'c', 'd'], warnings: [] })
  })

  it('warns about an entry it cannot remove and leaves the list as it was', () => {
    expect(mergeList('criteria', current, { remove: ['z'] })).toEqual({ next: current, warnings: ['criteria: "z" is not in the list, so nothing was removed'] })
  })

  it('re-adds an entry that is both removed and added, at the end', () => {
    expect(mergeList('criteria', current, { remove: ['a'], add: ['a'] }).next).toEqual(['b', 'c', 'a'])
  })

  it('does not match on a part of an entry', () => {
    expect(mergeList('criteria', ['Adjusts one step at a time'], { remove: ['Adjusts one step'] }).next).toEqual(['Adjusts one step at a time'])
  })
})

describe('applyChanges and revertChanges', () => {
  const changes: FrChanges = { title: 'New title', priority: 'P3', acceptanceCriteria: { add: ['A third one'] }, validationRules: [] }

  it('applies only what the patch names and leaves the rest of the FR alone', () => {
    const { after } = applyChanges(FR, changes)

    expect(after).toEqual({ ...FR, title: 'New title', priority: 'P3', acceptanceCriteria: [...FR.acceptanceCriteria!, 'A third one'], validationRules: [] })
    expect(FR.title).toBe('Routing adjustment')
  })

  it('reverts with the fields the patch names, as they were', () => {
    expect(revertChanges(FR, changes)).toEqual({ title: 'Routing adjustment', priority: 'P1', acceptanceCriteria: FR.acceptanceCriteria, validationRules: FR.validationRules })
  })

  it('leaves out a field the FR held no value for, which a patch cannot clear', () => {
    expect(revertChanges({ ...FR, description: undefined }, { description: 'New' })).toEqual({})
  })
})

describe('readFrPage', () => {
  const page = () => asRead(renderFrPage({ parentEpicPageId: 'v', fr: FR }), 'fr-page')

  it('reads back the FR, and the headings of its two tables, from the page the renderer wrote', () => {
    const read = readFrPage(page(), { id: FR.id, title: FR.title })

    expect('error' in read).toBe(false)
    if ('error' in read) return
    expect(read.item).toEqual(FR)
    expect(read.headings).toEqual({ summary: 'Summary', detail: 'FR-AEX-014 — Routing adjustment' })
  })

  it('reads a page of a bare FR as an FR with nothing in it', () => {
    const read = readFrPage(asRead(renderFrPage({ parentEpicPageId: 'v', fr: { id: 'FR-1', title: 'Bare' } })), { id: 'FR-1', title: 'Bare' })

    expect(read).toMatchObject({ item: { id: 'FR-1', title: 'Bare', acceptanceCriteria: [], validationRules: [], urRefs: [] } })
  })

  it('falls back on the title of the page when the table does not carry one', () => {
    const raw = page()
    for (const block of raw.blocks) if (block.rows?.[0]?.[0] === 'Field') block.rows = block.rows.filter((row) => row[0] !== 'Title')

    expect(readFrPage(raw, { id: FR.id, title: 'Title of the page' })).toMatchObject({ item: { title: 'Title of the page' } })
  })

  it('refuses a page without the Field/Value table, without the Summary table, or with a table under no heading', () => {
    const noDetail = page()
    noDetail.blocks = noDetail.blocks.filter((block) => block.rows?.[0]?.[0] !== 'Field')
    const noSummary = page()
    noSummary.blocks = noSummary.blocks.filter((block) => block.rows?.[0]?.[0] !== 'ID')
    const headless = page()
    headless.blocks = headless.blocks.filter((block) => block.kind !== 'heading')

    expect(readFrPage(noDetail, FR)).toEqual({ error: 'its page has no Field/Value table to amend' })
    expect(readFrPage(noSummary, FR)).toEqual({ error: 'its page has no Summary table, or no heading above it' })
    expect(readFrPage(headless, FR)).toEqual({ error: 'its Field/Value table has no heading above it' })
  })
})

describe('locateFr', () => {
  const fr = (id: string, pageId: string, version?: string) => ({
    id,
    area: 'aex',
    title: id,
    pageId,
    url: `https://example.test/${pageId}`,
    featurePageId: 'feature',
    featureTitle: 'Agent execution',
    version,
    versionPageId: version ? `v-${version}` : undefined,
    holderPageId: 'feature',
    holderTitle: 'Agent execution'
  })
  const tree = (frs: ReturnType<typeof fr>[]): SrsTree => ({ rootPageId: 'root', features: [], frs, conformance: [], unparsedPages: [] })

  it('finds an FR by its id, whatever the case', () => {
    expect(locateFr(tree([fr('FR-AEX-014', 'p14')]), 'fr-aex-014')).toMatchObject({ fr: { pageId: 'p14' } })
  })

  it('names the ids that no page carries, and the ones several carry', () => {
    const frs = tree([fr('FR-AEX-014', 'p14', 'v1'), fr('FR-AEX-014', 'p14b', 'v2')])

    expect(locateFr(frs, 'FR-AEX-001')).toEqual({ error: 'FR-AEX-001 is not an FR of this SRS: no FR page under its root carries that id.' })
    expect(locateFr(frs, 'FR-AEX-014')).toEqual({
      error: 'FR-AEX-014 is the id of 2 FR pages: "Agent execution" › "v1" (p14); "Agent execution" › "v2" (p14b). Name the one to change with "pageId".'
    })
  })

  it('takes the page the patch names among several, ignoring dashes in its id', () => {
    const frs = tree([fr('FR-AEX-014', 'aaaa-bbbb', 'v1'), fr('FR-AEX-014', 'cccc-dddd', 'v2')])

    expect(locateFr(frs, 'FR-AEX-014', 'ccccdddd')).toMatchObject({ fr: { pageId: 'cccc-dddd' } })
  })

  it('refuses a page that belongs to another FR or to none', () => {
    const frs = tree([fr('FR-AEX-014', 'p14'), fr('FR-AEX-013', 'p13')])

    expect(locateFr(frs, 'FR-AEX-014', 'p13')).toEqual({ error: 'page p13 is the page of FR-AEX-013, not of FR-AEX-014.' })
    expect(locateFr(frs, 'FR-AEX-014', 'elsewhere')).toEqual({ error: 'page elsewhere is not an FR page of this SRS.' })
  })
})
