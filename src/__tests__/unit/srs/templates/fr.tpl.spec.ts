import { renderFrPage } from '../../../../builders/srs/templates/pages/fr.tpl'
import { FrSpec, PageBlock, TableBlock } from '../../../../builders/srs/types'

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

describe('renderFrPage — DIAMONFORGE-style structure', () => {
  it('uses "ID — Title" as the page title', () => {
    const spec: FrSpec = { parentEpicPageId: 'epic', fr: { id: 'FR-AUTH-01-01', title: 'Sign in' } }
    const page = renderFrPage(spec)
    expect(page.title).toBe('FR-AUTH-01-01 — Sign in')
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

  it('renders a vertical detail table with all 12 canonical rows', () => {
    const spec: FrSpec = {
      parentEpicPageId: 'epic',
      fr: {
        id: 'FR-AUTH-01-01',
        title: 'Sign in',
        description: 'Authenticate user via email + password',
        endpoint: 'POST /auth/signin',
        priority: 'P1',
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
