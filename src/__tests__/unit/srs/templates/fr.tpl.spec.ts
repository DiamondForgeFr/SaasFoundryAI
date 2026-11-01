import { FR_TITLE_SEPARATOR } from '../../../../builders/srs/constants'
import { frPageUpdates, readFrDetail, renderFrPage } from '../../../../builders/srs/templates/pages/fr.tpl'
import { FrItem, FrSpec, PageBlock, TableBlock } from '../../../../builders/srs/types'

function findTableAfterHeading(blocks: PageBlock[], headingText: string): TableBlock {
  for (let i = 0; i < blocks.length - 1; i++) {
    const current = blocks[i]
    const next = blocks[i + 1]
    if (current.kind === 'heading' && current.text === headingText && next.kind === 'table') {
      return next
    }
  }
  throw new Error(`table after heading "${headingText}" not found`)
}

describe('renderFrPage — five-category structure', () => {
  it('uses "ID — Title" as the page title', () => {
    const spec: FrSpec = { parentEpicPageId: 'epic', fr: { id: 'FR-AUTH-01-01', title: 'Sign in' } }
    const page = renderFrPage(spec)
    expect(page.title).toBe('FR-AUTH-01-01 — Sign in')
  })

  it('separates FR id from title with em-dash (U+2014), not ASCII hyphen', () => {
    const spec: FrSpec = { parentEpicPageId: 'epic', fr: { id: 'FR-AUTH-01-01', title: 'Sign in' } }
    const page = renderFrPage(spec)
    // Lock the exact separator at the byte level so a silent switch to "-"
    // (U+002D) or ":" breaks the test and surfaces in review.
    expect(page.title).toBe(`FR-AUTH-01-01${FR_TITLE_SEPARATOR}Sign in`)
    expect(FR_TITLE_SEPARATOR).toBe(' \u2014 ')
    const title = page.title ?? ''
    expect(title.includes('\u2014')).toBe(true)
    expect(title.split('\u2014').length).toBe(2)
  })

  it('emits Summary + divider + per-item detail in order', () => {
    const spec: FrSpec = {
      parentEpicPageId: 'epic',
      fr: { id: 'FR-AUTH-01-01', title: 'Sign in' }
    }
    const page = renderFrPage(spec)
    const kinds = page.blocks.map((b) => (b.kind === 'heading' ? `heading:${b.level}:${b.text}` : b.kind))
    expect(kinds).toEqual(['heading:2:Summary', 'table', 'divider', 'heading:2:FR-AUTH-01-01 — Sign in', 'table'])
  })

  it('renders the Summary table with the 6 canonical columns', () => {
    const spec: FrSpec = {
      parentEpicPageId: 'epic',
      fr: {
        id: 'FR-AUTH-01-01',
        title: 'Sign in',
        priority: 'P1',
        urRefs: ['UR-AUTH-01-01'],
        dsRefs: ['DS-AUTH-01-01', 'DS-AUTH-01-02'],
        tcRefs: ['TC-AUTH-01-01']
      }
    }
    const page = renderFrPage(spec)
    const summary = findTableAfterHeading(page.blocks, 'Summary')
    expect(summary.header).toEqual(['ID', 'Requirement', 'Priority', 'Related UR', 'Related DS', 'Related TC'])
    expect(summary.rows).toEqual([['FR-AUTH-01-01', 'Sign in', 'P1', 'UR-AUTH-01-01', 'DS-AUTH-01-01, DS-AUTH-01-02', 'TC-AUTH-01-01']])
  })

  it('renders a vertical detail table with all 13 canonical rows', () => {
    const spec: FrSpec = {
      parentEpicPageId: 'epic',
      fr: {
        id: 'FR-AUTH-01-01',
        title: 'Sign in',
        description: 'Authenticate user via email + password',
        endpoint: 'POST /auth/signin',
        priority: 'P1',
        complexity: 'medium',
        urRefs: ['UR-AUTH-01-01'],
        dsRefs: ['DS-AUTH-01-01'],
        tcRefs: ['TC-AUTH-01-01', 'TC-AUTH-01-02'],
        requestBody: '{ email, password }',
        acceptanceCriteria: ['returns 200 on success', 'returns 401 on invalid credentials'],
        validationRules: ['email required', 'password min 8 chars'],
        securityRationale: 'Prevents user enumeration'
      }
    }
    const page = renderFrPage(spec)
    const detail = findTableAfterHeading(page.blocks, 'FR-AUTH-01-01 — Sign in')
    expect(detail.header).toEqual(['Field', 'Value'])
    expect(detail.rows).toEqual([
      ['ID', 'FR-AUTH-01-01'],
      ['Title', 'Sign in'],
      ['Endpoint', 'POST /auth/signin'],
      ['Priority', 'P1'],
      ['Complexity', 'medium'],
      ['Related UR', 'UR-AUTH-01-01'],
      ['Related DS', 'DS-AUTH-01-01'],
      ['Related TC', 'TC-AUTH-01-01, TC-AUTH-01-02'],
      ['Description', 'Authenticate user via email + password'],
      ['Request Body', '{ email, password }'],
      ['Acceptance Criteria', '• returns 200 on success\n• returns 401 on invalid credentials'],
      ['Validation Rules', '• email required\n• password min 8 chars'],
      ['Security Rationale', 'Prevents user enumeration']
    ])
  })

  it('fills missing fields with the em-dash placeholder', () => {
    const spec: FrSpec = { parentEpicPageId: 'epic', fr: { id: 'FR-1', title: 'Minimal' } }
    const page = renderFrPage(spec)
    const summary = findTableAfterHeading(page.blocks, 'Summary')
    expect(summary.rows).toEqual([['FR-1', 'Minimal', '—', '—', '—', '—']])

    const detail = findTableAfterHeading(page.blocks, 'FR-1 — Minimal')
    const cellFor = (label: string) => detail.rows.find((row) => row[0] === label)?.[1]
    expect(cellFor('Endpoint')).toBe('—')
    expect(cellFor('Priority')).toBe('—')
    expect(cellFor('Related UR')).toBe('—')
    expect(cellFor('Related DS')).toBe('—')
    expect(cellFor('Related TC')).toBe('—')
    expect(cellFor('Description')).toBe('—')
    expect(cellFor('Request Body')).toBe('—')
    expect(cellFor('Acceptance Criteria')).toBe('—')
    expect(cellFor('Validation Rules')).toBe('—')
    expect(cellFor('Security Rationale')).toBe('—')
  })

  it('renders multi-line list cells with bullet prefix and newlines', () => {
    const spec: FrSpec = {
      parentEpicPageId: 'epic',
      fr: {
        id: 'FR-1',
        title: 'T',
        acceptanceCriteria: ['a', 'b', 'c'],
        validationRules: ['r1']
      }
    }
    const page = renderFrPage(spec)
    const detail = findTableAfterHeading(page.blocks, 'FR-1 — T')
    const cellFor = (label: string) => detail.rows.find((row) => row[0] === label)?.[1]
    expect(cellFor('Acceptance Criteria')).toBe('• a\n• b\n• c')
    expect(cellFor('Validation Rules')).toBe('• r1')
  })
})

