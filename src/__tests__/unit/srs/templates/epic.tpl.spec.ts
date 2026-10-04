import { featureTableAdditions, renderEpicPage } from '../../../../builders/srs/templates/pages/epic.tpl'
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

describe('renderEpicPage — five-category structure', () => {
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
      tcItems: [{ id: 'TC-AUTH-01-01', title: 'successful login', steps: ['submit valid credentials'], expectedResult: '200 OK + cookie set', frRefs: ['FR-AUTH-02-01'] }],
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
      'heading:2', // TC
      'table',
      'heading:2', // NFR
      'table'
    ])
  })

  it('renders the Requirement Types table with UR/FR/DS/TC/NFR rows', () => {
    const spec: EpicSpec = { title: 'E', parentPageId: 'p', urs: [], frs: [] }
    const page = renderEpicPage(spec)
    const reqTypes = findTableAfterHeading(page.blocks, 'Requirement Types')
    expect(reqTypes.header).toEqual(['Prefix', 'Type', 'Description', 'Example'])
    const prefixes = reqTypes.rows.map((r) => r[0])
    expect(prefixes).toEqual(['UR', 'FR', 'DS', 'TC', 'NFR'])
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
    expect(dsTable.header).toEqual(['ID', 'Specification', 'Description', 'Related FR'])
    expect(dsTable.rows).toEqual([
      ['DS-X-01', '', '', ''],
      ['DS-X-01-01', 'a', '—', 'FR-X-01-01'],
      ['DS-X-02', '', '', ''],
      ['DS-X-02-01', 'b', '—', '—']
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
    expect(findParagraphAfterHeading(page.blocks, 'Test Cases (TC)')).toBe('No test cases yet.')
    expect(findParagraphAfterHeading(page.blocks, 'Non-Functional Requirements (NFR)')).toBe('No non-functional requirements yet.')
  })

  it('renders the TC table with Steps + Expected Result + Related FR', () => {
    const spec: EpicSpec = {
      title: 'E',
      parentPageId: 'p',
      urs: [],
      frs: [],
      tcItems: [
        { id: 'TC-X-01', title: 'happy path', steps: ['step a', 'step b'], expectedResult: '200 OK', frRefs: ['FR-X-01'] },
        { id: 'TC-X-02', title: 'empty body' }
      ]
    }
    const page = renderEpicPage(spec)
    const tcTable = findTableAfterHeading(page.blocks, 'Test Cases (TC)')
    expect(tcTable.header).toEqual(['ID', 'Title', 'Steps', 'Expected Result', 'Related FR'])
    expect(tcTable.rows).toEqual([
      ['TC-X-01', 'happy path', '• step a\n• step b', '200 OK', 'FR-X-01'],
      ['TC-X-02', 'empty body', '—', '—', '—']
    ])
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
      expect(codeBlock.text).toContain('NFR (Non-Functional Requirement)')
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

// #843 — `businessValue` and `scope` were accepted by the spec and written nowhere
describe('renderEpicPage — business value and scope', () => {
  const headings = (page: ReturnType<typeof renderEpicPage>) => page.blocks.filter((b) => b.kind === 'heading').map((b) => (b.kind === 'heading' ? b.text : ''))

  it('opens a feature page with its business value and scope, before its versions', () => {
    const page = renderEpicPage({
      title: 'Automorph',
      parentPageId: 'root',
      versions: ['v0 — Walking skeleton'],
      businessValue: 'Operators reshape a mission without a redeploy.',
      scope: 'Mission editing in the console; the runtime stays out of scope.',
      urs: [],
      frs: []
    })

    expect(headings(page).slice(0, 3)).toEqual(['Business Value', 'Scope', 'Versions'])
    expect(findParagraphAfterHeading(page.blocks, 'Business Value')).toBe('Operators reshape a mission without a redeploy.')
    expect(findParagraphAfterHeading(page.blocks, 'Scope')).toBe('Mission editing in the console; the runtime stays out of scope.')
  })

  it('opens a version page with them too, before what changed', () => {
    const page = renderEpicPage({
      title: 'v0 — Walking skeleton',
      parentPageId: 'feature-page',
      parentId: 'automorph',
      businessValue: 'A first mission edited end to end.',
      scope: 'One mission type.',
      version: { changes: ['Edit a mission'] },
      urs: [],
      frs: []
    })

    expect(headings(page)).toEqual(['Business Value', 'Scope', 'What changed in this version', 'Functional Requirements (FR)'])
  })

  it('leaves both out when the spec does not state them', () => {
    const page = renderEpicPage({ title: 'Plain', parentPageId: 'root', businessValue: '  ', urs: [], frs: [] })

    expect(headings(page)).not.toContain('Business Value')
    expect(headings(page)).not.toContain('Scope')
    expect(headings(page)[0]).toBe('Traceability')
  })
})

// #850 — the DS description was written nowhere, and with FRs in versions the feature's UR
// and DS tables could link no FR and its FR table stayed empty
describe('renderEpicPage — a feature whose FRs live in its versions', () => {
  const feature: EpicSpec = {
    title: 'Automorph',
    parentPageId: 'root',
    urs: [{ id: 'UR-1', narrative: 'reshape a mission' }],
    frs: [],
    versionFrs: [
      { id: 'FR-1', title: 'Edit a mission', version: 'v0 — Walking skeleton', priority: 'P1', urRefs: ['UR-1'], dsRefs: ['DS-1'] },
      { id: 'FR-2', title: 'Undo an edit', version: 'v1 — Safety', urRefs: ['UR-1'] }
    ],
    dsItems: [{ id: 'DS-1', title: 'Mission diff', description: 'Edits are stored as a diff against the deployed mission.' }]
  }

  it('links each UR to the version FRs that reference it', () => {
    const urTable = findTableAfterHeading(renderEpicPage(feature).blocks, 'User Requirements (UR)')
    expect(urTable.rows).toEqual([['UR-1', 'reshape a mission', '—', 'FR-1, FR-2']])
  })

  it('lists the version FRs with their version', () => {
    const frTable = findTableAfterHeading(renderEpicPage(feature).blocks, 'Functional Requirements (FR)')
    expect(frTable.header).toEqual(['ID', 'Requirement', 'Version', 'Priority', 'Related UR', 'Related DS'])
    expect(frTable.rows).toEqual([
      ['FR-1', 'Edit a mission', 'v0 — Walking skeleton', 'P1', 'UR-1', 'DS-1'],
      ['FR-2', 'Undo an edit', 'v1 — Safety', '—', 'UR-1', '—']
    ])
  })

  it('writes each DS description and the FRs whose dsRefs point to it', () => {
    const dsTable = findTableAfterHeading(renderEpicPage(feature).blocks, 'Design Specifications (DS)')
    expect(dsTable.rows).toEqual([['DS-1', 'Mission diff', 'Edits are stored as a diff against the deployed mission.', 'FR-1']])
  })
})

// #900 — the UR / DS / TC / NFR items a version or its FRs carry were rendered nowhere
describe('feature page tables with the items its versions bring', () => {
  const feature: EpicSpec = {
    id: 'feat',
    title: 'Réunion live',
    parentPageId: 'root',
    urs: [{ id: 'UR-1', narrative: 'Follow a meeting', priority: 'P1' }],
    frs: [],
    versionFrs: [{ id: 'FR-2', title: 'Topic grouping', urRefs: ['UR-2'], dsRefs: ['DS-1'], version: 'v1 — Topics' }],
    versionItems: {
      urs: [{ id: 'UR-2', narrative: 'See notes by topic', priority: 'P2', version: 'v1 — Topics' }],
      dsItems: [{ id: 'DS-1', title: 'Topic store', description: 'One row per topic', version: 'v1 — Topics' }],
      tcItems: [{ id: 'TC-1', title: 'Topics appear', steps: ['Start a meeting'], expectedResult: 'Topics listed', frRefs: ['FR-2'], version: 'v1 — Topics' }],
      nfrItems: [{ id: 'NFR-1', title: 'Topic latency', target: '≤ 2 s', priority: 'P2', frRefs: ['FR-2'], version: 'v1 — Topics' }]
    }
  }

  it("lists them with their version, after the feature's own items", () => {
    const blocks = renderEpicPage(feature).blocks

    expect(findTableAfterHeading(blocks, 'User Requirements (UR)')).toEqual({
      kind: 'table',
      header: ['ID', 'Requirement', 'Version', 'Priority', 'Related FR'],
      rows: [
        ['UR-1', 'Follow a meeting', '—', 'P1', '—'],
        ['UR-2', 'See notes by topic', 'v1 — Topics', 'P2', 'FR-2']
      ]
    })
    expect(findTableAfterHeading(blocks, 'Design Specifications (DS)').rows).toEqual([['DS-1', 'Topic store', 'v1 — Topics', 'One row per topic', 'FR-2']])
    expect(findTableAfterHeading(blocks, 'Test Cases (TC)').header).toEqual(['ID', 'Title', 'Version', 'Steps', 'Expected Result', 'Related FR'])
    expect(findTableAfterHeading(blocks, 'Non-Functional Requirements (NFR)').rows).toEqual([['NFR-1', 'Topic latency', 'v1 — Topics', '≤ 2 s', 'P2', 'FR-2']])
  })

  it('keeps the shape of a feature whose versions bring none', () => {
    const blocks = renderEpicPage({ ...feature, versionItems: undefined }).blocks

    expect(findTableAfterHeading(blocks, 'User Requirements (UR)').header).toEqual(['ID', 'Requirement', 'Priority', 'Related FR'])
  })

  it('gives an existing feature the same rows, in both shapes its tables may have', () => {
    const additions = featureTableAdditions({ versionFrs: feature.versionFrs, versionItems: feature.versionItems })

    expect(additions.map((addition) => addition.heading)).toEqual([
      'User Requirements (UR)',
      'Functional Requirements (FR)',
      'Design Specifications (DS)',
      'Test Cases (TC)',
      'Non-Functional Requirements (NFR)'
    ])
    expect(additions[0]).toEqual({
      kind: 'table-rows',
      heading: 'User Requirements (UR)',
      layouts: [
        { header: ['ID', 'Requirement', 'Version', 'Priority', 'Related FR'], rows: [['UR-2', 'See notes by topic', 'v1 — Topics', 'P2', 'FR-2']] },
        { header: ['ID', 'Requirement', 'Priority', 'Related FR'], rows: [['UR-2', 'See notes by topic', 'P2', 'FR-2']] }
      ]
    })
    expect(featureTableAdditions({})).toEqual([])
  })
})
