import { renderEpicPage } from '../../../../builders/srs/templates/pages/epic.tpl'
import { EpicSpec, PageBlock, TableBlock } from '../../../../builders/srs/types'

function kinds(page: ReturnType<typeof renderEpicPage>): string[] {
  return page.blocks.map((b) => (b.kind === 'heading' ? `heading:${b.level}` : b.kind))
}

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

function findParagraphAfterHeading(blocks: PageBlock[], headingText: string): string {
  for (let i = 0; i < blocks.length - 1; i++) {
    const current = blocks[i]
    const next = blocks[i + 1]
    if (current.kind === 'heading' && current.text === headingText && next.kind === 'paragraph') {
      return next.text
    }
  }
  throw new Error(`paragraph after heading "${headingText}" not found`)
}

describe('renderEpicPage — DIAMONFORGE-style structure', () => {
  it('emits the spec-sections scaffold in order', () => {
    const spec: EpicSpec = {
      title: 'Authentication',
      parentPageId: 'p',
      urs: [
        { id: 'UR-AUTH-01-01', narrative: 'sign in', priority: 'P1', group: 'UR-AUTH-01' },
        { id: 'UR-AUTH-02-01', narrative: 'reset password', priority: 'P1', group: 'UR-AUTH-02' }
      ],
      frs: [
        { id: 'FR-AUTH-01-01', title: 'register', priority: 'P1', group: 'FR-AUTH-01', urRefs: ['UR-AUTH-01-01'], dsRefs: ['DS-AUTH-01'] },
        { id: 'FR-AUTH-02-01', title: 'login', priority: 'P1', group: 'FR-AUTH-02', urRefs: ['UR-AUTH-01-01'], dsRefs: ['DS-AUTH-03'] }
      ],
      dsItems: [
        { id: 'DS-AUTH-01-01', title: 'bcrypt', frRefs: ['FR-AUTH-01-01'], group: 'DS-AUTH-01' },
        { id: 'DS-AUTH-03-01', title: 'JWT cookies', frRefs: ['FR-AUTH-02-01'], group: 'DS-AUTH-03' }
      ],
      nfrItems: [{ id: 'NFR-AUTH-01-01', title: 'login speed', target: '≤ 1s p95', priority: 'P1', frRefs: ['FR-AUTH-02-01'], group: 'NFR-AUTH-01' }]
    }

    const page = renderEpicPage(spec)

    expect(page.title).toBe('Authentication')
    expect(kinds(page)).toEqual([
      'heading:2', // Traceability
      'code',
      'paragraph',
      'heading:2', // Requirement Types
      'table',
      'heading:2', // UR
      'table',
      'heading:2', // FR
      'table',
      'heading:2', // DS
      'table',
      'heading:2', // NFR
      'table'
    ])
  })

  it('renders the Requirement Types table with UR/FR/DS/NFR rows', () => {
    const spec: EpicSpec = { title: 'E', parentPageId: 'p', urs: [], frs: [] }
    const page = renderEpicPage(spec)
    const reqTypes = findTableAfterHeading(page.blocks, 'Requirement Types')
    expect(reqTypes.header).toEqual(['Prefix', 'Type', 'Description', 'Example'])
    const prefixes = reqTypes.rows.map((r) => r[0])
    expect(prefixes).toEqual(['UR', 'FR', 'DS', 'NFR'])
  })

  it('renders the UR table with group headers and Related FR derived from spec.frs', () => {
    const spec: EpicSpec = {
      title: 'E',
      parentPageId: 'p',
      urs: [
        { id: 'UR-X-01-01', narrative: 'a', priority: 'P1', group: 'UR-X-01' },
        { id: 'UR-X-01-02', narrative: 'b', priority: 'P2', group: 'UR-X-01' },
        { id: 'UR-X-02-01', narrative: 'c', priority: 'P1', group: 'UR-X-02' }
      ],
      frs: [
        { id: 'FR-X-01', title: 'f1', urRefs: ['UR-X-01-01'] },
        { id: 'FR-X-02', title: 'f2', urRefs: ['UR-X-01-01', 'UR-X-02-01'] }
      ]
    }
    const page = renderEpicPage(spec)
    const urTable = findTableAfterHeading(page.blocks, 'User Requirements (UR)')

    expect(urTable.header).toEqual(['ID', 'Requirement', 'Priority', 'Related FR'])
    expect(urTable.rows).toEqual([
      ['UR-X-01', '', '', ''], // group header
      ['UR-X-01-01', 'a', 'P1', 'FR-X-01, FR-X-02'],
      ['UR-X-01-02', 'b', 'P2', '—'],
      ['UR-X-02', '', '', ''], // group header
      ['UR-X-02-01', 'c', 'P1', 'FR-X-02']
    ])
  })

  it('renders the FR table with group headers and related refs', () => {
    const spec: EpicSpec = {
      title: 'E',
      parentPageId: 'p',
      urs: [],
      frs: [
        { id: 'FR-X-01-01', title: 'a', priority: 'P1', group: 'FR-X-01', urRefs: ['UR-X-01-01'], dsRefs: ['DS-X-01'] },
        { id: 'FR-X-02-01', title: 'b', group: 'FR-X-02' }
      ]
    }
    const page = renderEpicPage(spec)
    const frTable = findTableAfterHeading(page.blocks, 'Functional Requirements (FR)')
    expect(frTable.header).toEqual(['ID', 'Requirement', 'Priority', 'Related UR', 'Related DS'])
    expect(frTable.rows).toEqual([
      ['FR-X-01', '', '', '', ''],
      ['FR-X-01-01', 'a', 'P1', 'UR-X-01-01', 'DS-X-01'],
      ['FR-X-02', '', '', '', ''],
      ['FR-X-02-01', 'b', '—', '—', '—']
    ])
  })

  it('renders the DS table with group headers', () => {
    const spec: EpicSpec = {
      title: 'E',
      parentPageId: 'p',
      urs: [],
      frs: [],
      dsItems: [
        { id: 'DS-X-01-01', title: 'a', group: 'DS-X-01', frRefs: ['FR-X-01-01'] },
        { id: 'DS-X-02-01', title: 'b', group: 'DS-X-02' }
      ]
    }
    const page = renderEpicPage(spec)
    const dsTable = findTableAfterHeading(page.blocks, 'Design Specifications (DS)')
    expect(dsTable.header).toEqual(['ID', 'Specification', 'Related FR'])
    expect(dsTable.rows).toEqual([
      ['DS-X-01', '', ''],
      ['DS-X-01-01', 'a', 'FR-X-01-01'],
      ['DS-X-02', '', ''],
      ['DS-X-02-01', 'b', '—']
    ])
  })

  it('renders the NFR table with Target column and group headers', () => {
    const spec: EpicSpec = {
      title: 'E',
      parentPageId: 'p',
      urs: [],
      frs: [],
      nfrItems: [
        { id: 'NFR-X-01-01', title: 'perf', target: '≤ 1s', priority: 'P1', group: 'NFR-X-01', frRefs: ['FR-X-01'] },
        { id: 'NFR-X-02-01', title: 'sec', priority: 'P2', group: 'NFR-X-02' }
      ]
    }
    const page = renderEpicPage(spec)
    const nfrTable = findTableAfterHeading(page.blocks, 'Non-Functional Requirements (NFR)')
    expect(nfrTable.header).toEqual(['ID', 'Requirement', 'Target', 'Priority', 'Related FR'])
    expect(nfrTable.rows).toEqual([
      ['NFR-X-01', '', '', '', ''],
      ['NFR-X-01-01', 'perf', '≤ 1s', 'P1', 'FR-X-01'],
      ['NFR-X-02', '', '', '', ''],
      ['NFR-X-02-01', 'sec', '—', 'P2', '—']
    ])
  })

  it('emits placeholder paragraphs for empty sections', () => {
    const spec: EpicSpec = { title: 'Empty', parentPageId: 'p', urs: [], frs: [] }
    const page = renderEpicPage(spec)
    expect(findParagraphAfterHeading(page.blocks, 'User Requirements (UR)')).toBe('No user requirements yet.')
    expect(findParagraphAfterHeading(page.blocks, 'Functional Requirements (FR)')).toBe('No functional requirements yet.')
    expect(findParagraphAfterHeading(page.blocks, 'Design Specifications (DS)')).toBe('No design specifications yet.')
    expect(findParagraphAfterHeading(page.blocks, 'Non-Functional Requirements (NFR)')).toBe('No non-functional requirements yet.')
  })

  it('emits the Traceability tree as a plain-text code block', () => {
    const spec: EpicSpec = { title: 'E', parentPageId: 'p', urs: [], frs: [] }
    const page = renderEpicPage(spec)
    const traceIdx = page.blocks.findIndex((b) => b.kind === 'heading' && b.text === 'Traceability')
    const codeBlock = page.blocks[traceIdx + 1]
    expect(codeBlock.kind).toBe('code')
    if (codeBlock.kind === 'code') {
      expect(codeBlock.language).toBe('plain text')
      expect(codeBlock.text).toContain('UR (User Requirement)')
      expect(codeBlock.text).toContain('FR (Functional Requirement)')
      expect(codeBlock.text).toContain('DS (Design Specification)')
      expect(codeBlock.text).toContain('TC (Test Case)')
    }
  })

  it('handles ungrouped items without emitting group header rows', () => {
    const spec: EpicSpec = {
      title: 'E',
      parentPageId: 'p',
      urs: [{ id: 'UR-1', narrative: 'a', priority: 'P1' }],
      frs: [{ id: 'FR-1', title: 'b', priority: 'P1' }]
    }
    const page = renderEpicPage(spec)
    const urTable = findTableAfterHeading(page.blocks, 'User Requirements (UR)')
    const frTable = findTableAfterHeading(page.blocks, 'Functional Requirements (FR)')
    expect(urTable.rows).toHaveLength(1)
    expect(urTable.rows[0][0]).toBe('UR-1')
    expect(frTable.rows).toHaveLength(1)
    expect(frTable.rows[0][0]).toBe('FR-1')
  })
})
