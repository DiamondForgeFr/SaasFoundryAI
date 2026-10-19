import {
  canonicalSrsIdentity,
  ExistingSrsTicket,
  matchExistingTickets,
  parseReconciliationPlan,
  reconcileRequirements,
  ReconciliationPlan,
  ReconciliationRequirement
} from '../../../../srs/spawn/reconciliation'

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

  it('does not trust a Notion-shaped page id on an unrelated host', () => {
    const attackerUrl = 'https://attacker.example/Title-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    expect(canonicalSrsIdentity(attackerUrl)).toBe(attackerUrl.toLowerCase())
    expect(canonicalSrsIdentity(attackerUrl)).not.toBe(canonicalSrsIdentity(requirements[0].frPageUrl))

    const result = reconcileRequirements(requirements, plan(), [ticket({ srsLinks: [attackerUrl], frIds: [] })], '645')
    expect(result[0]).toMatchObject({ action: 'create' })
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

  // #855 — before spawn creates the version Epic there is no parent yet
  describe('with no delivery parent yet', () => {
    it('reuses a matching ticket that has no parent', () => {
      const result = reconcileRequirements(requirements, plan(), [ticket({ parentNumber: null })], null)
      expect(result.find((entry) => entry.requirement.frId === 'FR-MAH-009')).toMatchObject({ action: 'reuse', ticket: { number: '100' } })
    })

    it('blocks a match that already belongs to a parent', () => {
      expect(() => reconcileRequirements(requirements, plan(), [ticket()], null)).toThrow(/already belongs to parent #645/)
    })
  })

  it('reuses closed tickets as canonical evidence', () => {
    const result = reconcileRequirements(requirements, plan(), [ticket({ state: 'CLOSED', boardStatus: 'Done' })], '645')
    expect(result[0]).toMatchObject({ action: 'reuse', ticket: { number: '100', state: 'CLOSED' } })
  })

  it('blocks two tickets for one canonical page before mutation', () => {
    expect(() => reconcileRequirements(requirements, plan(), [ticket(), ticket({ number: '101' })], '645')).toThrow(/ambiguous.*#100, #101/)
  })

  it('ignores an aggregate Epic that catalogues the same canonical FR page', () => {
    const aggregate = ticket({
      number: '645',
      title: 'Multi-agent harness - v1',
      parentNumber: null,
      issueType: 'sf-epic',
      frIds: ['FR-MAH-001', 'FR-MAH-009', 'FR-MAH-010'],
      srsLinks: [requirements[0].frPageUrl, requirements[1].frPageUrl]
    })
    const result = reconcileRequirements(requirements, plan(), [aggregate, ticket()], '645')
    expect(result[0]).toMatchObject({ action: 'reuse', ticket: { number: '100' } })
  })

  it('blocks an id-only collision with a contradictory canonical page', () => {
    expect(() => reconcileRequirements(requirements, plan(), [ticket({ srsLinks: ['https://example.test/a-different-page'] })], '645')).toThrow(/matches the id but not the canonical SRS page/)
  })

  it('prefers one canonical page match over unrelated textual references to the same FR id', () => {
    const referenceOnly = ticket({ number: '101', srsLinks: ['https://example.test/a-different-page'], parentNumber: null })
    const result = reconcileRequirements(requirements, plan(), [ticket(), referenceOnly], '645')
    expect(result[0]).toMatchObject({ action: 'reuse', ticket: { number: '100' } })
  })

  it('blocks implicit reparenting', () => {
    expect(() => reconcileRequirements(requirements, plan(), [ticket({ parentNumber: '999' })], '645')).toThrow(/belongs to parent #999/)
  })

  it('skips delivered historical work without trying to reparent it', () => {
    const delivered = plan({
      requirements: [{ frId: 'FR-MAH-009', classification: 'delivered', evidence: ['delivered by #536'] }, ...plan().requirements.slice(1)]
    })
    const result = reconcileRequirements(requirements, delivered, [ticket({ parentNumber: '999' })], '645')
    expect(result[0]).toMatchObject({ action: 'skip', ticket: { number: '100', parentNumber: '999' } })
  })

  it('skips delivered scope when audit tickets mention only its FR id', () => {
    const delivered = plan({
      requirements: [{ frId: 'FR-MAH-009', classification: 'delivered', evidence: ['delivered by another baseline'] }, ...plan().requirements.slice(1)]
    })
    const referenceOnly = ticket({ number: '766', srsLinks: ['https://example.test/a-different-page'], parentNumber: '999' })
    expect(reconcileRequirements(requirements, delivered, [referenceOnly], '645')[0]).toMatchObject({ action: 'skip', ticket: undefined })
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

// #1037 — the reuse rules with no evidence plan: the board alone decides what already exists
describe('matching existing tickets without a plan', () => {
  const matchOf = (frId: string, tickets: ExistingSrsTicket[], parent: string | null = '645') => matchExistingTickets(requirements, tickets, parent).find((item) => item.requirement.frId === frId)!

  it('reuses the canonical ticket, open or closed, and leaves an FR with no ticket to be created', () => {
    const open = ticket({ number: '100', state: 'OPEN', boardStatus: 'Backlog' })
    const closed = ticket({ number: '101', title: 'FR-MAH-010: Provision workflows', frIds: ['FR-MAH-010'], srsLinks: [requirements[1].frPageUrl] })

    const matches = matchExistingTickets(requirements, [open, closed], '645')

    expect(matches.map((item) => [item.requirement.frId, item.ticket?.number, item.blocked])).toEqual([
      ['FR-MAH-009', '100', undefined],
      ['FR-MAH-010', '101', undefined],
      ['FR-MAH-011', undefined, undefined]
    ])
    expect(matches[1].ticket?.state).toBe('CLOSED')
  })

  it('reuses a ticket that has no parent, with or without a delivery parent yet', () => {
    const orphan = ticket({ parentNumber: null })
    expect(matchOf('FR-MAH-009', [orphan]).ticket?.number).toBe('100')
    expect(matchOf('FR-MAH-009', [orphan], null).ticket?.number).toBe('100')
  })

  it('blocks two tickets for one canonical page, naming both', () => {
    expect(matchOf('FR-MAH-009', [ticket(), ticket({ number: '101' })]).blocked).toMatch(/ambiguous.*#100, #101/)
  })

  it('blocks a match that belongs to another parent, and every match while there is no parent', () => {
    expect(matchOf('FR-MAH-009', [ticket({ parentNumber: '999' })]).blocked).toMatch(/belongs to parent #999/)
    expect(matchOf('FR-MAH-009', [ticket()], null).blocked).toMatch(/already belongs to parent #645/)
  })

  it('blocks an id-only collision with a contradictory canonical page', () => {
    expect(matchOf('FR-MAH-009', [ticket({ srsLinks: ['https://example.test/a-different-page'] })]).blocked).toMatch(/matches the id but not the canonical SRS page/)
  })

  it('ignores an aggregate Epic that catalogues the same canonical page', () => {
    const aggregate = ticket({ number: '645', parentNumber: null, issueType: 'sf-epic', frIds: ['FR-MAH-009'], srsLinks: [requirements[0].frPageUrl] })
    expect(matchOf('FR-MAH-009', [aggregate, ticket()]).ticket?.number).toBe('100')
  })

  // The duplicates of #1037 were closed as not planned, and kept the FR page link they were spawned with
  describe('a ticket closed as not planned', () => {
    const duplicate = ticket({ number: '200', state: 'CLOSED', stateReason: 'not_planned', parentNumber: null })
    const kept = ticket({ number: '100', state: 'OPEN', stateReason: null, boardStatus: 'Backlog' })

    it('is left out of the match, so it no longer makes the FR ambiguous', () => {
      const match = matchOf('FR-MAH-009', [kept, duplicate])

      expect(match.blocked).toBeUndefined()
      expect(match.ticket?.number).toBe('100')
      expect(match.ignored.map((item) => item.number)).toEqual(['200'])
    })

    it('leaves the FR to be created when it is the only ticket carrying the page', () => {
      const match = matchOf('FR-MAH-009', [duplicate])

      expect(match.ticket).toBeUndefined()
      expect(match.blocked).toBeUndefined()
      expect(match.ignored.map((item) => item.number)).toEqual(['200'])
    })

    it('is not mistaken for an id-only collision either', () => {
      const idOnly = ticket({ number: '201', state: 'CLOSED', stateReason: 'not_planned', parentNumber: null, srsLinks: ['https://example.test/a-different-page'] })
      expect(matchOf('FR-MAH-009', [idOnly]).blocked).toBeUndefined()
    })

    it('does not hide a ticket closed as completed, nor one that was reopened', () => {
      expect(matchOf('FR-MAH-009', [kept, ticket({ number: '200', stateReason: 'completed' })]).blocked).toMatch(/ambiguous.*#100, #200/)
      expect(matchOf('FR-MAH-009', [kept, ticket({ number: '200', state: 'OPEN', stateReason: 'not_planned' })]).blocked).toMatch(/ambiguous.*#100, #200/)
    })

    it('counts a ticket from a CLI that does not report the reason as it always did', () => {
      expect(matchOf('FR-MAH-009', [kept, ticket({ number: '200' })]).blocked).toMatch(/ambiguous.*#100, #200/)
    })

    it('is left out with a reconciliation plan too', () => {
      const result = reconcileRequirements(requirements, plan(), [kept, duplicate], '645')

      expect(result[0]).toMatchObject({ action: 'reuse', ticket: { number: '100' } })
      expect(result[0].ignored.map((item) => item.number)).toEqual(['200'])
      expect(result[1].ignored).toEqual([])
    })
  })

  it('reports every blocked FR instead of stopping at the first', () => {
    const second = ticket({ number: '200', title: 'FR-MAH-010: Provision workflows', frIds: ['FR-MAH-010'], srsLinks: [requirements[1].frPageUrl], parentNumber: '999' })
    const blocked = matchExistingTickets(requirements, [ticket({ parentNumber: '998' }), second], '645').filter((item) => item.blocked)
    expect(blocked.map((item) => item.requirement.frId)).toEqual(['FR-MAH-009', 'FR-MAH-010'])
  })
})
