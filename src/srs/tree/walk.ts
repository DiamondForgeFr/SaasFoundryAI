import { PageRef, SrsAdapter } from '../../builders/srs/types'
import { parseFrPageTitle } from './fr-title'

/**
 * The SRS tree is three levels deep:
 *
 *   root ──> feature ──> version ──> FR
 *                   └──> FR            non-conforming, still read
 *
 * `Epic = feature + version`. The board Epic takes the pair as its name; the FR
 * pages below the version become its tickets.
 *
 * Two rules the previous two-call walk did not honour:
 *
 * 1. **The level comes from position in the tree, never from the title.** A version
 *    is called `MVP`, `V1` or `v2 — Titre` depending on who wrote it, so any
 *    `v\d+` heuristic is wrong by construction.
 * 2. **Depth is mixed in practice.** On the live SRS 8 features are versioned and
 *    25 hold their FRs directly, so a fix keyed on "descend one more level" loses
 *    the flat half exactly as the old walk lost the deep half.
 *
 * FR pages are leaves and are never descended into, which keeps the call count at
 * one `listChildren` per non-FR page.
 */

export type SrsConformanceKind =
  /** Feature carries FRs directly: it has no version page, so it has no Epic identity. */
  | 'feature-without-version'
  /** Feature yields no FR at all — neither directly nor through a version. */
  | 'feature-without-frs'
  /** A page sits where an FR was expected (under a version) and does not parse as one. */
  | 'unexpected-page-under-version'
  /**
   * A version page holds no FR at all. Not in the original scope, but the walk would
   * otherwise absorb a real deviation: because the level is read from position, a stray
   * page dropped beside a feature's FRs is indistinguishable from an empty version, and
   * the two-call walk used to report it as `unparsed-fr-page`. Naming it keeps that
   * signal instead of trading one silent drop for another.
   */
  | 'version-without-frs'
  /** An FR page sits directly under the root, with no feature above it. */
  | 'fr-at-root-level'
  /** A page sits below the FR level — deeper than the model allows. */
  | 'nesting-too-deep'

export interface SrsConformanceFinding {
  kind: SrsConformanceKind
  pageId: string
  title: string
  featureTitle?: string
  versionTitle?: string
  message: string
}

export interface SrsTreeVersion {
  pageId: string
  title: string
  url: string
  frCount: number
}

export interface SrsTreeFeature {
  pageId: string
  title: string
  url: string
  versions: SrsTreeVersion[]
  /** FRs reachable under this feature, through its versions or directly. */
  frCount: number
  /** True when the feature holds its FRs under version pages, as the model requires. */
  conforming: boolean
}

export interface SrsTreeFr {
  id: string
  area: string
  title: string
  pageId: string
  url: string
  featurePageId: string
  featureTitle: string
  /** Title of the version page holding this FR — absent on the flat shape. */
  version?: string
  versionPageId?: string
  /** The page that directly holds this FR: the version when there is one, the feature otherwise. */
  holderPageId: string
  holderTitle: string
}

export interface SrsUnparsedPage {
  pageId: string
  title: string
  /** The page that holds it — a version, or a feature on the flat shape. */
  holderTitle: string
}

export interface SrsTree {
  rootPageId: string
  features: SrsTreeFeature[]
  frs: SrsTreeFr[]
  conformance: SrsConformanceFinding[]
  /**
   * Pages that genuinely fail the FR convention **where an FR was expected**. A
   * version page under a feature is not one of these — it is a level, not a
   * malformed FR. Reporting the 13 real version pages as unparseable is what made
   * this bug look like a data problem rather than a walk problem.
   */
  unparsedPages: SrsUnparsedPage[]
}

/**
 * Holder title used for an FR found directly under the root. `listChildren` never
 * returns the root's own title, and fetching it would cost a call for a shape that
 * should not exist — the accompanying `fr-at-root-level` finding carries the detail.
 */
const ROOT_HOLDER_TITLE = 'SRS root'

export async function walkSrsTree(adapter: SrsAdapter, rootPageId: string): Promise<SrsTree> {
  const features: SrsTreeFeature[] = []
  const frs: SrsTreeFr[] = []
  const conformance: SrsConformanceFinding[] = []
  const unparsedPages: SrsUnparsedPage[] = []

  const rootChildren = await adapter.listChildren(rootPageId)

  for (const rootChild of rootChildren) {
    const asFr = parseFrPageTitle(rootChild.title)

    // An FR directly under the root belongs to no feature. Record it rather than
    // drop it — the whole point of this walk is to name deviations, not absorb them.
    if (asFr) {
      conformance.push({
        kind: 'fr-at-root-level',
        pageId: rootChild.id,
        title: rootChild.title,
        message: `FR page "${rootChild.title}" sits directly under the root — it belongs to no feature and cannot be spawned as part of an Epic`
      })
      frs.push({
        ...asFr,
        pageId: rootChild.id,
        url: rootChild.url,
        featurePageId: rootPageId,
        featureTitle: ROOT_HOLDER_TITLE,
        holderPageId: rootPageId,
        holderTitle: ROOT_HOLDER_TITLE
      })
      continue
    }

    const feature = await walkFeature(adapter, rootChild, frs, conformance, unparsedPages)
    features.push(feature)
  }

  return { rootPageId, features, frs, conformance, unparsedPages }
}

