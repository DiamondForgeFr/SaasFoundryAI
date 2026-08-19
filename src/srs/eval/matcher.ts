import { EndpointFinding, EntityFinding, ScannerFinding, UiFlowFinding } from '../scanners/types'
import { CategoryScore, DriftFinding, FreshnessReport, ImplementationKind, SrsFrEntry, SrsInventory } from './types'

const DEFAULT_THRESHOLD_PCT = 80

export interface MatchOptions {
  thresholdPct?: number
}

type ImplementationFinding = EndpointFinding | UiFlowFinding | EntityFinding

function isImplementation(f: ScannerFinding): f is ImplementationFinding {
  return f.kind === 'endpoint' || f.kind === 'ui-flow' || f.kind === 'entity'
}

function describeImpl(f: ImplementationFinding): string {
  if (f.kind === 'endpoint') return `${f.method} ${f.path}`
  if (f.kind === 'ui-flow') return f.route ? `route ${f.route}` : `ui ${f.title}`
  return `model ${f.model}`
}

function implLabel(kind: ImplementationFinding['kind']): string {
  if (kind === 'endpoint') return 'endpoint'
  if (kind === 'ui-flow') return 'UI flow'
  return 'entity'
}

function normalizeArea(raw: string): string {
  return raw.trim().toLowerCase()
}

// Conservative singularisation — enough for the plural/singular mismatch between FR area
// tokens ("commands") and scanner areas ("new-command"), without pulling in a stemmer.
function singularize(segment: string): string {
  if (segment.length > 3 && segment.endsWith('ies')) return `${segment.slice(0, -3)}y`
  if (segment.length > 2 && segment.endsWith('s') && !segment.endsWith('ss')) return segment.slice(0, -1)
  return segment
}

// Scanner areas are structural names and carry their qualifier in a separate segment
// ("new-command", "api.builder", "module-registry"); FR area tokens are the bare concept
// ("commands", "builders", "modules"). Compare segment sets, not raw strings.
function areaSegments(raw: string): string[] {
  return normalizeArea(raw)
    .split(/[-._/\s]+/)
    .filter(Boolean)
    .map(singularize)
}

function areaMatchesToken(findingArea: string, frToken: string): boolean {
  if (normalizeArea(findingArea) === normalizeArea(frToken)) return true
  // Every segment of the FR token must be present in the finding's segments. This bridges
  // "commands" <-> "new-command" and "builders" <-> "api.builder", while a multi-segment token
  // like "config-engine" still requires BOTH segments, so it cannot absorb an unrelated area.
  //
  // This replaces the previous prefix tolerance, which could not bridge a suffix mismatch at all
  // (hence 15 false `fr-without-code`) and over-matched in the other direction — "auth" was a
  // prefix of "author". Singularisation covers the "accounts"/"account" case that tolerance
  // originally existed for.
  const findingSegments = new Set(areaSegments(findingArea))
  const frSegments = areaSegments(frToken)
  if (frSegments.length === 0) return false
  return frSegments.every((segment) => findingSegments.has(segment))
}

function frAreaCandidates(fr: SrsFrEntry): string[] {
  const hints = (fr.areaHints ?? []).map(normalizeArea).filter((h) => h.length > 0)
  return [fr.area, ...hints]
}

function findingMatchesFr(finding: ScannerFinding, fr: SrsFrEntry): boolean {
  const area = normalizeArea(finding.area)
  return frAreaCandidates(fr).some((token) => areaMatchesToken(area, token))
}

function findingKindMatchesHint(finding: ScannerFinding, hint: ImplementationKind | undefined): boolean {
  // Tests and doc-context always fit, regardless of implementationKind hint
  if (finding.kind === 'test' || finding.kind === 'doc-context') return true
  if (!hint || hint === 'mixed') return true
  return finding.kind === hint
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
  const implFindings = findings.filter(isImplementation)
  const tests = findings.filter((f) => f.kind === 'test')
  const testedAreas = new Set<string>(tests.map((t) => normalizeArea(t.area)))
  const driftFindings: DriftFinding[] = []

  const matchedFrIds = new Set<string>()
  const matchedImplFiles = new Set<string>()

  for (const fr of inventory.frs) {
    const matches = findings.filter((f) => findingMatchesFr(f, fr) && findingKindMatchesHint(f, fr.implementationKind))
    if (matches.length > 0) {
      matchedFrIds.add(fr.id)
      for (const m of matches) {
        if (isImplementation(m)) matchedImplFiles.add(m.file)
      }
      const endpointMatches = matches.filter((m): m is EndpointFinding => m.kind === 'endpoint')
      const anyTested = endpointMatches.some((m) => m.hasTests) || testedAreas.has(fr.area) || matches.some((m) => m.kind === 'test')
      if (!anyTested) {
        const msg =
          endpointMatches.length > 0
            ? `FR ${fr.id} is mapped to ${endpointMatches.length} endpoint(s) but none carry tests`
            : `FR ${fr.id} matches ${matches.length} code finding(s) in area "${fr.area}" but no test coverage was detected`
        driftFindings.push({
          kind: 'fr-untested',
          severity: 'warn',
          message: msg,
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

  const frAreas = new Set<string>()
  for (const fr of inventory.frs) {
    for (const candidate of frAreaCandidates(fr)) frAreas.add(candidate)
  }
  const unmatchedImpl = implFindings.filter((f) => !matchedImplFiles.has(f.file))
  const unmatchedByArea = new Map<string, ImplementationFinding[]>()
  for (const f of unmatchedImpl) {
    const area = normalizeArea(f.area)
    if (!unmatchedByArea.has(area)) unmatchedByArea.set(area, [])
    unmatchedByArea.get(area)!.push(f)
  }
  for (const [area, group] of unmatchedByArea) {
    const sample = group[0]
    if (!frAreas.has(area)) {
      driftFindings.push({
        kind: 'orphan-area',
        severity: 'error',
        message: `Code area "${area}" carries ${group.length} ${implLabel(sample.kind)}(s) but has no FR page (e.g. ${describeImpl(sample)})`,
        area,
        file: sample.file
      })
    } else {
      driftFindings.push({
        kind: 'code-without-fr',
        severity: 'warn',
        message: `${describeImpl(sample)} in "${area}" is not covered by any FR in the SRS`,
        area,
        file: sample.file
      })
    }
  }

  const frScore = buildFrScore(matchedFrIds, inventory.frs.length)

  const untestedFrCount = driftFindings.filter((d) => d.kind === 'fr-untested').length
  const untestedEndpoints = endpoints.filter((e) => !e.hasTests).length
  const unmatchedEndpoints = endpoints.filter((e) => !matchedImplFiles.has(e.file))
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
