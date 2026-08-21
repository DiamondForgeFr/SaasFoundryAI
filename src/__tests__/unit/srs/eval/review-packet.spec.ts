import { matchSrsAgainstScanners } from '../../../../srs/eval/matcher'
import { buildReviewPacket } from '../../../../srs/eval/review-packet'
import { SrsInventory } from '../../../../srs/eval/types'
import { EndpointFinding, ScannerFinding, UiFlowFinding } from '../../../../srs/scanners/types'

function endpoint(area: string, method: string, path: string, hasTests = false, file = `${area}/controller.ts`): EndpointFinding {
  return { kind: 'endpoint', area, method, path, hasTests, file, title: `${method} ${path}` }
}

function uiFlow(area: string, route: string, file = `${area}/page.tsx`): UiFlowFinding {
  return { kind: 'ui-flow', area, file, route, formFields: [], title: `UI ${route}` }
}

function inv(frs: Array<{ id: string; area: string; title: string; implementationKind?: 'endpoint' | 'ui-flow' | 'entity' | 'mixed'; areaHints?: string[] }>): SrsInventory {
  return {
    rootPageId: 'root',
    epics: [{ pageId: 'e', title: 'E' }],
    features: [{ pageId: 'e', title: 'E', url: '', versions: [], frCount: frs.length, conforming: false }],
    frs: frs.map((f) => ({
      id: f.id,
      area: f.area,
      title: f.title,
      pageId: `p-${f.id}`,
      epicPageId: 'e',
      epicTitle: 'E',
      featurePageId: 'e',
      featureTitle: 'E',
      implementationKind: f.implementationKind,
      areaHints: f.areaHints
    })),
    conformance: [],
    unsupportedCategories: ['UR', 'DS', 'TC', 'NFR']
  }
}

describe('buildReviewPacket', () => {
  it('classifies each FR by status and threads areaHints + implementationKind through', () => {
    const inventory = inv([
      { id: 'FR-AUTH-01', area: 'auth', title: 'Sign in' },
      { id: 'FR-HOME-01', area: 'home', title: 'Landing', implementationKind: 'ui-flow' },
      { id: 'FR-BILL-01', area: 'billing', title: 'Invoices', areaHints: ['payments'] },
      { id: 'FR-GONE-01', area: 'gone', title: 'Removed feature' }
    ])
    const findings: ScannerFinding[] = [endpoint('auth', 'POST', '/signin', true), uiFlow('home', '/home'), endpoint('payments', 'GET', '/charges', false)]
    const report = matchSrsAgainstScanners(inventory, findings)
    const packet = buildReviewPacket(inventory, findings, report)

    const byId = new Map(packet.frs.map((f) => [f.id, f]))
    expect(byId.get('FR-AUTH-01')?.status).toBe('matched')
    expect(byId.get('FR-HOME-01')?.status).toBe('untested')
    expect(byId.get('FR-BILL-01')?.status).toBe('untested')
    expect(byId.get('FR-GONE-01')?.status).toBe('unmatched')
    expect(byId.get('FR-HOME-01')?.implementationKind).toBe('ui-flow')
    expect(byId.get('FR-BILL-01')?.areaHints).toEqual(['payments'])
  })

  it('records per-finding matchedFrIds so the agent can spot double-mapped findings', () => {
    const inventory = inv([
      { id: 'FR-A-01', area: 'auth', title: 'A' },
      { id: 'FR-B-01', area: 'auth', title: 'B' }
    ])
    const findings: ScannerFinding[] = [endpoint('auth', 'POST', '/x', true)]
    const report = matchSrsAgainstScanners(inventory, findings)
    const packet = buildReviewPacket(inventory, findings, report)
    expect(packet.findings).toHaveLength(1)
    expect(packet.findings[0].matchedFrIds.sort()).toEqual(['FR-A-01', 'FR-B-01'])
  })

  it('emits prompt hints summarising gaps for the agent', () => {
    const inventory = inv([{ id: 'FR-GONE-01', area: 'gone', title: 'Removed' }])
    const findings: ScannerFinding[] = [endpoint('stray', 'GET', '/orphan', true)]
    const report = matchSrsAgainstScanners(inventory, findings)
    const packet = buildReviewPacket(inventory, findings, report)
    expect(packet.promptHints.join(' ')).toMatch(/FR-GONE-01/)
    expect(packet.promptHints.join(' ')).toMatch(/stray/)
  })

  it('falls back to a sweep hint when nothing is broken deterministically', () => {
    const inventory = inv([{ id: 'FR-OK-01', area: 'ok', title: 'OK' }])
    const findings: ScannerFinding[] = [endpoint('ok', 'GET', '/ok', true)]
    const report = matchSrsAgainstScanners(inventory, findings)
    const packet = buildReviewPacket(inventory, findings, report)
    expect(packet.promptHints.some((h) => /semantic drift/i.test(h))).toBe(true)
  })
})
