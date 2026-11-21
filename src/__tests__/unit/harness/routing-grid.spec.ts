import grid from '../../../harness/routing-grid.json'
import {
  ROUTING_PROVIDERS,
  TASK_KINDS,
  getRoutingGrid,
  isRoutingProvider,
  listTierAssignments,
  parseTaskKind,
  resolveRoute,
  routingOverrideIssues,
  validateRoutingGrid,
  type RoutingOverrides,
  type RoutingProvider,
  type TaskKind
} from '../../../harness/routing-grid'

type Fixture = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = (): Fixture => JSON.parse(JSON.stringify(grid))

describe('shipped task-kind allocation grid (#930)', () => {
  it('covers the nine task kinds for every routed provider (AC-1)', () => {
    expect(() => validateRoutingGrid(grid)).not.toThrow()
    expect(Object.keys(grid.kinds)).toEqual([...TASK_KINDS])
    expect(TASK_KINDS).toEqual(['exploration', 'scoped-edit', 'bug-fix', 'multi-file-feature', 'tests', 'review', 'planning', 'terminal-ci', 'prose'])
    for (const kind of TASK_KINDS) for (const provider of ROUTING_PROVIDERS) expect(resolveRoute(kind, provider).source).toBe('shipped')
  })

  it('cites evidence for every entry: measured ones with score and cost, provisional ones without (AC-2)', () => {
    for (const kind of TASK_KINDS) {
      for (const provider of ROUTING_PROVIDERS) {
        const evidence = resolveRoute(kind, provider).evidence!
        expect(evidence.url).toMatch(/^https:\/\//)
        expect(evidence.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(evidence.source).not.toBe('')
        if (evidence.status === 'measured') {
          expect(typeof evidence.score).toBe('number')
          expect(evidence.costPerTaskUsd).toMatch(/^\d+\.\d+$/)
        } else {
          expect(evidence).toMatchObject({ score: null, costPerTaskUsd: null })
        }
      }
    }
    const measured = TASK_KINDS.filter((kind) => resolveRoute(kind, 'claude-code').evidence!.status === 'measured')
    expect(measured).toEqual(['bug-fix', 'multi-file-feature', 'planning', 'terminal-ci'])
  })

  it('seeds the benchmark-backed candidates and never Haiku for terminal work', () => {
    expect(resolveRoute('bug-fix', 'claude-code').candidate).toEqual({ id: 'anthropic/claude-code/claude-opus-5-5/medium', model: 'claude-opus-5-5', effort: 'medium' })
    expect(resolveRoute('multi-file-feature', 'claude-code').candidate.model).toBe('claude-sonnet-5-5')
    expect(resolveRoute('terminal-ci', 'claude-code').candidate).toMatchObject({ model: 'claude-opus-5-5', effort: 'xhigh' })
    expect(resolveRoute('planning', 'codex').candidate.id).toBe('openai/codex/gpt-6.1-sol/medium')
    expect(resolveRoute('terminal-ci', 'claude-code', { tiers: { terminal: { 'claude-code': { model: 'claude-haiku-5-5', effort: 'max' } } } }).excluded).toBe(true)
  })

  it('returns a copy that cannot change routing', () => {
    const copy = getRoutingGrid()
    copy.tiers.fix['claude-code'].model = 'tampered'
    expect(resolveRoute('bug-fix', 'claude-code').candidate.model).toBe('claude-opus-5-5')
  })

  it.each<[string, (data: Fixture) => void]>([
    ['version', (data) => (data.gridVersion = 2)],
    ['unknown root key', (data) => (data.loader = 'https://example.test/grid.json')],
    ['missing kind', (data) => delete data.kinds.prose],
    ['unknown kind', (data) => (data.kinds.deploy = data.kinds.prose)],
    ['undeclared tier', (data) => (data.kinds.prose.tier = 'nowhere')],
    ['tier missing a provider', (data) => delete data.tiers.light.codex],
    ['unknown effort', (data) => (data.tiers.light['claude-code'].effort = 'turbo')],
    ['unsafe model id', (data) => (data.tiers.light['claude-code'].model = '../haiku')],
    ['provisional entry claiming a score', (data) => (data.kinds.prose.evidence['claude-code'].score = 80)],
    ['measured entry without a cost', (data) => (data.kinds['bug-fix'].evidence['claude-code'].costPerTaskUsd = null)],
    ['cost as a float', (data) => (data.kinds['bug-fix'].evidence['claude-code'].costPerTaskUsd = 0.8)],
    ['non-https source', (data) => (data.kinds['bug-fix'].evidence.codex.url = 'http://example.test')],
    ['credential source', (data) => (data.kinds['bug-fix'].evidence.codex.url = 'https://user:secret@example.test')],
    ['bad date', (data) => (data.kinds['bug-fix'].evidence.codex.date = '14/10/2026')],
    ['seed on its own exclusion list', (data) => (data.kinds['terminal-ci'].tier = 'light')],
    ['malformed exclusion', (data) => data.kinds['terminal-ci'].excluded.push({ provider: 'gemini-cli', model: 'x' })]
  ])('rejects a malformed grid: %s', (_, change) => {
    const data = clone()
    change(data)
    expect(() => validateRoutingGrid(data)).toThrow('Invalid routing grid')
  })
})

describe('project routing overrides (#930 AC-3, TC-AEX-008)', () => {
  it('a project override wins for its kind, every other kind still resolves from the shipped grid', () => {
    const overrides: RoutingOverrides = { kinds: { 'scoped-edit': { tier: 'build' } } }
    expect(resolveRoute('scoped-edit', 'claude-code', overrides)).toMatchObject({ tier: 'build', source: 'project', candidate: { model: 'claude-sonnet-5-5' }, evidence: null })
    for (const kind of TASK_KINDS.filter((kind) => kind !== 'scoped-edit')) expect(resolveRoute(kind, 'claude-code', overrides).source).toBe('shipped')
  })

  it('lets a project replace one provider of a tier or add its own tier', () => {
    const overrides: RoutingOverrides = {
      kinds: { prose: { tier: 'docs' } },
      tiers: { light: { codex: { model: 'gpt-6-luna', effort: 'max' } }, docs: { 'claude-code': { model: 'claude-sonnet-5-5', effort: 'low' } } }
    }
    expect(resolveRoute('exploration', 'codex', overrides)).toMatchObject({ source: 'project', candidate: { model: 'gpt-6-luna' } })
    expect(resolveRoute('exploration', 'claude-code', overrides)).toMatchObject({ source: 'shipped', candidate: { model: 'claude-haiku-5-5' } })
    expect(resolveRoute('prose', 'claude-code', overrides)).toMatchObject({ tier: 'docs', source: 'project' })
    expect(() => resolveRoute('prose', 'codex', overrides)).toThrow("Tier 'docs' has no codex candidate")
  })

  it.each<[unknown, string]>([
    [[], 'routing must be an object'],
    [{ kinds: { deploy: { tier: 'light' } } }, 'is not a task kind'],
    [{ kinds: { prose: { tier: 'nowhere' } } }, 'is neither shipped nor declared'],
    [{ kinds: { prose: 'light' } }, 'must be { tier }'],
    [{ tiers: { light: { gemini: { model: 'x', effort: 'low' } } } }, 'must name candidates'],
    [{ tiers: { light: { codex: { model: 'gpt-6-luna', effort: 'turbo' } } } }, 'effort must be one of'],
    [{ tiers: { Light: { codex: { model: 'gpt-6-luna', effort: 'low' } } } }, 'lowercase identifier'],
    [{ budget: 5 }, 'optional kinds, tiers and adjust']
  ])('reports an invalid override %j', (value, message) => {
    expect(routingOverrideIssues(value).join('\n')).toContain(message)
    expect(() => resolveRoute('prose', 'claude-code', value as RoutingOverrides)).toThrow('Invalid modules.harness.routing')
  })

  it.each<[RoutingProvider, string, boolean]>([
    ['claude-code', 'minimal', false],
    ['claude-code', 'ultra', false],
    ['claude-code', 'max', true],
    ['codex', 'minimal', false],
    ['codex', 'ultra', true]
  ])('accepts a %s override effort %s only when the host can express it: %s (#929)', (provider, effort, ok) => {
    const issues = routingOverrideIssues({ tiers: { light: { [provider]: { model: 'some-model', effort } } } })
    expect(issues.length === 0).toBe(ok)
    if (!ok) expect(issues[0]).toContain(`cannot be expressed by ${provider}`)
  })

  it('groups the resolved kinds by tier, with the kinds each tier does not serve (#929)', () => {
    const tiers = listTierAssignments('claude-code')
    expect(tiers.map((entry) => [entry.tier, entry.kinds])).toEqual([
      ['light', ['exploration', 'prose']],
      ['edit', ['scoped-edit']],
      ['build', ['multi-file-feature', 'tests']],
      ['fix', ['bug-fix', 'review']],
      ['plan', ['planning']],
      ['terminal', ['terminal-ci']]
    ])
    expect(tiers[3]).toMatchObject({ provider: 'claude-code', source: 'shipped', candidate: { model: 'claude-opus-5-5', effort: 'medium' }, excludedFor: [] })
    expect(tiers[3].elsewhere).toContainEqual({ kind: 'scoped-edit', tier: 'edit' })
    expect(tiers[3].elsewhere.map((entry) => entry.kind)).not.toContain('bug-fix')
  })

  it('reflects overrides: an emptied tier disappears, a project tier and a replaced candidate are project (#929)', () => {
    const overrides: RoutingOverrides = {
      kinds: { 'terminal-ci': { tier: 'plan' }, prose: { tier: 'docs' } },
      tiers: { light: { codex: { model: 'gpt-6-luna', effort: 'max' } }, docs: { codex: { model: 'gpt-6-luna', effort: 'low' } } }
    }
    const tiers = listTierAssignments('codex', overrides)
    expect(tiers.map((entry) => entry.tier)).toEqual(['light', 'edit', 'build', 'fix', 'plan', 'docs'])
    expect(tiers.find((entry) => entry.tier === 'light')).toMatchObject({ source: 'project', kinds: ['exploration'] })
    expect(tiers.find((entry) => entry.tier === 'plan')).toMatchObject({ source: 'shipped', kinds: ['planning', 'terminal-ci'] })
    expect(tiers.find((entry) => entry.tier === 'docs')).toMatchObject({ source: 'project', kinds: ['prose'] })
    expect(() => listTierAssignments('claude-code', overrides)).toThrow("Tier 'docs' has no claude-code candidate")
  })

  it('names the task kinds when one is unknown', () => {
    expect(parseTaskKind('bug-fix')).toBe('bug-fix')
    expect(() => parseTaskKind('deploy')).toThrow('Task kinds: exploration, scoped-edit')
  })
})

// FR-MAH-021: Kimi Code joins the grid as data, through its profile, and every one of its routes waits for a measurement
describe('Kimi Code in the shipped grid (FR-MAH-021)', () => {
  const SEEDS: [TaskKind, string, string, string][] = [
    ['exploration', 'light', 'k3', 'low'],
    ['scoped-edit', 'edit', 'k3', 'high'],
    ['bug-fix', 'fix', 'k3.1-pro', 'high'],
    ['multi-file-feature', 'build', 'k3.1-pro', 'high'],
    ['tests', 'build', 'k3.1-pro', 'high'],
    ['review', 'fix', 'k3.1-pro', 'high'],
    ['planning', 'plan', 'k3.1-pro', 'high'],
    ['terminal-ci', 'terminal', 'k3.1-pro', 'max'],
    ['prose', 'light', 'k3', 'low']
  ]

  it('is a routed provider that the grid is validated against', () => {
    expect(ROUTING_PROVIDERS).toContain('kimi')
    expect(isRoutingProvider('kimi')).toBe(true)
    expect(Object.keys(grid.tiers.light)).toEqual(['claude-code', 'codex', 'kimi'])
    const data = clone()
    delete data.tiers.light.kimi
    expect(() => validateRoutingGrid(data)).toThrow('Invalid routing grid')
    const withoutEvidence = clone()
    delete withoutEvidence.kinds.prose.evidence.kimi
    expect(() => validateRoutingGrid(withoutEvidence)).toThrow('Invalid routing grid')
  })

  it.each(SEEDS)('routes %s to the %s tier: %s at %s effort, a moonshot/kimi candidate', (kind, tier, model, effort) => {
    expect(resolveRoute(kind, 'kimi')).toMatchObject({
      kind,
      provider: 'kimi',
      tier,
      source: 'shipped',
      excluded: false,
      candidate: { id: `moonshot/kimi/${model}/${effort}`, model, effort }
    })
  })

  it('has no measurement for any kind: every route is provisional, with no score and no cost, and says so', () => {
    for (const kind of TASK_KINDS) {
      const evidence = resolveRoute(kind, 'kimi').evidence!
      expect(evidence).toMatchObject({ status: 'provisional', score: null, costPerTaskUsd: null })
      expect(evidence.note).toContain('No Kimi measurement exists yet')
      expect(evidence.note).toContain('highspeed aliases are not used: they bill twice')
      expect(evidence.url).toMatch(/^https:\/\//)
    }
  })

  it('never seeds a highspeed alias, whatever the tier', () => {
    for (const candidates of Object.values(grid.tiers)) expect(candidates.kimi.model).not.toMatch(/highspeed/i)
  })

  it('leaves the routes of Claude Code and Codex where they were', () => {
    expect(resolveRoute('bug-fix', 'claude-code').candidate.id).toBe('anthropic/claude-code/claude-opus-5-5/medium')
    expect(resolveRoute('bug-fix', 'codex').candidate.id).toBe('openai/codex/gpt-6.1-sol/medium')
    expect(resolveRoute('bug-fix', 'claude-code').evidence!.status).toBe('measured')
  })

  it.each(['low', 'high', 'max'])('accepts a project override of a Kimi tier at the effort %s, the three it can express', (effort) => {
    expect(routingOverrideIssues({ tiers: { light: { kimi: { model: 'k3', effort } } } })).toEqual([])
  })

  it.each(['minimal', 'medium', 'xhigh', 'ultra'])('refuses a project override of a Kimi tier at the effort %s, which Kimi cannot express', (effort) => {
    const issues = routingOverrideIssues({ tiers: { light: { kimi: { model: 'k3', effort } } } })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain(`routing.tiers.light.kimi.effort '${effort}' cannot be expressed by kimi (low, high, max)`)
    expect(() => resolveRoute('prose', 'kimi', { tiers: { light: { kimi: { model: 'k3', effort } } } } as RoutingOverrides)).toThrow('Invalid modules.harness.routing')
  })

  it('lets a project replace a Kimi tier, and then no longer claims the shipped evidence', () => {
    const overrides: RoutingOverrides = { tiers: { light: { kimi: { model: 'k3.1-pro', effort: 'max' } } } }
    expect(resolveRoute('exploration', 'kimi', overrides)).toMatchObject({ source: 'project', candidate: { id: 'moonshot/kimi/k3.1-pro/max' }, evidence: null })
    expect(resolveRoute('exploration', 'codex', overrides).source).toBe('shipped')
  })

  it('groups the kinds Kimi serves by tier, as it does for the other hosts', () => {
    expect(listTierAssignments('kimi').map((entry) => [entry.tier, entry.candidate.model, entry.candidate.effort, entry.kinds])).toEqual([
      ['light', 'k3', 'low', ['exploration', 'prose']],
      ['edit', 'k3', 'high', ['scoped-edit']],
      ['build', 'k3.1-pro', 'high', ['multi-file-feature', 'tests']],
      ['fix', 'k3.1-pro', 'high', ['bug-fix', 'review']],
      ['plan', 'k3.1-pro', 'high', ['planning']],
      ['terminal', 'k3.1-pro', 'max', ['terminal-ci']]
    ])
  })
})
