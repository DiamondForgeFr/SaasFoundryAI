import type { PageRef, PageScan, SrsAdapter } from '../builders/srs/types'

export const REQUIREMENT_CATEGORIES = ['UR', 'FR', 'DS', 'TC', 'NFR'] as const
export type RequirementCategory = (typeof REQUIREMENT_CATEGORIES)[number]

// Each area segment carries a letter, so the numbers stay out of the area: `TC-LOAN-001-1` is
// numbered 001 in LOAN, as `parseFrPageTitle` reads an FR id.
const AREA = '[A-Z0-9]*[A-Z][A-Z0-9]*(?:-[A-Z0-9]*[A-Z][A-Z0-9]*)*'
const ID = `(?:UR|FR|DS|TC|NFR)-${AREA}(?:-\\d+)+`
const REQUIREMENT_ID_RE = new RegExp(`^(UR|FR|DS|TC|NFR)-(${AREA})-(\\d+)(?:-\\d+)*$`, 'i')
/** An id opening a cell or a page title: `FR-LOAN-014 — Renew a loan`. */
const LEADING_ID_RE = new RegExp(`^\\s*(${ID})\\b`, 'i')
/** An id anywhere in a text, as the SRS writes them: upper case, so a word is never read as one. */
const ID_IN_TEXT_RE = new RegExp(`\\b${ID}\\b`, 'g')
const VERSION_NUMBER_RE = /^v(\d+)\b/i
/** A table whose first column is this one lists requirements: each row defines the id it opens with. */
const REQUIREMENT_TABLE_FIRST_HEADER = 'id'
/** The feature page's primer table: its rows name the categories, not requirements. */
const PRIMER_TABLE_FIRST_HEADER = 'prefix'
/** Pages read at once: the FR pages of a large feature are many, and the backend limits its rate. */
const READ_CONCURRENCY = 3

/**
 * What a feature written in an earlier batch already holds: the titles of its versions and
 * every requirement id its pages define or mention. Two sessions extending one feature a minute
 * apart each took "the next free ids" from their own reading, and both wrote them (#919): the
 * guard re-reads this right before writing.
 */
export interface FeatureRegister {
  versionTitles: string[]
  /** Every id written on the feature's pages, defined there or not: none of them is free. */
  ids: Record<RequirementCategory, Set<string>>
  /**
   * The ids no table row and no page title defines, with the page each was found on: a row the
   * feature tables miss (#991), an id planned in advance, or one cited from another feature.
   */
  mentions: Map<string, string>
  /**
   * The areas the feature numbers its own requirements in (`LOAN` in `UR-LOAN-001`): those of
   * the ids it defines. An id cited from another feature (a related `DS-MEMBER-045`) is not
   * free, but its area gets no next id here.
   */
  areas: Set<string>
  /**
   * The FR ids a version page lists while no FR page carries them and no feature table lists
   * them, by version page id: what a batch that stopped halfway leaves. Attaching that FR to
   * that version completes it.
   */
  announcedFrs: Map<string, Set<string>>
}

function emptyIds(): Record<RequirementCategory, Set<string>> {
  return Object.fromEntries(REQUIREMENT_CATEGORIES.map((category) => [category, new Set<string>()])) as Record<RequirementCategory, Set<string>>
}

