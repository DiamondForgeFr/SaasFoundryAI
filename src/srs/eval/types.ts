export type DriftSeverity = 'info' | 'warn' | 'error'

export type DriftKind =
  | 'fr-without-code' // FR page has no matching scanner finding
  | 'code-without-fr' // scanner finding has no matching FR page
  | 'fr-untested' // FR matched to endpoint(s) but none have tests
  | 'orphan-area' // scanner area carries endpoints but no FR page exists for it

export interface DriftFinding {
  kind: DriftKind
  severity: DriftSeverity
  message: string
  frId?: string
  frTitle?: string
  area?: string
  file?: string
}

export interface SrsFrEntry {
  id: string // e.g. "FR-AUTH-01-01"
  area: string // normalised area token, e.g. "auth" (lowercase)
  title: string
  pageId: string
  epicPageId: string
  epicTitle: string
}

export interface SrsInventory {
  rootPageId: string
  epics: Array<{ pageId: string; title: string }>
  frs: SrsFrEntry[]
  // Counts the eval cannot compute from the adapter's current RawContent
  // (tables come back empty on fetchPage). Captured for the report so the
  // human output is explicit about what is measured vs. what is not.
  unsupportedCategories: Array<'UR' | 'DS' | 'TC' | 'NFR'>
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
