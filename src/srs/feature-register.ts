import type { SrsAdapter } from '../builders/srs/types'
import { parseFrPageTitle } from './tree/fr-title'

export const REQUIREMENT_CATEGORIES = ['UR', 'FR', 'DS', 'TC', 'NFR'] as const
export type RequirementCategory = (typeof REQUIREMENT_CATEGORIES)[number]

const REQUIREMENT_ID_RE = /^(UR|FR|DS|TC|NFR)-([A-Z0-9]+(?:-[A-Z0-9]+)*?)-(\d+)$/i
const VERSION_NUMBER_RE = /^v(\d+)\b/i

/**
 * What a feature written in an earlier batch already holds: the titles of its versions and
 * every requirement id it lists. Two sessions extending one feature a minute apart each took
 * "the next free ids" from their own reading, and both wrote them (#919): the guard re-reads
 * this right before writing.
 */
export interface FeatureRegister {
  versionTitles: string[]
  ids: Record<RequirementCategory, Set<string>>
}

/**
 * Reads the feature's tables (the first cell of each row is the requirement id) and the FR
 * pages under its versions, whose titles carry the FR id even when a table missed the row.
 */
export async function readFeatureRegister(adapter: SrsAdapter, featurePageId: string): Promise<FeatureRegister> {
  const ids = Object.fromEntries(REQUIREMENT_CATEGORIES.map((category) => [category, new Set<string>()])) as Record<RequirementCategory, Set<string>>
  const record = (raw: string): void => {
    const id = raw.trim().toUpperCase()
    const match = id.match(REQUIREMENT_ID_RE)
    if (match) ids[match[1] as RequirementCategory].add(id)
  }

  const page = await adapter.fetchPage(featurePageId)
  for (const block of page.blocks) for (const row of (block.rows ?? []).slice(1)) if (row[0]) record(row[0])

  const versions = await adapter.listChildren(featurePageId)
  for (const version of versions) {
    for (const child of await adapter.listChildren(version.id)) {
      const parsed = parseFrPageTitle(child.title)
      if (parsed) record(parsed.id)
    }
  }
  return { versionTitles: versions.map((version) => version.title), ids }
}

/** The next free id per category and area, after the highest number already used. */
export function nextFreeIds(register: FeatureRegister): Record<RequirementCategory, string[]> {
  const next = Object.fromEntries(REQUIREMENT_CATEGORIES.map((category) => [category, [] as string[]])) as Record<RequirementCategory, string[]>
  for (const category of REQUIREMENT_CATEGORIES) {
    const highest = new Map<string, { number: number; width: number }>()
    for (const id of register.ids[category]) {
      const match = id.match(REQUIREMENT_ID_RE)
      if (!match) continue
      const area = match[2].toUpperCase()
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
