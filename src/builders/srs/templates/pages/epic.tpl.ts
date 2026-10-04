import { DsItem, EpicSpec, FrItem, NfrItem, PageBlock, PageContent, Priority, TcItem, UrItem, VersionFrItem } from '../../types'

const EMPTY_CELL = '—'

/**
 * The section headings of a feature page. `write-srs` adds to these sections on a feature
 * written in an earlier batch (#899, #900), and the spawn parser reads them back: one source.
 */
export const FEATURE_HEADINGS = {
  versions: 'Versions',
  traceability: 'Traceability',
  urs: 'User Requirements (UR)',
  frs: 'Functional Requirements (FR)',
  ds: 'Design Specifications (DS)',
  tc: 'Test Cases (TC)',
  nfr: 'Non-Functional Requirements (NFR)'
} as const

export const VERSIONS_INTRO = 'Each version below holds the FRs that belong to it. Doing the same thing again later means adding a version, not renaming this page.'

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

function versionFrRow(fr: FrItem | VersionFrItem): string[] {
  return [fr.id, fr.title, 'version' in fr ? fr.version : EMPTY_CELL, priorityCell(fr.priority), refsCell(fr.urRefs), refsCell(fr.dsRefs)]
}

/** The FRs a DS lists itself, and the FRs whose `dsRefs` point to it. */
function dsRow(ds: DsItem, allFrs: FrItem[]): string[] {
  const related = [...new Set([...(ds.frRefs ?? []), ...allFrs.filter((fr) => fr.dsRefs?.includes(ds.id)).map((fr) => fr.id)])]
  return [ds.id, ds.title, ds.description?.trim() || EMPTY_CELL, refsCell(related)]
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

/**
 * Why the feature or version exists and what it covers, first on its page and only when
 * the spec states them. Both fields were accepted and written nowhere, so the feature's
 * intent was lost from the SRS (#843).
 */
function intentBlocks(spec: EpicSpec): PageBlock[] {
  const blocks: PageBlock[] = []
  const businessValue = spec.businessValue?.trim()
  if (businessValue) blocks.push({ kind: 'heading', level: 2, text: 'Business Value' }, { kind: 'paragraph', text: businessValue })
  const scope = spec.scope?.trim()
  if (scope) blocks.push({ kind: 'heading', level: 2, text: 'Scope' }, { kind: 'paragraph', text: scope })
  return blocks
}

/**
 * A version page carries what changed and the FRs that belong to it — not the
 * traceability primer, which belongs once per feature rather than once per version.
 */
function renderVersionPage(spec: EpicSpec): PageContent {
  const blocks: PageBlock[] = intentBlocks(spec)

  blocks.push({ kind: 'heading', level: 2, text: 'What changed in this version' })
  const changes = spec.version?.changes ?? []
  if (changes.length === 0) {
    blocks.push({ kind: 'paragraph', text: '_Describe what this version adds or changes relative to the previous one._' })
  } else {
    blocks.push({ kind: 'bulleted_list', items: changes })
  }

  blocks.push({ kind: 'heading', level: 2, text: FEATURE_HEADINGS.frs })
  if (spec.frs.length === 0) {
    blocks.push({ kind: 'paragraph', text: 'No functional requirements yet.' })
  } else {
    blocks.push({
      kind: 'table',
      header: ['ID', 'Requirement', 'Priority'],
      rows: spec.frs.map((fr) => [fr.id, fr.title, priorityCell(fr.priority)])
    })
  }

  return { title: spec.title, blocks }
}

export function renderEpicPage(spec: EpicSpec): PageContent {
  // Position decides the shape, the same rule the traversal reads the tree by.
  if (spec.parentId !== undefined) return renderVersionPage(spec)

  const blocks: PageBlock[] = intentBlocks(spec)
  // A feature's FRs live in its versions: its own `frs` is empty in the three-level model (#850)
  const versionFrs = spec.versionFrs ?? []
  const allFrs: FrItem[] = [...spec.frs, ...versionFrs]

  if (spec.versions && spec.versions.length > 0) {
    blocks.push({ kind: 'heading', level: 2, text: FEATURE_HEADINGS.versions })
    blocks.push({ kind: 'paragraph', text: VERSIONS_INTRO })
    blocks.push({ kind: 'bulleted_list', items: spec.versions })
  }

  blocks.push({ kind: 'heading', level: 2, text: FEATURE_HEADINGS.traceability })
  blocks.push({ kind: 'code', language: 'plain text', text: TRACEABILITY_TREE })
  blocks.push({ kind: 'paragraph', text: TRACEABILITY_NOTE })

  blocks.push({ kind: 'heading', level: 2, text: 'Requirement Types' })
  blocks.push({ kind: 'table', header: ['Prefix', 'Type', 'Description', 'Example'], rows: REQUIREMENT_TYPES_ROWS })

  blocks.push({ kind: 'heading', level: 2, text: FEATURE_HEADINGS.urs })
  if (spec.urs.length === 0) {
    blocks.push({ kind: 'paragraph', text: 'No user requirements yet.' })
  } else {
    blocks.push({
      kind: 'table',
      header: ['ID', 'Requirement', 'Priority', 'Related FR'],
      rows: buildGroupedRows(
        spec.urs,
        (ur) => ur.group,
        (ur) => urRow(ur, allFrs)
      )
    })
  }

  blocks.push({ kind: 'heading', level: 2, text: FEATURE_HEADINGS.frs })
  if (allFrs.length === 0) {
    blocks.push({ kind: 'paragraph', text: 'No functional requirements yet.' })
  } else if (versionFrs.length > 0) {
    blocks.push({
      kind: 'table',
      header: ['ID', 'Requirement', 'Version', 'Priority', 'Related UR', 'Related DS'],
      rows: buildGroupedRows(allFrs, (fr) => fr.group, versionFrRow)
    })
  } else {
    blocks.push({
      kind: 'table',
      header: ['ID', 'Requirement', 'Priority', 'Related UR', 'Related DS'],
      rows: buildGroupedRows(spec.frs, (fr) => fr.group, frRow)
    })
  }

  const dsItems = spec.dsItems ?? []
  blocks.push({ kind: 'heading', level: 2, text: FEATURE_HEADINGS.ds })
  if (dsItems.length === 0) {
    blocks.push({ kind: 'paragraph', text: 'No design specifications yet.' })
  } else {
    blocks.push({
      kind: 'table',
      header: ['ID', 'Specification', 'Description', 'Related FR'],
      rows: buildGroupedRows(
        dsItems,
        (ds) => ds.group,
        (ds) => dsRow(ds, allFrs)
      )
    })
  }

  const tcItems = spec.tcItems ?? []
  blocks.push({ kind: 'heading', level: 2, text: FEATURE_HEADINGS.tc })
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
  blocks.push({ kind: 'heading', level: 2, text: FEATURE_HEADINGS.nfr })
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