async function walkFeature(adapter: SrsAdapter, featureRef: PageRef, frs: SrsTreeFr[], conformance: SrsConformanceFinding[], unparsedPages: SrsUnparsedPage[]): Promise<SrsTreeFeature> {
  const children = await adapter.listChildren(featureRef.id)
  const versions: SrsTreeVersion[] = []
  let directFrCount = 0

  for (const child of children) {
    const asFr = parseFrPageTitle(child.title)

    if (asFr) {
      // Flat shape: the feature holds its FRs directly. Read it — 25 real features
      // are in this state and their FRs must not be lost — and let the conformance
      // pass below say so.
      directFrCount++
      frs.push({
        ...asFr,
        pageId: child.id,
        url: child.url,
        featurePageId: featureRef.id,
        featureTitle: featureRef.title,
        holderPageId: featureRef.id,
        holderTitle: featureRef.title
      })
      continue
    }

    // Not an FR at this level means a version page. The level is read from position:
    // the page is a child of a feature, so it is a version whatever it is called.
    const version = await walkVersion(adapter, featureRef, child, frs, conformance, unparsedPages)
    versions.push(version)
  }

  const frCount = directFrCount + versions.reduce((sum, v) => sum + v.frCount, 0)

  if (frCount === 0) {
    conformance.push({
      kind: 'feature-without-frs',
      pageId: featureRef.id,
      title: featureRef.title,
      featureTitle: featureRef.title,
      message: `Feature "${featureRef.title}" carries no FR page${versions.length > 0 ? ` under any of its ${versions.length} version page(s)` : ''}`
    })
  }

  if (directFrCount > 0) {
    // Two shapes reach this branch: a purely flat feature (25 real cases) and a
    // feature that mixes direct FRs with version pages (0 real cases). Both mean
    // the same defect — FRs that belong to no version — so they share a kind, and
    // the message distinguishes them for `sf srs normalize`.
    const detail =
      versions.length > 0
        ? `${directFrCount} FR page(s) sit beside its ${versions.length} version page(s) instead of under one of them`
        : `it holds its ${directFrCount} FR page(s) directly, with no version page`
    conformance.push({
      kind: 'feature-without-version',
      pageId: featureRef.id,
      title: featureRef.title,
      featureTitle: featureRef.title,
      message: `Feature "${featureRef.title}" is not versioned — ${detail}`
    })
  }

  return {
    pageId: featureRef.id,
    title: featureRef.title,
    url: featureRef.url,
    versions,
    frCount,
    conforming: directFrCount === 0 && frCount > 0
  }
}

async function walkVersion(
  adapter: SrsAdapter,
  featureRef: PageRef,
  versionRef: PageRef,
  frs: SrsTreeFr[],
  conformance: SrsConformanceFinding[],
  unparsedPages: SrsUnparsedPage[]
): Promise<SrsTreeVersion> {
  const children = await adapter.listChildren(versionRef.id)
  let frCount = 0

  for (const child of children) {
    const asFr = parseFrPageTitle(child.title)

    if (asFr) {
      frCount++
      frs.push({
        ...asFr,
        pageId: child.id,
        url: child.url,
        featurePageId: featureRef.id,
        featureTitle: featureRef.title,
        version: versionRef.title,
        versionPageId: versionRef.id,
        holderPageId: versionRef.id,
        holderTitle: versionRef.title
      })
      continue
    }

    // Under a version an FR was expected, so this page is both structurally
    // unexpected and excluded from every score. It is recorded in both lists on
    // purpose: `conformance` drives `sf srs normalize`, `unparsedPages` drives the
    // freshness report. The matcher renders only the latter, so the page produces
    // one drift finding, not two.
    conformance.push({
      kind: 'unexpected-page-under-version',
      pageId: child.id,
      title: child.title,
      featureTitle: featureRef.title,
      versionTitle: versionRef.title,
      message: `Page "${child.title}" under version "${versionRef.title}" of "${featureRef.title}" is neither an FR nor a version`
    })
    unparsedPages.push({ pageId: child.id, title: child.title, holderTitle: versionRef.title })

    // The model bottoms out at the FR level. Probing only the pages already flagged
    // unexpected keeps the extra call count tied to the defect count — zero on a
    // conforming SRS — instead of to the size of the tree.
    const deeper = await adapter.listChildren(child.id)
    if (deeper.length > 0) {
      // Say how many of those buried pages are FRs. "carries 3 child pages" reads as
      // untidiness; "3 of them are FR pages, none of which are scored" is the actual cost.
      const buriedFrs = deeper.filter((page) => parseFrPageTitle(page.title) !== null).length
      const cost = buriedFrs > 0 ? `, ${buriedFrs} of them FR page(s) that no score will ever see` : ''
      conformance.push({
        kind: 'nesting-too-deep',
        pageId: child.id,
        title: child.title,
        featureTitle: featureRef.title,
        versionTitle: versionRef.title,
        message: `Page "${child.title}" sits below the FR level and carries ${deeper.length} child page(s)${cost} — the SRS model stops at root → feature → version → FR`
      })
    }
  }

  if (frCount === 0) {
    conformance.push({
      kind: 'version-without-frs',
      pageId: versionRef.id,
      title: versionRef.title,
      featureTitle: featureRef.title,
      versionTitle: versionRef.title,
      message: `Version "${versionRef.title}" of "${featureRef.title}" holds no FR page — either it is an empty version, or the page is not a version at all`
    })
  }

  return { pageId: versionRef.id, title: versionRef.title, url: versionRef.url, frCount }
}
