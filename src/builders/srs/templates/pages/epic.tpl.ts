import { DsItem, EpicSpec, FrItem, NfrItem, PageBlock, PageContent, Priority, SectionAddition, TcItem, UrItem } from '../../types'

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

/** The sections of a version page: an FR added to an existing version extends both (#917). */
export const VERSION_HEADINGS = {
  changes: 'What changed in this version',
  frs: FEATURE_HEADINGS.frs
} as const

export const VERSION_FR_HEADER = ['ID', 'Requirement', 'Priority']

/** The line "What changed" gains when an FR joins an existing version, unless the spec words it. */
export function versionChangeLine(fr: Pick<FrItem, 'id' | 'title'>, change?: string): string {
  return change?.trim() || `Adds ${fr.id} — ${fr.title}`
}

/** What a version written in an earlier batch gains from a new FR: its change line and its FR row. */
export function versionFrAdditions(fr: FrItem, change?: string): SectionAddition[] {
  return [
    { kind: 'list-items', heading: VERSION_HEADINGS.changes, items: [versionChangeLine(fr, change)] },
    { kind: 'table-rows', heading: VERSION_HEADINGS.frs, layouts: [{ header: VERSION_FR_HEADER, rows: [[fr.id, fr.title, priorityCell(fr.priority)]] }] }
  ]
}

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

/** The Version column sits third, where #850 put it in the FR table. */
function withVersionColumn(header: string[]): string[] {
  return [...header.slice(0, 2), 'Version', ...header.slice(2)]
}

function withVersionCell(row: string[], version?: string): string[] {
  return [...row.slice(0, 2), version ?? EMPTY_CELL, ...row.slice(2)]
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

interface TableDefinition<T> {
  heading: string
  header: string[]
  empty: string
  /** The feature's own items, then those its versions bring. */
  own: T[]
  fromVersions: Array<T & { version: string }>
  group?: (item: T) => string | undefined
  row: (item: T) => string[]
}

interface RenderedTable {
  heading: string
  header: string[]
  empty: string
  rows: string[][]
  /** The rows of the items its versions bring, in the table's two possible shapes (#900). */
  additions: Array<{ header: string[]; rows: string[][] }>
}

function renderTable<T>(table: TableDefinition<T>): RenderedTable {
  const versioned = table.fromVersions.length > 0
  const group = table.group ?? (() => undefined)
  const items: Array<{ item: T; version?: string }> = [...table.own.map((item) => ({ item })), ...table.fromVersions.map((item) => ({ item, version: item.version }))]
  const rows = buildGroupedRows(
    items,
    (entry) => group(entry.item),
    (entry) => (versioned ? withVersionCell(table.row(entry.item), entry.version) : table.row(entry.item))
  )
  return {
    heading: table.heading,
    header: versioned ? withVersionColumn(table.header) : table.header,
    empty: table.empty,
    rows,
    additions: versioned
      ? [
          { header: withVersionColumn(table.header), rows: buildGroupedRows(table.fromVersions, group, (item) => withVersionCell(table.row(item), item.version)) },
          { header: table.header, rows: buildGroupedRows(table.fromVersions, group, table.row) }
        ]
      : []
  }
}

/**
 * The requirement tables of a feature page. The feature is their register: an item a version
 * or one of its FRs carries is listed with that version, as #850 did for the FRs (#900).
 */
function featureTables(spec: EpicSpec, allFrs: FrItem[]): RenderedTable[] {
  const versionItems = spec.versionItems
  return [
    renderTable<UrItem>({
      heading: FEATURE_HEADINGS.urs,
      header: ['ID', 'Requirement', 'Priority', 'Related FR'],
      empty: 'No user requirements yet.',
      own: spec.urs,
      fromVersions: versionItems?.urs ?? [],
      group: (ur) => ur.group,
      row: (ur) => urRow(ur, allFrs)
    }),
    renderTable<FrItem>({
      heading: FEATURE_HEADINGS.frs,
      header: ['ID', 'Requirement', 'Priority', 'Related UR', 'Related DS'],
      empty: 'No functional requirements yet.',
      own: spec.frs,
      fromVersions: spec.versionFrs ?? [],
      group: (fr) => fr.group,
      row: frRow
    }),
    renderTable<DsItem>({
      heading: FEATURE_HEADINGS.ds,
      header: ['ID', 'Specification', 'Description', 'Related FR'],
      empty: 'No design specifications yet.',
      own: spec.dsItems ?? [],
      fromVersions: versionItems?.dsItems ?? [],
      group: (ds) => ds.group,
      row: (ds) => dsRow(ds, allFrs)
    }),
    renderTable<TcItem>({
      heading: FEATURE_HEADINGS.tc,
      header: ['ID', 'Title', 'Steps', 'Expected Result', 'Related FR'],
      empty: 'No test cases yet.',
      own: spec.tcItems ?? [],
      fromVersions: versionItems?.tcItems ?? [],
      row: tcRow
    }),
    renderTable<NfrItem>({
      heading: FEATURE_HEADINGS.nfr,
      header: ['ID', 'Requirement', 'Target', 'Priority', 'Related FR'],
      empty: 'No non-functional requirements yet.',
      own: spec.nfrItems ?? [],
      fromVersions: versionItems?.nfrItems ?? [],
      group: (nfr) => nfr.group,
      row: nfrRow
    })
  ]
}

/**
 * What a feature written in an earlier batch gains from a new version: the rows of each of
 * its tables, in both shapes a table may have — the feature may predate the Version column.
 */
export function featureTableAdditions(spec: Pick<EpicSpec, 'versionFrs' | 'versionItems'>): SectionAddition[] {
  const allFrs: FrItem[] = spec.versionFrs ?? []
  return featureTables({ title: '', parentPageId: '', urs: [], frs: [], ...spec }, allFrs)
    .filter((table) => table.additions.length > 0)
    .map((table) => ({ kind: 'table-rows', heading: table.heading, layouts: table.additions }))
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

  blocks.push({ kind: 'heading', level: 2, text: VERSION_HEADINGS.changes })
  const changes = spec.version?.changes ?? []
  if (changes.length === 0) {
    // "No … yet." is the shape a later addition replaces in place (#917)
    blocks.push({ kind: 'paragraph', text: 'No changes listed yet.' })
  } else {
    blocks.push({ kind: 'bulleted_list', items: changes })
  }

  blocks.push({ kind: 'heading', level: 2, text: FEATURE_HEADINGS.frs })
  if (spec.frs.length === 0) {
    blocks.push({ kind: 'paragraph', text: 'No functional requirements yet.' })
  } else {
    blocks.push({
      kind: 'table',
      header: VERSION_FR_HEADER,
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

  for (const table of featureTables(spec, allFrs)) {
    blocks.push({ kind: 'heading', level: 2, text: table.heading })
    if (table.rows.length === 0) blocks.push({ kind: 'paragraph', text: table.empty })
    else blocks.push({ kind: 'table', header: table.header, rows: table.rows })
  }

  return { title: spec.title, blocks }
}
