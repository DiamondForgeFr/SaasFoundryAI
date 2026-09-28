import { SrsAdapter } from '../../builders/srs/types'
import { walkSrsTree } from '../tree/walk'
import { SrsFrEntry, SrsInventory } from './types'

// The FR title parser lives with the traversal so that `spawn` and the eval share
// one definition. Re-exported here because this module was its home and callers
// import it from this path.
export { parseFrPageTitle } from '../tree/fr-title'
export type { ParsedFrTitle } from '../tree/fr-title'

/**
 * Flattens the SRS tree into the shape the freshness evaluation scores against.
 *
 * `epics` is the page that directly holds the FRs — the version when a feature is
 * versioned, the feature otherwise. That is the level a board Epic is spawned
 * from, which is why the name survives the move to three levels.
 */
export async function buildSrsInventory(adapter: SrsAdapter, rootPageId: string): Promise<SrsInventory> {
  const tree = await walkSrsTree(adapter, rootPageId)

  const epicsById = new Map<string, { pageId: string; title: string }>()
  for (const fr of tree.frs) {
    if (!epicsById.has(fr.holderPageId)) {
      epicsById.set(fr.holderPageId, { pageId: fr.holderPageId, title: fr.holderTitle })
    }
  }

  const frs: SrsFrEntry[] = tree.frs.map((fr) => ({
    id: fr.id,
    area: fr.area,
    title: fr.title,
    pageId: fr.pageId,
    epicPageId: fr.holderPageId,
    epicTitle: fr.holderTitle,
    featurePageId: fr.featurePageId,
    featureTitle: fr.featureTitle,
    ...(fr.version === undefined ? {} : { version: fr.version })
  }))

  return {
    rootPageId,
    epics: [...epicsById.values()],
    features: tree.features,
    frs,
    conformance: tree.conformance,
    unsupportedCategories: ['UR', 'DS', 'TC', 'NFR'],
    unparsedPages: tree.unparsedPages
  }
}
