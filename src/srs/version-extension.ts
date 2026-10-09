import { featureTableAdditions, versionFrAdditions } from '../builders/srs/templates/pages/epic.tpl'
import type { DsItem, FrSpec, NfrItem, SectionAddition, SrsAdapter, TcItem, UrItem, VersionItems } from '../builders/srs/types'
import { SrsTree, walkSrsTree } from './tree/walk'

const normalized = (id: string): string => id.replace(/-/g, '').toLowerCase()

/** Where a page sits in the SRS: the feature it belongs to, and its version when it has one. */
export interface PageLocation {
  level: 'feature' | 'version' | 'fr'
  featurePageId: string
  featureTitle: string
  versionPageId?: string
  versionTitle?: string
}

/**
 * Finds a page in the SRS tree. Position decides the level, never the title: a direct child
 * of the root is a feature, a child of a feature is a version, an FR page is found by its id.
 */
export function locatePage(tree: SrsTree, pageId: string): PageLocation | undefined {
  const id = normalized(pageId)
  for (const feature of tree.features) {
    if (normalized(feature.pageId) === id) return { level: 'feature', featurePageId: feature.pageId, featureTitle: feature.title }
    const version = feature.versions.find((candidate) => normalized(candidate.pageId) === id)
    if (version) return { level: 'version', featurePageId: feature.pageId, featureTitle: feature.title, versionPageId: version.pageId, versionTitle: version.title }
  }
  const fr = tree.frs.find((candidate) => normalized(candidate.pageId) === id)
  if (fr) return { level: 'fr', featurePageId: fr.featurePageId, featureTitle: fr.featureTitle, versionPageId: fr.versionPageId, versionTitle: fr.version }
  return undefined
}

/** Reads the tree once for every page a batch or a patch needs to place. */
export async function readSrsTree(adapter: SrsAdapter, rootPageId: string | undefined): Promise<SrsTree | undefined> {
  if (!rootPageId) return undefined
  return walkSrsTree(adapter, rootPageId)
}

/**
 * Adds to a page in place and returns what it could not place. A backend that cannot edit an
 * existing page places nothing; the caller says what is left to add by hand.
 */
async function extend(adapter: SrsAdapter, pageId: string, additions: SectionAddition[], label: string): Promise<string[]> {
  if (additions.length === 0) return []
  if (!adapter.extendSections) return additions.map((addition) => `${label}: add to "${addition.heading}" by hand — this SRS backend cannot edit an existing page.`)
  const outcomes = await adapter.extendSections(pageId, additions)
  return additions.filter((_, index) => outcomes[index] === 'unplaced').map((addition) => `${label}: "${addition.heading}" was not found on the page — add it by hand.`)
}

/**
 * An FR joining a version written in an earlier batch (#917): the version page gains its change
 * line and its FR row, and the feature gains its FR row and the UR / DS / TC rows it carries,
 * each with the version. Returns what could not be placed.
 */
export async function placeFrInExistingVersion(adapter: SrsAdapter, location: PageLocation, spec: FrSpec): Promise<string[]> {
  if (location.level !== 'version' || !location.versionPageId || !location.versionTitle)
    return [`${spec.fr.id}: its parent page is not a version of this SRS, so no version or feature table lists it.`]
  const version = location.versionTitle
  const items: VersionItems = {
    urs: (spec.urs ?? []).map((item) => ({ ...item, version })),
    dsItems: (spec.dsItems ?? []).map((item) => ({ ...item, version })),
    tcItems: (spec.tcItems ?? []).map((item) => ({ ...item, version })),
    nfrItems: []
  }
  return [
    ...(await extend(adapter, location.versionPageId, versionFrAdditions(spec.fr, spec.change), `${spec.fr.id} on "${version}"`)),
    ...(await extend(adapter, location.featurePageId, featureTableAdditions({ versionFrs: [{ ...spec.fr, version }], versionItems: items }), `${spec.fr.id} on "${location.featureTitle}"`))
  ]
}

export type RequirementItem = { kind: 'ur'; item: UrItem } | { kind: 'ds'; item: DsItem } | { kind: 'tc'; item: TcItem } | { kind: 'nfr'; item: NfrItem }

/**
 * A UR / DS / TC / NFR added after the fact goes to its table on the feature page, with the
 * version of the page it was added from — where `write` puts the same item (#900, #917).
 */
export async function placeItemInFeature(adapter: SrsAdapter, location: PageLocation, requirement: RequirementItem): Promise<string[]> {
  const version = location.versionTitle ?? '—'
  const items: VersionItems = { urs: [], dsItems: [], tcItems: [], nfrItems: [] }
  if (requirement.kind === 'ur') items.urs.push({ ...requirement.item, version })
  else if (requirement.kind === 'ds') items.dsItems.push({ ...requirement.item, version })
  else if (requirement.kind === 'tc') items.tcItems.push({ ...requirement.item, version })
  else items.nfrItems.push({ ...requirement.item, version })
  return extend(adapter, location.featurePageId, featureTableAdditions({ versionItems: items }), `${requirement.item.id} on "${location.featureTitle}"`)
}
