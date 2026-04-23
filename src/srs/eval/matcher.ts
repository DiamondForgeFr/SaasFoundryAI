import { EndpointFinding, ScannerFinding } from '../scanners/types'
import { CategoryScore, DriftFinding, FreshnessReport, SrsInventory } from './types'

const DEFAULT_THRESHOLD_PCT = 80

export interface MatchOptions {
  thresholdPct?: number
}

function normalizeArea(raw: string): string {
  return raw.trim().toLowerCase()
}

function endpointMatchesFrArea(endpoint: EndpointFinding, frArea: string): boolean {
  const area = normalizeArea(endpoint.area)
  if (area === frArea) return true
  // Fall back to a prefix check: scanner areas are folder names, FR areas are
  // tokens embedded in FR IDs — "accounts" / "account" should match.
  if (area.startsWith(frArea) || frArea.startsWith(area)) return true
  return false
}

function percent(numer: number, denom: number): number {
  if (denom <= 0) return 100
  return Math.round((numer / denom) * 100)
}

function buildFrScore(matchedFrIds: Set<string>, inventorySize: number): CategoryScore {
  if (inventorySize === 0) {
    return {
      total: 0,
      covered: 0,
      score: null,
      note: 'No FR pages found under the configured rootPage'
    }
  }
  return {
    total: inventorySize,
    covered: matchedFrIds.size,
    score: percent(matchedFrIds.size, inventorySize)
  }
}

function unsupportedCategory(label: 'UR' | 'DS' | 'TC' | 'NFR'): CategoryScore {
  return {
    total: 0,
    covered: 0,
    score: null,
    note: `${label} drift is not evaluated in v1 — rendered Notion tables return empty cells via fetchPage. Follow-up work will extend the adapter to preserve table rows.`
  }
}

export function matchSrsAgainstScanners(inventory: SrsInventory, findings: ScannerFinding[], options: MatchOptions = {}): FreshnessReport {
  const threshold = options.thresholdPct ?? DEFAULT_THRESHOLD_PCT
  const endpoints = findings.filter((f): f is EndpointFinding => f.kind === 'endpoint')
  const tests = findings.filter((f) => f.kind === 'test')
  const testedAreas = new Set<string>(tests.map((t) => normalizeArea(t.area)))
  const driftFindings: DriftFinding[] = []

  const matchedFrIds = new Set<string>()
  const matchedEndpointFiles = new Set<string>()
  const frEndpointMap = new Map<string, EndpointFinding[]>()

  for (const fr of inventory.frs) {
    const matches = endpoints.filter((e) => endpointMatchesFrArea(e, fr.area))
    if (matches.length > 0) {
      matchedFrIds.add(fr.id)
      frEndpointMap.set(fr.id, matches)
      for (const m of matches) matchedEndpointFiles.add(m.file)
      const anyTested = matches.some((m) => m.hasTests) || testedAreas.has(fr.area)
      if (!anyTested) {
        driftFindings.push({
          kind: 'fr-untested',
          severity: 'warn',
          message: `FR ${fr.id} is mapped to ${matches.length} endpoint(s) but none carry tests`,
          frId: fr.id,
          frTitle: fr.title,
          area: fr.area,
          file: matches[0]?.file
        })
      }
    } else {
      driftFindings.push({
        kind: 'fr-without-code',
        severity: 'error',
        message: `FR ${fr.id} — "${fr.title}" has no matching code finding in area "${fr.area}"`,
        frId: fr.id,
        frTitle: fr.title,
        area: fr.area
      })
    }
  }

  const frAreas = new Set<string>(inventory.frs.map((f) => f.area))
  const unmatchedEndpoints = endpoints.filter((e) => !matchedEndpointFiles.has(e.file))
  const unmatchedAreas = new Map<string, EndpointFinding[]>()
  for (const e of unmatchedEndpoints) {
    const area = normalizeArea(e.area)
    if (!unmatchedAreas.has(area)) unmatchedAreas.set(area, [])
    unmatchedAreas.get(area)!.push(e)
  }
  for (const [area, group] of unmatchedAreas) {
    const sample = group[0]
    if (!frAreas.has(area)) {
      driftFindings.push({
        kind: 'orphan-area',
        severity: 'error',
        message: `Code area "${area}" carries ${group.length} endpoint(s) but has no FR page (e.g. ${sample.method} ${sample.path})`,
        area,
        file: sample.file
      })
    } else {
      driftFindings.push({
        kind: 'code-without-fr',
        severity: 'warn',
        message: `${sample.method} ${sample.path} in "${area}" is not covered by any FR in the SRS`,
        area,
        file: sample.file
      })
    }
  }

  const frScore = buildFrScore(matchedFrIds, inventory.frs.length)

  const untestedFrCount = driftFindings.filter((d) => d.kind === 'fr-untested').length
  const untestedEndpoints = endpoints.filter((e) => !e.hasTests).length
  const frCoverageScore = frScore.score ?? 100
  const codeCoverageScore = endpoints.length === 0 ? 100 : percent(endpoints.length - unmatchedEndpoints.length, endpoints.length)
  const testCoverageScore = endpoints.length === 0 ? 100 : percent(endpoints.length - untestedEndpoints, endpoints.length)
  const overall = Math.round((frCoverageScore + codeCoverageScore + testCoverageScore) / 3)

  return {
    generatedAt: new Date().toISOString(),
    rootPageId: inventory.rootPageId,
    thresholdPct: threshold,
    overall: {
      score: overall,
      status: overall >= threshold ? 'fresh' : 'drift'
    },
    categories: {
      UR: unsupportedCategory('UR'),
      FR: frScore,
      DS: unsupportedCategory('DS'),
      TC: unsupportedCategory('TC'),
      NFR: unsupportedCategory('NFR')
    },
    counts: {
      frTotal: inventory.frs.length,
      frMatched: matchedFrIds.size,
      frUntested: untestedFrCount,
      endpointsTotal: endpoints.length,
      endpointsMatched: endpoints.length - unmatchedEndpoints.length,
      endpointsUntested: untestedEndpoints
    },
    findings: driftFindings
  }
}
