import { ScannerFinding } from '../scanners/types'
import { FreshnessReport, ReviewPacket, ReviewPacketFinding, ReviewPacketFrEntry, SrsFrEntry, SrsInventory } from './types'

function normalizeArea(raw: string): string {
  return raw.trim().toLowerCase()
}

function areaCandidates(fr: SrsFrEntry): string[] {
  const hints = (fr.areaHints ?? []).map(normalizeArea).filter((h) => h.length > 0)
  return [fr.area, ...hints]
}

function areaMatches(findingArea: string, token: string): boolean {
  if (findingArea === token) return true
  return findingArea.startsWith(token) || token.startsWith(findingArea)
}

function findingKindSatisfies(finding: ScannerFinding, kind: SrsFrEntry['implementationKind']): boolean {
  if (finding.kind === 'test' || finding.kind === 'doc-context') return true
  if (!kind || kind === 'mixed') return true
  return finding.kind === kind
}

function findingFile(f: ScannerFinding): string | undefined {
  if ('file' in f && typeof f.file === 'string') return f.file
  return undefined
}

function findingTitle(f: ScannerFinding): string {
  return f.title
}

function buildFrEntries(inventory: SrsInventory, findings: ScannerFinding[]): { entries: ReviewPacketFrEntry[]; findingMap: Map<number, string[]> } {
  const findingMap = new Map<number, string[]>()
  const entries: ReviewPacketFrEntry[] = inventory.frs.map((fr) => {
    const candidates = areaCandidates(fr)
    const matchIndexes: number[] = []
    findings.forEach((f, idx) => {
      const area = normalizeArea(f.area)
      const matches = candidates.some((tok) => areaMatches(area, tok)) && findingKindSatisfies(f, fr.implementationKind)
      if (matches) {
        matchIndexes.push(idx)
        const prev = findingMap.get(idx) ?? []
        prev.push(fr.id)
        findingMap.set(idx, prev)
      }
    })
    const matched = matchIndexes.map((i) => findings[i])
    const matchedFiles = Array.from(new Set(matched.map(findingFile).filter((f): f is string => Boolean(f))))
    const hasImpl = matched.some((m) => m.kind === 'endpoint' || m.kind === 'ui-flow' || m.kind === 'entity')
    const hasTest = matched.some((m) => m.kind === 'test')
    const hasTestedEndpoint = matched.some((m) => m.kind === 'endpoint' && m.hasTests)
    let status: ReviewPacketFrEntry['status']
    if (matched.length === 0) status = 'unmatched'
    else if (hasImpl && !hasTest && !hasTestedEndpoint) status = 'untested'
    else status = 'matched'
    return {
      id: fr.id,
      title: fr.title,
      area: fr.area,
      pageId: fr.pageId,
      epicPageId: fr.epicPageId,
      epicTitle: fr.epicTitle,
      implementationKind: fr.implementationKind,
      areaHints: fr.areaHints,
      matchCount: matched.length,
      matchedFiles,
      status
    }
  })
  return { entries, findingMap }
}

function buildFindingEntries(findings: ScannerFinding[], findingMap: Map<number, string[]>): ReviewPacketFinding[] {
  return findings.map((f, idx) => ({
    kind: f.kind,
    area: normalizeArea(f.area),
    file: findingFile(f),
    title: findingTitle(f),
    matchedFrIds: findingMap.get(idx) ?? []
  }))
}

function buildPromptHints(frs: ReviewPacketFrEntry[], findings: ReviewPacketFinding[]): string[] {
  const hints: string[] = []
  const unmatchedFrs = frs.filter((f) => f.status === 'unmatched')
  if (unmatchedFrs.length > 0) {
    hints.push(`${unmatchedFrs.length} FR(s) have no deterministic match — review each to propose a semantic match or flag as truly unimplemented: ${unmatchedFrs.map((f) => f.id).join(', ')}`)
  }
  const untestedFrs = frs.filter((f) => f.status === 'untested')
  if (untestedFrs.length > 0) {
    hints.push(`${untestedFrs.length} FR(s) have impl but no tests — confirm test gap or point to missed test files: ${untestedFrs.map((f) => f.id).join(', ')}`)
  }
  const orphanFindings = findings.filter((f) => f.matchedFrIds.length === 0 && (f.kind === 'endpoint' || f.kind === 'ui-flow' || f.kind === 'entity'))
  if (orphanFindings.length > 0) {
    const byArea = new Set(orphanFindings.map((f) => f.area))
    hints.push(
      `${orphanFindings.length} code finding(s) in ${byArea.size} area(s) have no FR — propose either new FR pages or re-mapping to an existing FR: ${Array.from(byArea).slice(0, 10).join(', ')}`
    )
  }
  if (hints.length === 0) hints.push('No deterministic gaps detected. Still sweep for semantic drift (FR title vs code behaviour, outdated acceptance criteria).')
  return hints
}

export function buildReviewPacket(inventory: SrsInventory, findings: ScannerFinding[], report: FreshnessReport): ReviewPacket {
  const { entries, findingMap } = buildFrEntries(inventory, findings)
  const findingEntries = buildFindingEntries(findings, findingMap)
  return {
    generatedAt: report.generatedAt,
    rootPageId: inventory.rootPageId,
    inventory: {
      epicCount: inventory.epics.length,
      frCount: inventory.frs.length
    },
    frs: entries,
    findings: findingEntries,
    drift: report.findings,
    promptHints: buildPromptHints(entries, findingEntries)
  }
}
