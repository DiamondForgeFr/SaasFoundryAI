import { DsItem, EpicSpec, FrItem, NfrItem, PageBlock, PageContent, Priority, TcItem, UrItem } from '../../types'

const EMPTY_CELL = '—'

function refsCell(refs?: string[]): string {
  return refs && refs.length > 0 ? refs.join(', ') : EMPTY_CELL
}

function priorityCell(priority?: Priority): string {
  return priority ?? EMPTY_CELL
}

const REQUIREMENT_TYPES_ROWS: string[][] = [
  ['UR', 'User Requirement', "High-level user need describing what the user wants to achieve. Written from the user's perspective.", '"The user must be able to log in to access the product"'],
  ['FR', 'Functional Requirement', 'What the system must do to fulfill user requirements. Describes system behavior.', '"The system displays a generic error message on login failure"'],
  ['DS', 'Design Specification', 'How the system implements the functional requirements. Technical implementation details.', '"JWT tokens stored in httpOnly cookies"'],
  [
    'TC',
    'Test Case',
    'Verifiable steps that prove a functional requirement is satisfied. Bridges spec and QA.',
    '"Given valid credentials, when user submits login form, then 200 OK and JWT cookie set"'
  ],
  ['NFR', 'Non-Functional Requirement', 'Quality attributes: performance, security, availability, scalability.', '"Login response time ≤ 1 second (p95)"']
]

const TRACEABILITY_TREE = `UR (User Requirement)
  └── FR (Functional Requirement)
        ├── DS (Design Specification)
        ├── TC (Test Case)
        └── NFR (Non-Functional Requirement)`

const TRACEABILITY_NOTE = 'Each lower-level requirement traces back to a higher-level requirement, ensuring complete coverage and compliance traceability.'

function groupHeaderRow(groupId: string, columnCount: number): string[] {
  const row = [groupId]
  while (row.length < columnCount) row.push('')
  return row
}

function buildGroupedRows<T>(items: T[], getGroup: (item: T) => string | undefined, getRow: (item: T) => string[]): string[][] {
  if (items.length === 0) return []
  const columnCount = getRow(items[0]).length
  const rows: string[][] = []
  let lastGroup: string | undefined
  for (const item of items) {
    const group = getGroup(item)
    if (group && group !== lastGroup) {
      rows.push(groupHeaderRow(group, columnCount))
    }
    lastGroup = group
    rows.push(getRow(item))
  }
  return rows
}

function urRow(ur: UrItem, allFrs: FrItem[]): string[] {
  const relatedFrs = allFrs.filter((fr) => fr.urRefs?.includes(ur.id)).map((fr) => fr.id)
  return [ur.id, ur.narrative, priorityCell(ur.priority), refsCell(relatedFrs.length > 0 ? relatedFrs : undefined)]
}

function frRow(fr: FrItem): string[] {
  return [fr.id, fr.title, priorityCell(fr.priority), refsCell(fr.urRefs), refsCell(fr.dsRefs)]
}

function dsRow(ds: DsItem): string[] {
  return [ds.id, ds.title, refsCell(ds.frRefs)]
}

function nfrRow(nfr: NfrItem): string[] {
  return [nfr.id, nfr.title, nfr.target ?? EMPTY_CELL, priorityCell(nfr.priority), refsCell(nfr.frRefs)]
}

function listCell(items?: string[]): string {
  if (!items || items.length === 0) return EMPTY_CELL
  return items.map((item) => `• ${item}`).join('\n')
}

function tcRow(tc: TcItem): string[] {
  return [tc.id, tc.title, listCell(tc.steps), tc.expectedResult ?? EMPTY_CELL, refsCell(tc.frRefs)]
}

export function renderEpicPage(spec: EpicSpec): PageContent {
  const blocks: PageBlock[] = []

  blocks.push({ kind: 'heading', level: 2, text: 'Traceability' })
  blocks.push({ kind: 'code', language: 'plain text', text: TRACEABILITY_TREE })
  blocks.push({ kind: 'paragraph', text: TRACEABILITY_NOTE })

  blocks.push({ kind: 'heading', level: 2, text: 'Requirement Types' })
  blocks.push({ kind: 'table', header: ['Prefix', 'Type', 'Description', 'Example'], rows: REQUIREMENT_TYPES_ROWS })

  blocks.push({ kind: 'heading', level: 2, text: 'User Requirements (UR)' })
  if (spec.urs.length === 0) {
    blocks.push({ kind: 'paragraph', text: 'No user requirements yet.' })
  } else {
    blocks.push({
      kind: 'table',
      header: ['ID', 'Requirement', 'Priority', 'Related FR'],
      rows: buildGroupedRows(
        spec.urs,
        (ur) => ur.group,
        (ur) => urRow(ur, spec.frs)
      )
    })
  }

  blocks.push({ kind: 'heading', level: 2, text: 'Functional Requirements (FR)' })
  if (spec.frs.length === 0) {
    blocks.push({ kind: 'paragraph', text: 'No functional requirements yet.' })
  } else {
    blocks.push({
      kind: 'table',
      header: ['ID', 'Requirement', 'Priority', 'Related UR', 'Related DS'],
      rows: buildGroupedRows(spec.frs, (fr) => fr.group, frRow)
    })
  }

  const dsItems = spec.dsItems ?? []
  blocks.push({ kind: 'heading', level: 2, text: 'Design Specifications (DS)' })
  if (dsItems.length === 0) {
    blocks.push({ kind: 'paragraph', text: 'No design specifications yet.' })
  } else {
    blocks.push({
      kind: 'table',
      header: ['ID', 'Specification', 'Related FR'],
      rows: buildGroupedRows(dsItems, (ds) => ds.group, dsRow)
    })
  }

  const tcItems = spec.tcItems ?? []
  blocks.push({ kind: 'heading', level: 2, text: 'Test Cases (TC)' })
  if (tcItems.length === 0) {
    blocks.push({ kind: 'paragraph', text: 'No test cases yet.' })
  } else {
    blocks.push({
      kind: 'table',
      header: ['ID', 'Title', 'Steps', 'Expected Result', 'Related FR'],
      rows: tcItems.map(tcRow)
    })
  }

  const nfrItems = spec.nfrItems ?? []
  blocks.push({ kind: 'heading', level: 2, text: 'Non-Functional Requirements (NFR)' })
  if (nfrItems.length === 0) {
    blocks.push({ kind: 'paragraph', text: 'No non-functional requirements yet.' })
  } else {
    blocks.push({
      kind: 'table',
      header: ['ID', 'Requirement', 'Target', 'Priority', 'Related FR'],
      rows: buildGroupedRows(nfrItems, (nfr) => nfr.group, nfrRow)
    })
  }

  return { title: spec.title, blocks }
}
