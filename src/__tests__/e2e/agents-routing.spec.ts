import { execFileSync, spawnSync } from 'child_process'
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const ROOT = resolve(__dirname, '../../..')
// A commit hook exports GIT_* variables: a fixture repository must never inherit them.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))

describe('compiled sf agents routing and the adjusted route (#1035)', () => {
  let project: string
  const layer = () => join(project, '.git', 'saasfoundry', 'routing.json')
  const manifest = (harness: Record<string, unknown> = { version: 4, agents: ['claude-code'] }) =>
    writeFile(join(project, '.saasfoundry.json'), JSON.stringify({ version: 'test', projectName: 'routing-demo', structure: 'cli', modules: { harness } }, null, 2) + '\n')
  const sf = (args: string[], options: { input?: string } = {}) =>
    spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', ...args], { cwd: project, encoding: 'utf8', env: cleanEnv, ...options })
  const record = (outcome: string, extra: string[] = []) =>
    sf([
      'outcome',
      'record',
      '--provider',
      'claude-code',
      '--tier',
      'build',
      '--kind',
      'multi-file-feature',
      '--model',
      'claude-sonnet-5-5',
      '--effort',
      'xhigh',
      '--outcome',
      outcome,
      '--input-tokens',
      '100000',
      '--output-tokens',
      '10000',
      '--duration-ms',
      '60000',
      '--checks',
      'type-check',
      ...extra
    ])
  const route = (...extra: string[]) => JSON.parse(sf(['route', '--task', 'multi-file-feature', '--provider', 'claude-code', '--json', ...extra]).stdout).routes[0]

  beforeEach(async () => {
    project = await realpath(await mkdtemp(join(tmpdir(), 'sf-agents-routing-')))
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project, env: cleanEnv })
    await manifest()
  })
  afterEach(async () => rm(project, { recursive: true, force: true }))

  it('moves a kind up after repeated failures, shows the move on the route, and shares it with promote', async () => {
    for (const outcome of ['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'fail', 'fail', 'fail']) expect(record(outcome).status).toBe(0)
    expect(route('--no-trial')).toMatchObject({ tier: 'build', source: 'shipped' })

    const dry = sf(['routing', 'adjust', '--dry-run', '--json'])
    expect(dry.status).toBe(0)
    expect(JSON.parse(dry.stdout)).toMatchObject({ adjustVersion: 1, dryRun: true, applied: [expect.objectContaining({ kind: 'multi-file-feature', action: 'escalate', from: 'build', to: 'fix' })] })
    await expect(stat(layer())).rejects.toThrow()

    const adjusted = sf(['routing', 'adjust'])
    expect(adjusted.status).toBe(0)
    expect(adjusted.stdout).toContain('Escalated multi-file-feature (claude-code): build → fix. 3 failures in the last 10 rated runs (threshold 3 of 10).')
    expect(adjusted.stdout).toContain('not committed')
    expect(adjusted.stdout).toContain('differ from the effective routing')
    expect(route('--no-trial')).toMatchObject({
      tier: 'fix',
      source: 'auto',
      candidate: { model: 'claude-opus-5-5' },
      trial: false,
      adjustment: { action: 'escalate', from: 'build', rule: '3 failures in the last 10 rated runs (threshold 3 of 10)' }
    })
    const text = sf(['route', '--task', 'multi-file-feature', '--provider', 'claude-code', '--no-trial'])
    expect(text.stdout).toContain('multi-file-feature → fix (auto) claude-code: claude-opus-5-5, effort medium — escalate from build')

    const promoted = sf(['routing', 'promote', 'multi-file-feature', '--json'])
    expect(promoted.status).toBe(0)
    expect(JSON.parse(promoted.stdout)).toMatchObject({ promoteVersion: 1, promoted: [{ kind: 'multi-file-feature', tier: 'fix', providers: ['claude-code'] }], manifestChanged: true })
    expect(JSON.parse(await readFile(join(project, '.saasfoundry.json'), 'utf8')).modules.harness.routing).toEqual({ kinds: { 'multi-file-feature': { tier: 'fix' } } })
    expect(route('--no-trial')).toMatchObject({ tier: 'fix', source: 'project', adjustment: null })
  })

  it('reports per kind and tier and per ticket, undoes a move with reset, and shows it all in sf status', async () => {
    for (const outcome of ['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'fail', 'fail', 'fail']) expect(record(outcome, ['--ticket', '1035', '--complexity', 'complex']).status).toBe(0)
    sf(['routing', 'adjust'])
    const json = sf(['routing', 'report', '--json'])
    expect(json.status).toBe(0)
    const report = JSON.parse(json.stdout)
    expect(report).toMatchObject({
      reportVersion: 1,
      ledger: { runs: 10, rated: 10, censored: 0 },
      kinds: [
        {
          kind: 'multi-file-feature',
          provider: 'claude-code',
          routedTier: 'fix',
          source: 'auto',
          tiers: [{ tier: 'build', runs: 10, successes: 7, failures: 3, successRate: 0.7, cost: { priced: 10, p95: '0.300000' }, durationMs: { p95: 60000 } }]
        }
      ],
      tickets: { byComplexity: [{ complexity: 'complex', tickets: 1, cost: { median: '3.000000' } }] },
      localAdjustments: [{ kind: 'multi-file-feature', provider: 'claude-code', tier: 'fix', from: 'build', action: 'escalate' }]
    })
    const text = sf(['routing', 'report']).stdout
    expect(text).toContain('Runs recorded: 10 (10 rated, 0 censored)')
    expect(text).toMatch(/multi-file-feature\s+claude-code\s+build\s+10\s+70% of 10/)
    expect(text).toContain('Local adjustments, not promoted')

    const statusText = spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'status', '--agent-friendly', '--no-network'], { cwd: project, encoding: 'utf8', env: cleanEnv }).stdout
    expect(statusText).toContain('- routing: 1 local automatic adjustment not promoted (multi-file-feature → fix for claude-code, escalate on')

    const reset = sf(['routing', 'reset', 'multi-file-feature'])
    expect(reset.status).toBe(0)
    expect(reset.stdout).toContain('Reset multi-file-feature (claude-code): fix → build. The evidence starts over from now.')
    expect(route('--no-trial')).toMatchObject({ tier: 'build', source: 'shipped' })
    expect(JSON.parse(sf(['routing', 'reset', 'multi-file-feature', '--json']).stdout)).toMatchObject({ resetVersion: 1, kind: 'multi-file-feature', reset: [] })
    const unknown = sf(['routing', 'reset', 'deploy', '--json'])
    expect(unknown.status).toBe(1)
    expect(JSON.parse(unknown.stdout).error).toContain('Unknown task kind')
  })

  it('runs the adjustment after each captured delegation and says so, without ever failing the host', async () => {
    for (const outcome of ['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'fail', 'fail']) expect(record(outcome).status).toBe(0)
    const payload = JSON.stringify({
      hook_event_name: 'SubagentStop',
      cwd: project,
      agent_id: 'tenth',
      agent_type: 'sf-build',
      agent_transcript_path: join(project, 'missing.jsonl'),
      last_assistant_message: 'SF-DELEGATION: fail kind=multi-file-feature ticket=1035 checks=type-check'
    })
    const captured = sf(['outcome', 'capture', '--host', 'claude-code', '--json'], { input: payload })
    expect(captured.status).toBe(0)
    expect(captured.stderr).toContain('sf routing: Escalated multi-file-feature (claude-code): build → fix.')
    expect(JSON.parse(captured.stdout)).toMatchObject({ status: 'appended', adjustment: { applied: [expect.objectContaining({ action: 'escalate', to: 'fix' })] } })
    expect(route('--no-trial')).toMatchObject({ tier: 'fix', source: 'auto' })
  })

  it('answers the cheaper tier as a bounded trial and marks it, so the session records its outcome', async () => {
    for (let index = 0; index < 9; index++) expect(record('pass').status).toBe(0)
    expect(route()).toMatchObject({ tier: 'edit', trial: true, effectiveTier: 'build', candidate: { model: 'claude-haiku-5-5', effort: 'high' } })
    expect(route('--no-trial')).toMatchObject({ tier: 'build', trial: false })
    const text = sf(['route', '--task', 'multi-file-feature', '--provider', 'claude-code'])
    expect(text.stdout).toContain('multi-file-feature → edit (shipped, trial) claude-code')
    expect(text.stdout).toContain('trial of the tier below build')
  })

  it('never touches what the developer wrote, whatever the ledger says', async () => {
    await manifest({ version: 4, agents: ['claude-code'], routing: { kinds: { 'multi-file-feature': { tier: 'plan' } } } })
    for (const outcome of ['fail', 'fail', 'fail', 'fail']) expect(record(outcome).status).toBe(0)
    const adjusted = JSON.parse(sf(['routing', 'adjust', '--json']).stdout)
    expect(adjusted.applied).toEqual([])
    expect(adjusted.held).toEqual([expect.objectContaining({ kind: 'multi-file-feature', reason: 'developer-override' })])
    expect(route()).toMatchObject({ tier: 'plan', source: 'project', trial: false })
  })

  it('can be switched off in the manifest: outcomes are still recorded', async () => {
    await manifest({ version: 4, agents: ['claude-code'], routing: { adjust: { enabled: false } } })
    for (const outcome of ['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'fail', 'fail', 'fail']) expect(record(outcome).status).toBe(0)
    expect(sf(['routing', 'adjust']).stdout).toContain('No routing change')
    expect(route()).toMatchObject({ tier: 'build', source: 'shipped', trial: false })
  })

  it('keeps the route working when the clone history is damaged, and says what it could not read', async () => {
    expect(record('pass').status).toBe(0)
    await writeFile(layer(), '{ nope')
    const result = sf(['route', '--task', 'tests', '--provider', 'claude-code', '--json'])
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('the delegation history could not be read')
    expect(JSON.parse(result.stdout).routes[0]).toMatchObject({ tier: 'build', source: 'shipped' })
    // while the commands that write refuse to guess over it
    const adjust = sf(['routing', 'adjust', '--json'])
    expect(adjust.status).toBe(1)
    expect(JSON.parse(adjust.stdout).error).toContain('Invalid local routing')
  })

  it('does nothing outside a Git checkout', async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), 'sf-agents-routing-nogit-'))
    try {
      await writeFile(join(elsewhere, '.saasfoundry.json'), JSON.stringify({ version: 'test', projectName: 'x', structure: 'cli', modules: { harness: { version: 4 } } }))
      const adjust = spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', 'routing', 'adjust', '--json'], { cwd: elsewhere, encoding: 'utf8', env: cleanEnv })
      expect(adjust.status).toBe(0)
      expect(JSON.parse(adjust.stdout)).toMatchObject({ applied: [], held: [] })
      const promote = spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', 'routing', 'promote', '--json'], { cwd: elsewhere, encoding: 'utf8', env: cleanEnv })
      expect(promote.status).toBe(1)
      expect(JSON.parse(promote.stdout).error).toContain('Git directory of the clone')
    } finally {
      await rm(elsewhere, { recursive: true, force: true })
    }
  })
})