// #945 — an FR amended in place is read back from, and written to, the page the renderer wrote
describe('readFrDetail', () => {
  const fr: FrItem = {
    id: 'FR-AUTH-01-01',
    title: 'Sign in',
    description: 'Authenticate user via email + password',
    endpoint: 'POST /auth/signin',
    priority: 'P1',
    complexity: 'medium',
    urRefs: ['UR-AUTH-01-01'],
    dsRefs: ['DS-AUTH-01-01', 'DS-AUTH-01-02'],
    tcRefs: ['TC-AUTH-01-01'],
    requestBody: '{ email, password }',
    acceptanceCriteria: ['returns 200 on success', 'returns 401 on invalid credentials'],
    validationRules: ['email required'],
    securityRationale: 'Prevents user enumeration'
  }
  const detailRows = (item: FrItem) => findTableAfterHeading(renderFrPage({ parentEpicPageId: 'epic', fr: item }).blocks, `${item.id} — ${item.title}`).rows
  const withHeader = (rows: string[][]) => [['Field', 'Value'], ...rows]

  it('is the inverse of what the renderer writes in the Field/Value table', () => {
    expect(readFrDetail(withHeader(detailRows(fr)), { id: fr.id, title: 'ignored' })).toEqual(fr)
  })

  it('reads the em-dash placeholder as no value', () => {
    const read = readFrDetail(withHeader(detailRows({ id: 'FR-1', title: 'Bare' })), { id: 'FR-1', title: 'Bare' })

    expect(read).toEqual({
      id: 'FR-1',
      title: 'Bare',
      endpoint: undefined,
      priority: undefined,
      complexity: undefined,
      urRefs: [],
      dsRefs: [],
      tcRefs: [],
      description: undefined,
      requestBody: undefined,
      acceptanceCriteria: [],
      validationRules: [],
      securityRationale: undefined
    })
  })

  it('takes the id and the title from the fallback when the table lacks them, and ignores a value it does not know', () => {
    const rows = withHeader([
      ['Priority', 'High'],
      ['Complexity', 'huge']
    ])

    expect(readFrDetail(rows, { id: 'FR-9', title: 'From the page title' })).toMatchObject({ id: 'FR-9', title: 'From the page title', priority: undefined, complexity: undefined })
  })
})

