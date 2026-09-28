import { SrsConformanceFinding, SrsConformanceKind, SrsTreeFeature, SrsUnparsedPage } from '../tree/walk'

export type DriftSeverity = 'info' | 'warn' | 'error'

export type DriftKind =
  | 'fr-without-code' // FR page has no matching scanner finding
  | 'code-without-fr' // scanner finding has no matching FR page
  | 'fr-untested' // FR matched to endpoint(s) but none have tests
  | 'orphan-area' // scanner area carries endpoints but no FR page exists for it
  | 'unparsed-fr-page' // page sits where an FR was expected but its title yields no FR id — it is NOT scored
  | SrsConformanceKind // structural deviations from root → feature → version → FR

export interface DriftFinding {
  kind: DriftKind
  severity: DriftSeverity
  message: string
  frId?: string
  frTitle?: string
  area?: string
  file?: string
}

export type ImplementationKind = 'endpoint' | 'ui-flow' | 'entity' | 'mixed'

export interface SrsFrEntry {
  id: string // e.g. "FR-AUTH-01-01"
  area: string // normalised area token, e.g. "auth" (lowercase)
  title: string
  pageId: string
  // The page that directly holds this FR — the version when the feature is
  // versioned, the feature itself otherwise. Kept under the `epic` name because
  // `Epic = feature + version`: this is the page a board Epic is spawned from.
  epicPageId: string
  epicTitle: string
  // The feature above the holder, and the version when there is one. On the flat
  // shape `featurePageId === epicPageId` and `version` is absent.
  featurePageId: string
  featureTitle: string
  version?: string
  // L2 declarative hints — optional. When a page author wants to steer the
  // matcher (e.g. a frontend-only FR), they can declare implementationKind
  // and/or areaHints in the FR page body. Inventory builders may populate
  // these; the matcher honours them when set.
  implementationKind?: ImplementationKind
  areaHints?: string[]
}

export interface SrsInventory {
  rootPageId: string
  // Pages that directly hold FRs: the version when a feature is versioned, the
  // feature itself otherwise. This is the Epic level, hence the name.
  epics: Array<{ pageId: string; title: string }>
  // The feature level above the Epics, with the versions found under each.
  features: SrsTreeFeature[]
  frs: SrsFrEntry[]
  // Structural deviations from root → feature → version → FR, named rather than
  // absorbed. `sf srs normalize` (#516) consumes these to make them fixable.
  conformance: SrsConformanceFinding[]
  // Counts the eval cannot compute from the adapter's current RawContent
  // (tables come back empty on fetchPage). Captured for the report so the
  // human output is explicit about what is measured vs. what is not.
  unsupportedCategories: Array<'UR' | 'DS' | 'TC' | 'NFR'>
  // Pages found where an FR was expected whose title does not parse as an FR id.
  // They are excluded from every score, so they must be reported — a silently
  // dropped page is indistinguishable from one that does not exist. A version page
  // under a feature is NOT one of these: it is a level, not a malformed FR.
  unparsedPages?: SrsUnparsedPage[]
}

export interface CategoryScore {
  total: number
  covered: number
  score: number | null // null = "not evaluated" (v1 limit)
  note?: string
}

export interface FreshnessReport {
  generatedAt: string
  rootPageId: string
  thresholdPct: number
  overall: {
    score: number // 0..100
    status: 'fresh' | 'drift'
  }
  categories: {
    UR: CategoryScore
    FR: CategoryScore
    DS: CategoryScore
    TC: CategoryScore
    NFR: CategoryScore
  }
  counts: {
    frTotal: number
    frMatched: number
    frUntested: number
    endpointsTotal: number
    endpointsMatched: number
    endpointsUntested: number
  }
  findings: DriftFinding[]
}

// Review packet — the deterministic summary emitted for agent refinement.
// Tools never call an LLM themselves; they emit this JSON so that a skill
// running in an agent context can dig deeper (e.g. propose a match the
// matcher missed, reclassify a finding, or flag a semantic drift).
export interface ReviewPacketFrEntry {
  id: string
  title: string
  area: string
  pageId: string
  epicPageId: string
  epicTitle: string
  featureTitle: string
  version?: string
  implementationKind?: ImplementationKind
  areaHints?: string[]
  matchCount: number
  matchedFiles: string[]
  status: 'matched' | 'unmatched' | 'untested'
}

export interface ReviewPacketFinding {
  kind: string
  area: string
  file?: string
  title: string
  matchedFrIds: string[]
}

export interface ReviewPacket {
  generatedAt: string
  rootPageId: string
  inventory: {
    epicCount: number
    frCount: number
  }
  frs: ReviewPacketFrEntry[]
  findings: ReviewPacketFinding[]
  drift: DriftFinding[]
  promptHints: string[]
}
