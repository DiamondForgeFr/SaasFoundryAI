import { execFile } from 'child_process'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

import { captureHostEvent, parseDelegationLine, summarizeClaudeTranscript, summarizeCodexTranscript } from '../../../harness/delegation-capture'
import { readLedger } from '../../../harness/delegation-ledger'

const exec = promisify(execFile)
// A commit hook exports GIT_* variables: a fixture repository must never inherit them.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
const FIXTURES = join(__dirname, '../../fixtures/delegation-capture')
const fixture = (name: string) => readFile(join(FIXTURES, name), 'utf8')
const NOW = () => new Date('2026-10-20T08:05:00.000Z')

describe('the delegate line (#1035)', () => {
  it('reads the verdict and every field the delegate gives', () => {
    expect(parseDelegationLine('Done.\n\nSF-DELEGATION: pass kind=multi-file-feature ticket=1035 complexity=complex nature=internal trial=yes checks=type-check,automated-tests')).toEqual({
      verdict: 'pass',
      kind: 'multi-file-feature',
      ticket: 1035,
      complexity: 'complex',
      nature: 'internal',
      trial: true,
      checks: ['type-check', 'automated-tests'],
      ignored: []
    })
  })

  it('takes the last line when the message quotes an earlier one', () => {
    const message = 'The contract says `SF-DELEGATION: pass kind=tests`.\nSF-DELEGATION: fail kind=bug-fix ticket=#12 checks=none'
    expect(parseDelegationLine(message)).toMatchObject({ verdict: 'fail', kind: 'bug-fix', ticket: 12, checks: [] })
  })

  it('survives the markdown a model puts around it', () => {
    expect(parseDelegationLine('**SF-DELEGATION: pass kind=tests checks=automated-tests**')).toMatchObject({ verdict: 'pass', kind: 'tests', checks: ['automated-tests'] })
    expect(parseDelegationLine('> `SF-DELEGATION: fail kind=review`')).toMatchObject({ verdict: 'fail', kind: 'review' })
  })

  it('keeps a value it does not understand as unknown instead of refusing the line', () => {
    expect(parseDelegationLine('SF-DELEGATION: pass kind=deploy ticket=abc complexity=huge checks=vibes,type-check owner=me')).toEqual({
      verdict: 'pass',
      kind: null,
      ticket: null,
      complexity: null,
      nature: null,
      trial: false,
      checks: ['type-check'],
      ignored: ['owner']
    })
  })

  it.each([
    ['no line', 'I am done.'],
    ['no verdict', 'SF-DELEGATION: kind=tests'],
    ['a verdict that is not pass or fail', 'SF-DELEGATION: maybe kind=tests'],
    ['the line in the middle of a sentence', 'Please end with SF-DELEGATION: pass kind=tests'],
    ['something that is not text', undefined]
  ])('finds nothing in %s', (_, message) => {
    expect(parseDelegationLine(message)).toBeUndefined()
  })
})

describe('transcripts (#1035)', () => {
  it('sums a Claude Code subagent transcript over its distinct API calls, not its streamed lines', async () => {
    expect(summarizeClaudeTranscript(await fixture('claude-subagent.jsonl'))).toEqual({
      tokens: { input: 10, output: 850, cacheRead: 2200, cacheWrite: 1200 },
      calls: 4,
      model: 'claude-sonnet-5-5',
      durationMs: 200_000
    })
  })

  it('knows nothing from a transcript without usage, and keeps the duration it can see', () => {
    const text = '{"type":"user","timestamp":"2026-10-20T08:00:00.000Z"}\n{"type":"user","timestamp":"2026-10-20T08:00:09.000Z"}\n{torn'
    expect(summarizeClaudeTranscript(text)).toEqual({ calls: 0, durationMs: 9000 })
    expect(summarizeClaudeTranscript('')).toEqual({ calls: 0 })
  })

  it('reads the last cumulative token report of a Codex rollout, with the cached input priced apart', async () => {
    expect(summarizeCodexTranscript(await fixture('codex-rollout.jsonl'))).toEqual({
      tokens: { input: 5000, output: 1500, cacheRead: 15000, cacheWrite: 0 },
      calls: 2,
      model: 'gpt-6.1-sol',
      durationMs: 91_000
    })
  })

  it('reports no tokens for a Codex rollout that never counted them', () => {
    expect(summarizeCodexTranscript('{"timestamp":"2026-10-20T09:00:00.000Z","type":"session_meta","payload":{}}\n')).toEqual({ calls: 0 })
  })
})

