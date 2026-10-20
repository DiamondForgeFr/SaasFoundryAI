import { execFileSync, spawnSync } from 'child_process'
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const ROOT = resolve(__dirname, '../../..')
// A commit hook exports GIT_* variables: a fixture repository must never inherit them.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))

describe('compiled sf agents outcome record | mark (#1035)', () => {
  let project: string
  const ledger = () => join(project, '.git', 'saasfoundry', 'delegations.jsonl')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: project, env: cleanEnv, stdio: 'pipe' })
  const run = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', 'outcome', ...args], { cwd: project, encoding: 'utf8', env: cleanEnv })
  const lines = async () =>
    (await readFile(ledger(), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))

  beforeEach(async () => {
    project = await realpath(await mkdtemp(join(tmpdir(), 'sf-agents-outcome-')))
    git('init', '-q', '-b', 'main')
    await writeFile(
      join(project, '.saasfoundry.json'),
      JSON.stringify({ version: 'test', projectName: 'outcome-demo', structure: 'cli', modules: { harness: { version: 4, agents: ['claude-code'] } } })
    )
  })
  afterEach(async () => rm(project, { recursive: true, force: true }))

  it('records an outcome in the Git directory of the clone, priced from the catalogue, readable only by its owner', async () => {
    const result = run(
      'record',
      '--provider',
      'claude-code',
      '--tier',
      'build',
      '--kind',
      'multi-file-feature',
      '--ticket',
      '1035',
      '--outcome',
      'pass',
      '--model',
      'claude-sonnet-5-5',
      '--input-tokens',
      '1000000',
      '--output-tokens',
      '100000',
      '--duration-ms',
      '60000',
      '--checks',
      'type-check,automated-tests',
      '--json'
    )
    expect(result.status).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output).toMatchObject({
      outcomeVersion: 1,
      status: 'appended',
      record: { taskKind: 'multi-file-feature', outcome: 'success', metering: 'complete', cost: { amount: '3.00000000', currency: 'USD' } }
    })
    expect(await lines()).toHaveLength(1)
    expect(((await stat(ledger())).mode & 0o777).toString(8)).toBe('600')
  })

  it('says what it recorded in plain text, and that an unmeasured outcome never counts as a success', () => {
    const measured = run('record', '--provider', 'codex', '--tier', 'edit', '--kind', 'scoped-edit', '--outcome', 'fail', '--model', 'gpt-6.1-sol', '--input-tokens', '10', '--output-tokens', '10')
    expect(measured.status).toBe(0)
    expect(measured.stdout).toContain('scoped-edit on codex edit, outcome validation-failed, unpriced model.')
    const unmeasured = run('record', '--provider', 'claude-code', '--tier', 'build', '--kind', 'tests')
    expect(unmeasured.stdout).toContain('outcome outcome-unknown')
    expect(unmeasured.stdout).toContain('censored and never counts as a success')
  })

  it('marks a ticket after the fact: the success becomes a failure in the ledger folding, the run line is untouched', async () => {
    run('record', '--provider', 'claude-code', '--tier', 'build', '--kind', 'multi-file-feature', '--ticket', '1035', '--outcome', 'pass')
    const before = await readFile(ledger(), 'utf8')
    const marked = run('mark', '1035', 'human-defect', '--note', 'wrong default', '--json')
    expect(marked.status).toBe(0)
    expect(JSON.parse(marked.stdout)).toMatchObject({ outcomeVersion: 1, status: 'appended', matched: 1, signal: 'human-defect' })
    const after = await readFile(ledger(), 'utf8')
    expect(after.startsWith(before)).toBe(true)
    expect((await lines())[1]).toMatchObject({ type: 'signal', signal: 'human-defect', target: { ticket: 1035, taskKind: null } })
  })

  it.each<[string, string[], string]>([
    ['an unknown task kind', ['record', '--provider', 'claude-code', '--tier', 'build', '--kind', 'deploy'], 'Unknown task kind'],
    ['an unrouted coding agent', ['record', '--provider', 'gemini-cli', '--tier', 'build'], 'provider'],
    ['a check outside the library codes', ['record', '--provider', 'claude-code', '--tier', 'build', '--checks', 'vibes'], 'checks'],
    ['a ticket that is not a number', ['record', '--provider', 'claude-code', '--tier', 'build', '--ticket', 'abc'], '--ticket must be a positive integer'],
    ['a signal that does not exist', ['mark', '1035', 'bad-vibes'], 'signal must be rework or human-defect'],
    ['a ticket without any recorded run', ['mark', '999', 'rework'], 'No delegation run is recorded for ticket #999']
  ])('fails closed on %s, with a JSON error and no ledger line', async (_, args, message) => {
    const result = run(...args, '--json')
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout).error).toContain(message)
    await expect(stat(ledger())).rejects.toThrow()
  })

  it('refuses outside a Git checkout: the ledger is kept in the Git directory of the clone', async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), 'sf-agents-outcome-nogit-'))
    try {
      const result = spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', 'outcome', 'record', '--provider', 'claude-code', '--tier', 'build', '--json'], {
        cwd: elsewhere,
        encoding: 'utf8',
        env: cleanEnv
      })
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout).error).toContain('Git directory of the clone')
    } finally {
      await rm(elsewhere, { recursive: true, force: true })
    }
  })

  it('prices a model the project declared in routing.adjust.prices', async () => {
    await writeFile(
      join(project, '.saasfoundry.json'),
      JSON.stringify({
        version: 'test',
        projectName: 'outcome-demo',
        structure: 'cli',
        modules: { harness: { version: 4, agents: ['codex'], routing: { adjust: { prices: { 'gpt-6.1-sol': { input: '0.30', output: '1.20' } } } } } }
      })
    )
    const result = run(
      'record',
      '--provider',
      'codex',
      '--tier',
      'build',
      '--kind',
      'tests',
      '--model',
      'gpt-6.1-sol',
      '--input-tokens',
      '100000',
      '--output-tokens',
      '20000',
      '--outcome',
      'pass',
      '--json'
    )
    expect(JSON.parse(result.stdout).record.cost).toEqual({ amount: '0.05400000', currency: 'USD' })
  })

  describe('capture, run by the host hooks with the payload on stdin', () => {
    const FIXTURES = join(ROOT, 'src/__tests__/fixtures/delegation-capture')
    const capture = (host: string, input: string, ...extra: string[]) =>
      spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', 'outcome', 'capture', '--host', host, ...extra], { cwd: project, encoding: 'utf8', env: cleanEnv, input })
    const payload = async (name: string, transcript: string) => (await readFile(join(FIXTURES, name), 'utf8')).replaceAll('__CWD__', project).replaceAll('__TRANSCRIPT__', transcript)

    it('records a Claude Code SubagentStop silently, so the hook adds nothing to the agent output', async () => {
      const result = capture('claude-code', await payload('claude-subagent-stop.json', join(FIXTURES, 'claude-subagent.jsonl')))
      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
      expect(await lines()).toHaveLength(1)
      expect((await lines())[0]).toMatchObject({ type: 'run', host: 'claude-code', tier: 'build', taskKind: 'multi-file-feature', outcome: 'success', cost: { amount: '0.01196000' } })
    })

    it('records a Codex SubagentStop and prints the versioned result on request', async () => {
      const result = capture('codex', await payload('codex-subagent-stop.json', join(FIXTURES, 'codex-rollout.jsonl')), '--json')
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ outcomeVersion: 1, host: 'codex', status: 'appended', record: { provider: 'codex', taskKind: 'tests', metering: 'complete' } })
    })

    it('answers an event that is not a delegation with nothing and exit 0', async () => {
      const result = capture('claude-code', JSON.stringify({ hook_event_name: 'SessionStart', cwd: project }), '--json')
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ status: 'ignored', reason: expect.stringContaining('not a delegation event') })
      await expect(stat(ledger())).rejects.toThrow()
    })

    it('never fails the host on a payload it cannot read: it says so on stderr and exits 0', () => {
      const result = capture('claude-code', 'not json at all')
      expect(result.status).toBe(0)
      expect(result.stderr).toContain('sf agents outcome capture: capture failed')
    })

    it('fails only on a host it does not know', () => {
      const result = capture('gemini-cli', '{}')
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('--host must be claude-code or codex')
    })
  })

  it('fails closed on an invalid adjust block instead of recording over it', async () => {
    await writeFile(
      join(project, '.saasfoundry.json'),
      JSON.stringify({ version: 'test', projectName: 'outcome-demo', structure: 'cli', modules: { harness: { version: 4, routing: { adjust: { window: 1 } } } } })
    )
    const result = run('record', '--provider', 'claude-code', '--tier', 'build', '--json')
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout).error).toContain('Invalid modules.harness.routing')
  })
})
