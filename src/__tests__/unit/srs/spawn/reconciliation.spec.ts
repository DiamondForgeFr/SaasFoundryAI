import { canonicalSrsIdentity, ExistingSrsTicket, parseReconciliationPlan, reconcileRequirements, ReconciliationPlan, ReconciliationRequirement } from '../../../../srs/spawn/reconciliation'

const requirements: ReconciliationRequirement[] = [
  { frId: 'FR-MAH-009', title: 'Guide users', frPageUrl: 'https://app.notion.com/p/Guide-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?source=copy' },
  { frId: 'FR-MAH-010', title: 'Provision workflows', frPageUrl: 'https://app.notion.com/p/Provision-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  { frId: 'FR-MAH-011', title: 'Parity', frPageUrl: 'https://app.notion.com/p/Parity-cccccccccccccccccccccccccccccccc' }
]

function plan(overrides: Partial<ReconciliationPlan> = {}): ReconciliationPlan {
  return {
    version: 1,
    sources: {
      board: { status: 'verified', evidence: ['native children and repository search'] },
      srs: { status: 'verified', evidence: ['selected version and FR pages'] },
      implementation: { status: 'verified', evidence: ['source, tests and docs audit'] }
    },
    requirements: [
      { frId: 'FR-MAH-009', classification: 'partial', evidence: ['existing docs are incomplete'] },
      { frId: 'FR-MAH-010', classification: 'missing', evidence: ['confirmed handoff defect'] },
      { frId: 'FR-MAH-011', classification: 'delivered', evidence: ['covered by #651'] }
    ],
    ...overrides
  }
}

function ticket(overrides: Partial<ExistingSrsTicket> = {}): ExistingSrsTicket {
  return {
    number: '100',
    title: 'FR-MAH-009: Guide users',
    body: '',
    state: 'CLOSED',
    boardStatus: 'Done',
    parentNumber: '645',
    issueType: 'sf-story',
    url: 'https://github.test/issues/100',
    srsLinks: ['https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    frIds: ['FR-MAH-009'],
    ...overrides
  }
}

describe('SRS spawn reconciliation', () => {
  it('normalizes Notion page ids across URL shapes', () => {
    expect(canonicalSrsIdentity('https://app.notion.com/p/Title-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?source=copy')).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(canonicalSrsIdentity('https://www.notion.so/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  })

  it('rejects an unavailable evidence source before reconciliation', () => {
    expect(() =>
      parseReconciliationPlan({
        ...plan(),
        sources: { ...plan().sources, board: { status: 'unavailable', evidence: ['GitHub permission denied'] } }
      })
    ).toThrow(/board.*unavailable/)
  })

  it('requires evidence for every requirement decision', () => {
    expect(() =>
      parseReconciliationPlan({
        ...plan(),
        requirements: [{ frId: 'FR-MAH-009', classification: 'partial', evidence: [] }]
      })
    ).toThrow(/at least one non-empty string/)
  })

  it('requires the plan to cover the selected version exactly', () => {
    expect(() => reconcileRequirements(requirements, plan({ requirements: plan().requirements.slice(0, 2) }), [], '645')).toThrow(/missing decisions: FR-MAH-011/)
    expect(() => reconcileRequirements(requirements, plan({ requirements: [...plan().requirements, { frId: 'FR-MAH-099', classification: 'missing', evidence: ['none'] }] }), [], '645')).toThrow(
      /unknown decisions: FR-MAH-099/
    )
  })

  it('reuses a canonical ticket, creates only missing work and skips delivered scope', () => {
    const result = reconcileRequirements(requirements, plan(), [ticket()], '645')
    expect(result.map((item) => [item.requirement.frId, item.action, item.ticket?.number])).toEqual([
      ['FR-MAH-009', 'reuse', '100'],
      ['FR-MAH-010', 'create', undefined],
      ['FR-MAH-011', 'skip', undefined]
    ])
  })

  it('reuses closed tickets as canonical evidence', () => {
    const result = reconcileRequirements(requirements, plan(), [ticket({ state: 'CLOSED', boardStatus: 'Done' })], '645')
    expect(result[0]).toMatchObject({ action: 'reuse', ticket: { number: '100', state: 'CLOSED' } })
  })

  it('blocks two tickets for one canonical page before mutation', () => {
    expect(() => reconcileRequirements(requirements, plan(), [ticket(), ticket({ number: '101' })], '645')).toThrow(/ambiguous.*#100, #101/)
  })

  it('blocks an id-only collision with a contradictory canonical page', () => {
    expect(() => reconcileRequirements(requirements, plan(), [ticket({ srsLinks: ['https://example.test/a-different-page'] })], '645')).toThrow(/matches the id but not the canonical SRS page/)
  })

  it('blocks implicit reparenting', () => {
    expect(() => reconcileRequirements(requirements, plan(), [ticket({ parentNumber: '999' })], '645')).toThrow(/belongs to parent #999/)
  })

  it('does not create delivered or superseded scope even when no canonical ticket exists', () => {
    const delivered = plan({
      requirements: [
        { frId: 'FR-MAH-009', classification: 'delivered', evidence: ['delivered by #536'] },
        { frId: 'FR-MAH-010', classification: 'superseded', evidence: ['invalid product scope'] },
        { frId: 'FR-MAH-011', classification: 'delivered', evidence: ['covered by #651'] }
      ]
    })
    expect(reconcileRequirements(requirements, delivered, [], '645').map((item) => item.action)).toEqual(['skip', 'skip', 'skip'])
  })
})