async function mapLimited<T, R>(items: T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await map(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function scanPage(adapter: SrsAdapter, pageId: string): Promise<PageScan> {
  if (adapter.scanPage) return adapter.scanPage(pageId)
  const [page, childPages] = await Promise.all([adapter.fetchPage(pageId), adapter.listChildren(pageId)])
  return { blocks: page.blocks, childPages }
}

const normalizedId = (raw: string): string => raw.trim().toUpperCase()
const leadingId = (text: string | undefined): string | undefined => text?.match(LEADING_ID_RE)?.[1].toUpperCase()

/** The ids one page holds: those its requirement tables define, and every one it writes. */
function idsOnPage(scan: PageScan): { defined: Set<string>; written: Set<string> } {
  const defined = new Set<string>()
  const written = new Set<string>()
  const read = (text: string | undefined): void => {
    for (const match of text?.matchAll(ID_IN_TEXT_RE) ?? []) written.add(match[0])
  }
  for (const block of scan.blocks) {
    read(block.text)
    const rows = block.rows ?? []
    const firstHeader = rows[0]?.[0]?.trim().toLowerCase()
    if (firstHeader === PRIMER_TABLE_FIRST_HEADER) continue
    for (const row of rows) for (const cell of row) read(cell)
    if (firstHeader !== REQUIREMENT_TABLE_FIRST_HEADER) continue
    for (const row of rows.slice(1)) {
      const id = leadingId(row[0])
      if (id) defined.add(id)
    }
  }
  return { defined, written }
}

/**
 * Reads every page of the feature: the feature page, its version pages, the FR pages and any
 * page below them. An id counts wherever it is written — a table cell, a heading, a paragraph,
 * a list item, a page title — because the SRS holds ids the feature tables never listed: rows
 * added by hand, a `DS-…` section inside a revised FR page, the Related cells of an FR, the
 * tables of an early version page (#991). A page that cannot be read fails the reading: an
 * incomplete register would hand out ids already in use.
 */
export async function readFeatureRegister(adapter: SrsAdapter, featurePageId: string): Promise<FeatureRegister> {
  const defined = new Set<string>()
  const mentions = new Map<string, string>()
  const onFeaturePage = new Set<string>()
  const inTitles = new Set<string>()
  const frsByVersion = new Map<string, string[]>()
  const versions: PageRef[] = []

  const seen = new Set([featurePageId])
  let level: PageRef[] = [{ id: featurePageId, url: '', title: 'the feature page' }]
  for (let depth = 0; level.length > 0; depth++) {
    const scans = await mapLimited(level, READ_CONCURRENCY, (page) => scanPage(adapter, page.id))
    level.forEach((page, index) => {
      const onPage = idsOnPage(scans[index])
      const ownId = depth > 0 ? leadingId(page.title) : undefined
      if (ownId) {
        defined.add(ownId)
        inTitles.add(ownId)
      }
      for (const id of onPage.defined) {
        defined.add(id)
        if (depth === 0) onFeaturePage.add(id)
      }
      if (depth === 1) {
        versions.push(page)
        frsByVersion.set(
          page.id,
          [...onPage.defined].filter((id) => id.startsWith('FR-'))
        )
      }
      const inTitle = depth > 0 ? [...page.title.matchAll(ID_IN_TEXT_RE)].map((match) => match[0]) : []
      for (const id of [...inTitle, ...onPage.written]) if (!mentions.has(id)) mentions.set(id, page.title)
    })
    level = scans.flatMap((scan) => scan.childPages).filter((page) => !seen.has(page.id) && seen.add(page.id))
  }

  const ids = emptyIds()
  const areas = new Set<string>()
  // `TC-LOAN-001-1` also holds `TC-LOAN-001`: writing that one again would read as its parent
  for (const id of [...defined, ...mentions.keys()]) {
    const [, category, area, number] = id.match(REQUIREMENT_ID_RE)!
    const base = `${category}-${area}-${number}`
    ids[category as RequirementCategory].add(id).add(base)
    if (defined.has(id)) {
      areas.add(area)
      defined.add(base)
    } else if (!mentions.has(base)) mentions.set(base, mentions.get(id)!)
  }
  for (const id of defined) mentions.delete(id)

  const announcedFrs = new Map([...frsByVersion].map(([pageId, frs]) => [pageId, new Set(frs.filter((id) => !inTitles.has(id) && !onFeaturePage.has(id)))]))
  return { versionTitles: versions.map((version) => version.title), ids, mentions, areas, announcedFrs }
}

/**
 * Which of the declared ids the feature already holds, as an error message names them. An id
 * the feature only mentions is refused too: its row may be the one the tables miss (#991), and
 * an id cited from another feature exists there. The page it was found on is named, so an id
 * planned in advance can be told apart.
 */
export function describeHeldIds(register: FeatureRegister, declared: [RequirementCategory, string][]): { clashes: string[]; note: string } {
  const held = new Set(declared.filter(([category, id]) => id && register.ids[category].has(normalizedId(id))).map(([, id]) => normalizedId(id)))
  const clashes = [...held].map((id) => (register.mentions.has(id) ? `${id} (no row of its own, found on "${register.mentions.get(id)}")` : id))
  const note = [...held].some((id) => register.mentions.has(id))
    ? ' An id with no row of its own is taken all the same: its row is missing, or it belongs to another feature. If it is meant for this content, leave it out of the batch and add it with `sf srs apply-update`.'
    : ''
  return { clashes, note }
}

/**
 * The next free id per category and area, after the highest number already used. Only the
 * feature's own areas get one; a register that defines no id gives every area it mentions.
 */
export function nextFreeIds(register: FeatureRegister): Record<RequirementCategory, string[]> {
  const next = Object.fromEntries(REQUIREMENT_CATEGORIES.map((category) => [category, [] as string[]])) as Record<RequirementCategory, string[]>
  const owns = (area: string): boolean => register.areas.size === 0 || register.areas.has(area)
  for (const category of REQUIREMENT_CATEGORIES) {
    const highest = new Map<string, { number: number; width: number }>()
    for (const id of register.ids[category]) {
      const match = id.match(REQUIREMENT_ID_RE)
      if (!match) continue
      const area = match[2].toUpperCase()
      if (!owns(area)) continue
      const number = Number(match[3])
      const known = highest.get(area)
      if (!known || number > known.number) highest.set(area, { number, width: Math.max(match[3].length, known?.width ?? 0) })
    }
    for (const [area, { number, width }] of [...highest].sort(([a], [b]) => a.localeCompare(b))) next[category].push(`${category}-${area}-${String(number + 1).padStart(width, '0')}`)
  }
  return next
}

/** `v<n+1>` after the highest `v<n>` a version title starts with; `v1` for a feature with none. */
export function nextVersionLabel(register: FeatureRegister): string {
  const numbers = register.versionTitles.map((title) => Number(title.trim().match(VERSION_NUMBER_RE)?.[1] ?? 0))
  return `v${Math.max(0, ...numbers) + 1}`
}

/** One line per category that has ids, for an error message or a terminal. */
export function describeNextIds(register: FeatureRegister): string {
  const next = nextFreeIds(register)
  const parts = REQUIREMENT_CATEGORIES.filter((category) => next[category].length > 0).map((category) => next[category].join(', '))
  return [`next version: ${nextVersionLabel(register)}`, ...(parts.length > 0 ? [`next ids: ${parts.join(', ')}`] : [])].join('; ')
}