describe('capturing a host event (#1035)', () => {
  let root: string
  let transcripts: string
  const git = async (...args: string[]) => (await exec('git', args, { cwd: root, env: cleanEnv })).stdout.trim()
  const manifest = (harness: Record<string, unknown> = { version: 4, agents: ['claude-code', 'codex'] }) =>
    writeFile(join(root, '.saasfoundry.json'), JSON.stringify({ version: 'test', projectName: 'capture-demo', structure: 'cli', modules: { harness } }))
  const payload = async (name: string, transcript: string | undefined, extra: Record<string, unknown> = {}) => {
    const text = (await fixture(name)).replaceAll('__CWD__', root).replaceAll('__TRANSCRIPT__', transcript ?? join(transcripts, 'absent.jsonl'))
    return { ...JSON.parse(text), ...extra }
  }
  const claudeTranscript = async () => {
    const path = join(transcripts, 'claude.jsonl')
    await copyFile(join(FIXTURES, 'claude-subagent.jsonl'), path)
    return path
  }
  const ledger = async () => readLedger(join(root, '.git', 'saasfoundry'))

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'sf-capture-')))
    transcripts = await realpath(await mkdtemp(join(tmpdir(), 'sf-capture-transcripts-')))
    await git('init', '-q', '-b', 'main')
    await manifest()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(transcripts, { recursive: true, force: true })
  })

  describe('Claude Code', () => {
    it('records one run from a SubagentStop: tier from the agent, usage from the transcript, outcome from the delegate line', async () => {
      const result = await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', await claudeTranscript()), { now: NOW })
      expect(result.status).toBe('appended')
      const [run] = (await ledger()).runs
      expect(run).toMatchObject({
        host: 'claude-code',
        provider: 'claude-code',
        tier: 'build',
        ticket: 1035,
        taskKind: 'multi-file-feature',
        complexity: 'complex',
        nature: 'user-facing',
        candidate: { model: 'claude-sonnet-5-5', effort: 'xhigh' },
        trial: false,
        durationMs: 200_000,
        tokens: { input: 10, output: 850, cacheRead: 2200, cacheWrite: 1200 },
        cost: { amount: '0.01196000', currency: 'USD' },
        metering: 'complete',
        outcome: 'success',
        checks: ['type-check', 'automated-tests'],
        at: NOW().toISOString(),
        censored: false
      })
    })

    it('joins the PostToolUse of the same agent to its stop, whichever comes first, and counts one run', async () => {
      const stop = await payload('claude-subagent-stop.json', await claudeTranscript())
      const tool = await payload('claude-post-tool-use.json', undefined)
      await captureHostEvent('claude-code', tool, { now: NOW })
      expect((await captureHostEvent('claude-code', stop, { now: NOW })).status).toBe('merged')
      const afterwards = (await ledger()).runs
      expect(afterwards).toHaveLength(1)
      expect(afterwards[0]).toMatchObject({ taskKind: 'multi-file-feature', outcome: 'success', tokens: { output: 850 }, durationMs: 201_500, candidate: { model: 'claude-sonnet-5-5-20261001' } })
      // The dated snapshot of a priced model is priced as the model.
      expect(afterwards[0].cost).not.toBeNull()
      expect((await captureHostEvent('claude-code', stop, { now: NOW })).status).toBe('replayed')
      expect((await ledger()).runs).toHaveLength(1)
    })

    it('adds the tool status of a PostToolUse that comes after the stop, without touching the usage and duration it already has', async () => {
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', await claudeTranscript()), { now: NOW })
      const result = await captureHostEvent('claude-code', await payload('claude-post-tool-use.json', undefined), { now: NOW })
      expect(result.status).toBe('merged')
      const [run] = (await ledger()).runs
      expect(run).toMatchObject({ tokens: { input: 10, output: 850, cacheRead: 2200, cacheWrite: 1200 }, durationMs: 200_000, outcome: 'success' })
      expect(run.evidenceRefs).toContain('tool-status:completed')
    })

    it('reads a tool result that says the agent failed as an execution failure, which a later pass does not undo', async () => {
      await captureHostEvent('claude-code', await payload('claude-post-tool-use.json', undefined, { tool_response: { status: 'failed', agentId: 'a1b2c3', totalDurationMs: 5000 } }), { now: NOW })
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', await claudeTranscript()), { now: NOW })
      expect((await ledger()).runs[0]).toMatchObject({ outcome: 'execution-failed', effectiveOutcome: 'execution-failed', taskKind: 'multi-file-feature' })
    })

    it('ignores a background launch: the stop carries the result', async () => {
      const result = await captureHostEvent('claude-code', await payload('claude-post-tool-use.json', undefined, { tool_response: { status: 'async_launched', agentId: 'a1b2c3' } }), { now: NOW })
      expect(result).toEqual({ status: 'ignored', reason: 'a background launch: the agent stop carries the result' })
      expect((await ledger()).runs).toHaveLength(0)
    })

    it('records the usage as unknown, and still keeps the run, when the transcript cannot be read', async () => {
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', join(transcripts, 'missing.jsonl')), { now: NOW })
      const [run] = (await ledger()).runs
      expect(run).toMatchObject({ tokens: null, cost: null, durationMs: null, metering: 'unknown', outcome: 'success', taskKind: 'multi-file-feature' })
      // The model is the configured one: the transcript is the only place the observed one would come from.
      expect(run.candidate).toEqual({ model: 'claude-sonnet-5-5', effort: 'xhigh' })
    })

    it('does not follow a transcript path that is a link', async () => {
      const real = await claudeTranscript()
      const link = join(transcripts, 'link.jsonl')
      await symlink(real, link)
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', link), { now: NOW })
      expect((await ledger()).runs[0].tokens).toBeNull()
    })

    it('never counts a delegate that did not say what it did as a success, and censors it', async () => {
      const bare = await payload('claude-subagent-stop.json', await claudeTranscript(), { last_assistant_message: 'All done, I think.' })
      await captureHostEvent('claude-code', bare, { now: NOW })
      const [run] = (await ledger()).runs
      expect(run).toMatchObject({ outcome: 'outcome-unknown', taskKind: null, censored: true, effectiveOutcome: 'outcome-unknown' })
      expect(run.evidenceRefs).toContain('no-sf-delegation-line')
    })

    it('does not trust a pass that names no check: it is unknown', async () => {
      const unchecked = await payload('claude-subagent-stop.json', await claudeTranscript(), { last_assistant_message: 'SF-DELEGATION: pass kind=tests ticket=1035 checks=none' })
      await captureHostEvent('claude-code', unchecked, { now: NOW })
      const [run] = (await ledger()).runs
      expect(run).toMatchObject({ outcome: 'outcome-unknown', taskKind: 'tests', censored: true })
      expect(run.evidenceRefs).toContain('pass-without-check')
    })

    it('records a declared failure as a failed validation', async () => {
      const failed = await payload('claude-subagent-stop.json', await claudeTranscript(), { last_assistant_message: 'SF-DELEGATION: fail kind=multi-file-feature ticket=1035 checks=type-check' })
      await captureHostEvent('claude-code', failed, { now: NOW })
      expect((await ledger()).runs[0]).toMatchObject({ outcome: 'validation-failed', censored: false })
    })

    it('flags a run on a cheaper tier than the kind is routed to as a trial, and a run on a stronger tier as not one', async () => {
      const onEdit = await payload('claude-subagent-stop.json', await claudeTranscript(), { agent_type: 'sf-edit', agent_id: 'cheap' })
      const onFix = await payload('claude-subagent-stop.json', await claudeTranscript(), { agent_type: 'sf-fix', agent_id: 'strong' })
      await captureHostEvent('claude-code', onEdit, { now: NOW })
      await captureHostEvent('claude-code', onFix, { now: NOW })
      const byTier = new Map((await ledger()).runs.map((run) => [run.tier, run]))
      expect(byTier.get('edit')).toMatchObject({ trial: true, candidate: { effort: 'high' } })
      expect(byTier.get('fix')!.trial).toBe(false)
    })

    it('lets the delegate say it is a trial', async () => {
      const said = await payload('claude-subagent-stop.json', undefined, { last_assistant_message: 'SF-DELEGATION: pass kind=multi-file-feature ticket=1035 trial=yes checks=type-check' })
      await captureHostEvent('claude-code', said, { now: NOW })
      expect((await ledger()).runs[0].trial).toBe(true)
    })

    it('asks the routing which tier the kind is on, so a local adjustment is taken into account', async () => {
      const stop = await payload('claude-subagent-stop.json', undefined)
      await captureHostEvent('claude-code', stop, { now: NOW, effectiveTier: () => 'plan' })
      expect((await ledger()).runs[0].trial).toBe(true)
    })

    it('prices from the project declaration when the catalogue does not know the model', async () => {
      await manifest({ version: 4, agents: ['claude-code'], routing: { adjust: { prices: { 'claude-sonnet-5-5': { input: '1', output: '1' } } } } })
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', await claudeTranscript()), { now: NOW })
      // 10 input + 850 output at $1 per million, 2200 cache reads at a tenth and 1200 cache writes at 1.25 times the declared input
      expect((await ledger()).runs[0].cost).toEqual({ amount: '0.00258000', currency: 'USD' })
    })
  })

  describe('evidence that must not be lost', () => {
    it('keeps the run, against the shipped grid and marked, when the manifest routing cannot be read', async () => {
      await manifest({ version: 4, agents: ['claude-code'], routing: { kinds: { tests: { tier: 'nowhere' } } } })
      const result = await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', await claudeTranscript()), { now: NOW })
      expect(result.status).toBe('appended')
      const [run] = (await ledger()).runs
      expect(run).toMatchObject({ tier: 'build', taskKind: 'multi-file-feature', outcome: 'success', cost: { amount: '0.01196000' } })
      expect(run.evidenceRefs).toContain('routing-unreadable')
      await writeFile(join(root, '.saasfoundry.json'), '{ nope')
      expect((await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', undefined, { agent_id: 'second' }), { now: NOW })).status).toBe('appended')
    })

    it('hashes an agent id that is not a plain token instead of recording it', async () => {
      const odd = '/Users/me/.claude/projects/p/api_key=abcdefabcdef\nnext'
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', undefined, { agent_id: odd }), { now: NOW })
      const [run] = (await ledger()).runs
      expect(run.eventKey).toMatch(/^claude-code:[0-9a-f]{16}$/)
      expect(run.evidenceRefs[0]).toMatch(/^agent:[0-9a-f]{16}$/)
      expect(JSON.stringify(run)).not.toContain('api_key')
    })
  })

  describe('Codex', () => {
    const rollout = async () => {
      const path = join(transcripts, 'rollout.jsonl')
      await copyFile(join(FIXTURES, 'codex-rollout.jsonl'), path)
      return path
    }

    it('records a run with its usage when the rollout is parsable, unpriced until the project declares a rate', async () => {
      await captureHostEvent('codex', await payload('codex-subagent-stop.json', await rollout()), { now: NOW })
      const [run] = (await ledger()).runs
      expect(run).toMatchObject({
        host: 'codex',
        provider: 'codex',
        tier: 'build',
        taskKind: 'tests',
        candidate: { model: 'gpt-6.1-sol', effort: 'medium' },
        tokens: { input: 5000, output: 1500, cacheRead: 15000, cacheWrite: 0 },
        durationMs: 91_000,
        cost: null,
        metering: 'complete',
        outcome: 'success'
      })
    })

    it('prices the run once the project declares the rate', async () => {
      await manifest({ version: 4, agents: ['codex'], routing: { adjust: { prices: { 'gpt-6.1-sol': { input: '0.30', output: '1.20', cacheRead: '0.03' } } } } })
      await captureHostEvent('codex', await payload('codex-subagent-stop.json', await rollout()), { now: NOW })
      // 5000 x 0.30 + 1500 x 1.20 + 15000 x 0.03 per million
      expect((await ledger()).runs[0].cost).toEqual({ amount: '0.00375000', currency: 'USD' })
    })

    it('keeps the run with unknown usage when there is no parsable rollout', async () => {
      await captureHostEvent('codex', await payload('codex-subagent-stop.json', join(transcripts, 'missing.jsonl')), { now: NOW })
      expect((await ledger()).runs[0]).toMatchObject({ tokens: null, metering: 'unknown', outcome: 'success' })
    })
  })

  describe('what is not a delegation', () => {
    it.each<[string, unknown, string]>([
      ['a payload that is not an object', 'text', 'not a JSON object'],
      ['another hook event', { hook_event_name: 'SessionStart' }, 'is not a delegation event'],
      ['a tool that is not the delegation tool', { hook_event_name: 'PostToolUse', tool_name: 'Bash' }, 'is not a delegation event'],
      ['an agent that is not routed', { hook_event_name: 'SubagentStop', agent_type: 'Explore' }, 'not a routed sf-<tier> agent']
    ])('ignores %s', async (_, body, reason) => {
      const result = await captureHostEvent('claude-code', body, { now: NOW })
      expect(result.status).toBe('ignored')
      expect((result as { reason: string }).reason).toContain(reason)
    })

    it('ignores a tier the project never declared for the host', async () => {
      const result = await captureHostEvent('claude-code', { hook_event_name: 'SubagentStop', agent_type: 'sf-nowhere', cwd: root }, { now: NOW })
      expect(result).toEqual({ status: 'ignored', reason: 'tier nowhere is not declared for claude-code' })
    })

    it('ignores an event outside a Git checkout, which has no clone to keep a ledger in', async () => {
      const elsewhere = await realpath(await mkdtemp(join(tmpdir(), 'sf-capture-nogit-')))
      try {
        const result = await captureHostEvent('claude-code', { hook_event_name: 'SubagentStop', agent_type: 'sf-build', cwd: elsewhere }, { now: NOW, root: elsewhere })
        expect(result.status).toBe('ignored')
      } finally {
        await rm(elsewhere, { recursive: true, force: true })
      }
    })

    it('finds the project from a subdirectory the agent stood in', async () => {
      await mkdir(join(root, 'src', 'deep'), { recursive: true })
      const stop = await payload('claude-subagent-stop.json', undefined, { cwd: join(root, 'src', 'deep') })
      expect((await captureHostEvent('claude-code', stop, { now: NOW })).status).toBe('appended')
    })
  })
})