describe('frPageUpdates', () => {
  const fr: FrItem = { id: 'FR-AUTH-01-01', title: 'Sign in with SSO', priority: 'P2', description: 'New text', acceptanceCriteria: ['a', 'b'] }
  const headings = { summary: 'Summary', detail: 'FR-AUTH-01-01 — Sign in' }

  it('addresses the detail rows by their label, for the fields amended only', () => {
    expect(frPageUpdates(fr, ['description', 'acceptanceCriteria'], headings)).toEqual([
      { kind: 'table-cells', heading: 'FR-AUTH-01-01 — Sign in', rowKey: 'Description', cells: { Value: 'New text' } },
      { kind: 'table-cells', heading: 'FR-AUTH-01-01 — Sign in', rowKey: 'Acceptance Criteria', cells: { Value: '• a\n• b' } }
    ])
  })

  it('amends the Summary row by the FR id for a title or a priority, and the heading and page title for a title', () => {
    expect(frPageUpdates(fr, ['title', 'priority'], headings)).toEqual([
      { kind: 'table-cells', heading: 'Summary', rowKey: 'FR-AUTH-01-01', cells: { Requirement: 'Sign in with SSO', Priority: 'P2' } },
      { kind: 'table-cells', heading: 'FR-AUTH-01-01 — Sign in', rowKey: 'Title', cells: { Value: 'Sign in with SSO' } },
      { kind: 'table-cells', heading: 'FR-AUTH-01-01 — Sign in', rowKey: 'Priority', cells: { Value: 'P2' } },
      { kind: 'heading', heading: 'FR-AUTH-01-01 — Sign in', text: 'FR-AUTH-01-01 — Sign in with SSO' },
      { kind: 'title', text: 'FR-AUTH-01-01 — Sign in with SSO' }
    ])
  })

  it('writes the em-dash placeholder for a list emptied', () => {
    expect(frPageUpdates({ ...fr, acceptanceCriteria: [] }, ['acceptanceCriteria'], headings)).toEqual([
      { kind: 'table-cells', heading: 'FR-AUTH-01-01 — Sign in', rowKey: 'Acceptance Criteria', cells: { Value: '—' } }
    ])
  })

  it('updates nothing for no field', () => {
    expect(frPageUpdates(fr, [], headings)).toEqual([])
  })
})
