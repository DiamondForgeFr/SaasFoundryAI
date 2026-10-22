import { execFile } from 'child_process'
import { appendFile, copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, truncate, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

import {
  captureHostEvent,
  parseDelegationLine,
  readTranscriptSlice,
  summarizeClaudeLines,
  summarizeClaudeTranscript,
  summarizeCodexLines,
  summarizeCodexTranscript
} from '../../../harness/delegation-capture'
import { agentToken, buildRouteRecord, readLedger, transact } from '../../../harness/delegation-ledger'
import { issueRoutes, loadRoutingState } from '../../../harness/routing-runtime'

const exec = promisify(execFile)
// A commit hook exports GIT_* variables: a fixture repository must never inherit them.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
const FIXTURES = join(__dirname, '../../fixtures/delegation-capture')
const LIVE = join(FIXTURES, 'live')
const fixture = (name: string, directory = FIXTURES) => readFile(join(directory, name), 'utf8')
const NOW = () => new Date('2026-10-20T08:05:00.000Z')

describe('the delegate line (#1035)', () => {
  it('reads the verdict, the route and the checks it gives', () => {
    expect(parseDelegationLine('Done.\n\nSF-DELEGATION: pass route=0123456789abcdef0123 checks=type-check,automated-tests')).toEqual({
      verdict: 'pass',
      route: '0123456789abcdef0123',
      checks: ['type-check', 'automated-tests'],
      ignored: []
    })
  })

  it('reads a claim of kind, ticket or trial as noise: it is reported as ignored, never believed', () => {
    expect(parseDelegationLine('SF-DELEGATION: pass route=0123456789abcdef0123 kind=review ticket=1 trial=yes checks=type-check')).toEqual({
      verdict: 'pass',
      route: '0123456789abcdef0123',
      checks: ['type-check'],
      ignored: ['kind', 'ticket', 'trial']
    })
  })

  it('takes the last line when the message quotes an earlier one', () => {
    const message = 'The contract says `SF-DELEGATION: pass checks=type-check`.\nSF-DELEGATION: fail route=0123456789abcdef0123 checks=none'
    expect(parseDelegationLine(message)).toMatchObject({ verdict: 'fail', checks: [] })
  })

  it('survives the markdown a model puts around it', () => {
    expect(parseDelegationLine('**SF-DELEGATION: pass checks=automated-tests**')).toMatchObject({ verdict: 'pass', checks: ['automated-tests'] })
    expect(parseDelegationLine('- `SF-DELEGATION: fail checks=none`')).toMatchObject({ verdict: 'fail' })
  })

  it('keeps a value it does not understand as unknown instead of refusing the line', () => {
    expect(parseDelegationLine('SF-DELEGATION: pass route=xyz checks=vibes,type-check owner=me')).toEqual({ verdict: 'pass', route: null, checks: ['type-check'], ignored: ['owner'] })
  })

  it.each([
    ['no line', 'I am done.'],
    ['no verdict', 'SF-DELEGATION: route=0123456789abcdef0123'],
    ['a verdict that is not pass or fail', 'SF-DELEGATION: maybe'],
    ['the line in the middle of a sentence', 'Please end with SF-DELEGATION: pass'],
    ['a line followed by more text: it is not the closing line', 'SF-DELEGATION: pass checks=type-check\nAnd one more thing.'],
    ['a quoted line', '> SF-DELEGATION: pass checks=type-check'],
    ['a line inside a code fence', 'Example:\n```\nSF-DELEGATION: pass checks=type-check\n```'],
    ['something that is not text', undefined]
  ])('finds nothing in %s', (_, message) => {
    expect(parseDelegationLine(message)).toBeUndefined()
  })

  it('finds the line after a code fence has been closed', () => {
    expect(parseDelegationLine('```\nSF-DELEGATION: fail\n```\n\nSF-DELEGATION: pass checks=type-check\n\n')).toMatchObject({ verdict: 'pass' })
  })

  // R3: a window cut inside a code block reads open as closed and closed as open.
  describe('follows the code fences from the start of the message, however long a block is (R3)', () => {
    const diff = Array.from({ length: 600 }, (_, index) => `+  line ${index} of a long diff, long enough to push the closing line well out of any fixed window`).join('\n')
    const line = 'SF-DELEGATION: pass route=0123456789abcdef0123 checks=type-check'

    it('finds the line after a code block of more than 8 KB', () => {
      const message = `Done.\n\n\`\`\`diff\n${diff}\n\`\`\`\n\n${line}`
      expect(message.length).toBeGreaterThan(4 * 8 * 1024)
      expect(parseDelegationLine(message)).toMatchObject({ verdict: 'pass', route: '0123456789abcdef0123', checks: ['type-check'] })
    })

    it('still takes a line written inside a block that long as an example, not as the verdict', () => {
      expect(parseDelegationLine(`\`\`\`diff\n${diff}\n${line}\n\`\`\``)).toBeUndefined()
      expect(parseDelegationLine(`\`\`\`diff\n${diff}\n${line}`)).toBeUndefined()
    })

    it('closes a block only with the same mark at least as long: a shorter fence or the other mark is part of the block', () => {
      expect(parseDelegationLine(`~~~\n\`\`\`\n${line}\n~~~\n${line}`)).toMatchObject({ verdict: 'pass' })
      expect(parseDelegationLine(`~~~\n\`\`\`\n${line}`)).toBeUndefined()
      expect(parseDelegationLine(`\`\`\`\`md\n\`\`\`\n${line}\n\`\`\`\`\n${line}`)).toMatchObject({ verdict: 'pass' })
      expect(parseDelegationLine(`\`\`\`\`md\n\`\`\`\n${line}`)).toBeUndefined()
    })

    it('does not take a line of inline code with three backticks for a fence, and reads a message with Windows line endings', () => {
      expect(parseDelegationLine(`Run \`\`\`sf\`\`\` now.\r\n${line}\r\n`)).toMatchObject({ verdict: 'pass' })
    })

    it('reads a message of several megabytes in one linear pass', () => {
      const started = Date.now()
      const big = `\`\`\`\n${'x'.repeat(40)}\n`.repeat(50_000)
      expect(parseDelegationLine(`${big}\`\`\`\n${line}`)).toBeUndefined()
      expect(Date.now() - started).toBeLessThan(2_000)
    })
  })

  it('reads a long message in linear time, whatever the blank lines before the line', () => {
    const message = `${'\n'.repeat(400_000)}SF-DELEGATION: pass checks=type-check${'\n'.repeat(1_000)}`
    const started = Date.now()
    expect(parseDelegationLine(message)).toMatchObject({ verdict: 'pass' })
    expect(parseDelegationLine('a'.repeat(300_000))).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})

describe('transcripts (#1035)', () => {
  it('sums a Claude Code subagent transcript over its distinct API calls, not its streamed lines', async () => {
    const summary = summarizeClaudeTranscript(await fixture('claude-subagent.jsonl'))
    expect(summary).toMatchObject({ tokens: { input: 10, output: 850, cacheRead: 2200, cacheWrite: 1200 }, count: 4, model: 'claude-sonnet-5-5', activeMs: 200_000 })
    expect(summary.calls).toHaveLength(4)
  })

  it('counts the active time of a transcript, not the span: a long wait between two events is capped', () => {
    const lines = [
      '{"type":"user","timestamp":"2026-10-20T08:00:00.000Z"}',
      '{"type":"user","timestamp":"2026-10-20T08:00:09.000Z"}',
      '{"type":"user","timestamp":"2026-10-21T08:00:09.000Z"}',
      '{"type":"user","timestamp":"2026-10-21T08:00:19.000Z"}'
    ]
    // 9 s, then a day of waiting capped at 5 minutes, then 10 s
    expect(summarizeClaudeLines(lines).activeMs).toBe(9_000 + 300_000 + 10_000)
  })

  it('knows nothing from a transcript without usage, and keeps the active time it can see', () => {
    const text = '{"type":"user","timestamp":"2026-10-20T08:00:00.000Z"}\n{"type":"user","timestamp":"2026-10-20T08:00:09.000Z"}\n{torn'
    expect(summarizeClaudeTranscript(text)).toEqual({ count: 0, activeMs: 9000 })
    expect(summarizeClaudeTranscript('')).toEqual({ count: 0 })
  })

  it('parses only the lines that carry a usage', () => {
    const parse = jest.spyOn(JSON, 'parse')
    try {
      const filler = Array.from({ length: 500 }, (_, index) => `{"type":"attachment","timestamp":"2026-10-20T08:00:${String(index % 60).padStart(2, '0')}.000Z","blob":"x"}`)
      summarizeClaudeLines([...filler, '{"type":"assistant","message":{"id":"m","model":"claude-sonnet-5-5","usage":{"input_tokens":1,"output_tokens":2}}}'])
      expect(parse).toHaveBeenCalledTimes(1)
    } finally {
      parse.mockRestore()
    }
  })

  it('reads the last cumulative token report of a Codex rollout, with the cached input priced apart', async () => {
    expect(summarizeCodexTranscript(await fixture('codex-rollout.jsonl'))).toEqual({
      tokens: { input: 5000, output: 1500, cacheRead: 15000, cacheWrite: 0 },
      count: 2,
      model: 'gpt-6.1-sol',
      activeMs: 91_000
    })
  })

  it('bills a resumed Codex agent for its own turns only: the cumulative report minus what its earlier stops counted', async () => {
    const text = await fixture('codex-rollout.jsonl')
    expect(summarizeCodexTranscript(text, { input: 1000, output: 500, cacheRead: 5000, cacheWrite: 0 }).tokens).toEqual({ input: 4000, output: 1000, cacheRead: 10000, cacheWrite: 0 })
    expect(summarizeCodexLines(text.split('\n'), { input: 99999, output: 99999, cacheRead: 99999, cacheWrite: 99999 }).tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  })

  it('reports no tokens for a Codex rollout that never counted them', () => {
    expect(summarizeCodexTranscript('{"timestamp":"2026-10-20T09:00:00.000Z","type":"session_meta","payload":{}}\n')).toEqual({ count: 0 })
  })

  describe('reading a transcript by slices', () => {
    let directory: string
    beforeEach(async () => {
      directory = await realpath(await mkdtemp(join(tmpdir(), 'sf-slices-')))
    })
    afterEach(async () => rm(directory, { recursive: true, force: true }))

    it('returns only the complete lines written since the offset, and says where to continue', async () => {
      const path = join(directory, 't.jsonl')
      await writeFile(path, '{"a":1}\n{"b":2}\n{"c":')
      const first = await readTranscriptSlice(path)
      expect(first).toEqual({ lines: ['{"a":1}', '{"b":2}'], from: 0, to: 16, truncated: false })
      await appendFile(path, '3}\n{"d":4}\n')
      const next = await readTranscriptSlice(path, first!.to)
      expect(next).toEqual({ lines: ['{"c":3}', '{"d":4}'], from: 16, to: 32, truncated: false })
      expect(await readTranscriptSlice(path, next!.to)).toEqual({ lines: [], from: 32, to: 32, truncated: false })
    })

    it('counts a last line without a newline when it is a whole JSON value', async () => {
      const path = join(directory, 't.jsonl')
      await writeFile(path, '{"a":1}\n{"b":2}')
      expect((await readTranscriptSlice(path))?.lines).toEqual(['{"a":1}', '{"b":2}'])
    })

    it('starts over when the file is shorter than the offset: it is not the transcript the offset belongs to', async () => {
      const path = join(directory, 't.jsonl')
      await writeFile(path, '{"a":1}\n{"b":2}\n')
      await truncate(path, 8)
      expect(await readTranscriptSlice(path, 100)).toEqual({ lines: ['{"a":1}'], from: 0, to: 8, truncated: false })
    })

    it('refuses a link, a relative path and a path that is not text', async () => {
      const path = join(directory, 't.jsonl')
      await writeFile(path, '{"a":1}\n')
      await symlink(path, join(directory, 'link.jsonl'))
      expect(await readTranscriptSlice(join(directory, 'link.jsonl'))).toBeUndefined()
      expect(await readTranscriptSlice('relative/t.jsonl')).toBeUndefined()
      expect(await readTranscriptSlice(undefined)).toBeUndefined()
      expect(await readTranscriptSlice(join(directory, 'missing.jsonl'))).toBeUndefined()
    })
  })

  describe('real payloads captured from the hosts', () => {
    it('sums the real Claude Code subagent transcript: four API calls of one model, streamed over eight lines', async () => {
      const summary = summarizeClaudeTranscript(await fixture('claude-subagent-transcript.jsonl', LIVE))
      expect(summary.count).toBe(4)
      expect(summary.model).toBe('claude-haiku-5-5')
      expect(summary.tokens).toEqual({ input: 10, output: 1676, cacheRead: 79_746, cacheWrite: 29_096 })
      expect(summary.activeMs).toBe(15_899)
    })

    it('reads the real Codex rollout: the subagent model, and its cumulative usage with the cached input apart', async () => {
      const summary = summarizeCodexTranscript(await fixture('codex-subagent-rollout.jsonl', LIVE))
      expect(summary.model).toBe('gpt-6.1-sol')
      expect(summary.tokens).toEqual({ input: 32_709, output: 135, cacheRead: 32_256, cacheWrite: 0 })
      expect(summary.count).toBe(2)
    })
  })
})

describe('capturing a host event (#1035)', () => {
  let root: string
  let transcripts: string
  const ledgerDir = () => join(root, '.git', 'saasfoundry')
  const git = async (...args: string[]) => (await exec('git', args, { cwd: root, env: cleanEnv })).stdout.trim()
  /** The manifest of the project, committed: the prices and the overrides a capture applies are the committed ones. */
  const manifest = async (harness: Record<string, unknown> = { version: 4, agents: ['claude-code', 'codex'] }) => {
    await writeFile(join(root, '.saasfoundry.json'), JSON.stringify({ version: 'test', projectName: 'capture-demo', structure: 'cli', modules: { harness } }))
    await git('add', '.saasfoundry.json')
    await git('-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'manifest')
  }
  /** A route as `sf agents route --record` issues it; the delegate echoes its id. */
  const issue = async (overrides: Partial<Parameters<typeof buildRouteRecord>[0]> & { id?: string } = {}) => {
    const { id, ...input } = overrides
    const route = {
      ...buildRouteRecord({ taskKind: 'multi-file-feature', provider: 'claude-code', tier: 'build', trial: false, ticket: 1035, complexity: 'complex', nature: 'user-facing', now: NOW(), ...input }),
      ...(id ? { id } : {})
    }
    await transact(ledgerDir(), ({ append }) => append(route))
    return route
  }
  const payload = async (name: string, transcript: string | undefined, extra: Record<string, unknown> = {}, route?: string, directory = FIXTURES) => {
    const text = (await fixture(name, directory))
      .replaceAll('__CWD__', root)
      .replaceAll('__TRANSCRIPT__', transcript ?? join(transcripts, 'absent.jsonl'))
      .replaceAll('__ROUTE__', route ?? 'f'.repeat(20))
    return { ...JSON.parse(text), ...extra }
  }
  const claudeTranscript = async () => {
    const path = join(transcripts, 'claude.jsonl')
    await copyFile(join(FIXTURES, 'claude-subagent.jsonl'), path)
    return path
  }
  const ledger = async () => readLedger(ledgerDir())

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
    it('records one run from a SubagentStop: tier from the agent, usage from the transcript, kind and ticket from the route record, outcome from the delegate line', async () => {
      const route = await issue()
      const result = await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', await claudeTranscript(), {}, route.id), { now: NOW })
      expect(result.status).toBe('appended')
      const [run] = (await ledger()).runs
      expect(run).toMatchObject({
        host: 'claude-code',
        provider: 'claude-code',
        tier: 'build',
        route: route.id,
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
        censored: false,
        decisive: true
      })
      expect(run.agentId).toBe(agentToken('a1b2c3'))
      expect(run.agentId).toMatch(/^[0-9a-f]{16}$/)
    })

    it('does not believe what the delegate says about its own kind, ticket or trial: the route record decides', async () => {
      const route = await issue({ taskKind: 'tests', ticket: 7, trial: false })
      const lie = 'SF-DELEGATION: pass route=ROUTE kind=exploration ticket=999 trial=yes checks=type-check'.replace('ROUTE', route.id)
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', undefined, { last_assistant_message: lie }, route.id), { now: NOW })
      expect((await ledger()).runs[0]).toMatchObject({ taskKind: 'tests', ticket: 7, trial: false })
    })

    it('takes the trial flag and the retry link from the route record', async () => {
      const first = await issue({ tier: 'edit' })
      const retry = await issue({ tier: 'build', trial: true, retryOf: first.id })
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', undefined, {}, retry.id), { now: NOW })
      expect((await ledger()).runs[0]).toMatchObject({ trial: true, retryOf: first.id })
    })

    it.each<[string, (route: Awaited<ReturnType<typeof issue>>) => Promise<string>, string]>([
      ['no route id in the delegate line', async () => 'SF-DELEGATION: pass checks=type-check', 'no-route'],
      ['a route id that the ledger does not know', async () => `SF-DELEGATION: pass route=${'e'.repeat(20)} checks=type-check`, 'unknown-route']
    ])('censors a run with %s, and keeps it', async (_, line, reason) => {
      const route = await issue()
      const message = await line(route)
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', undefined, { last_assistant_message: message }), { now: NOW })
      const [run] = (await ledger()).runs
      expect(run).toMatchObject({ taskKind: null, ticket: null, trial: false, censored: true, decisive: false, outcome: 'success' })
      expect(run.evidenceRefs).toContain(reason)
    })

    it('censors a run whose route was issued for another tier, another agent, or an agent that already used it', async () => {
      const other = await issue({ tier: 'fix' })
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', undefined, {}, other.id), { now: NOW })
      expect((await ledger()).runs[0]).toMatchObject({ taskKind: null, censored: true })
      expect((await ledger()).runs[0].evidenceRefs).toContain('route-tier-mismatch')

      const codex = await issue({ provider: 'codex' })
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', undefined, { agent_id: 'second' }, codex.id), { now: NOW })
      expect((await ledger()).runs.find((run) => run.agentId === agentToken('second'))?.evidenceRefs).toContain('route-provider-mismatch')

      const mine = await issue()
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', undefined, { agent_id: 'third' }, mine.id), { now: NOW })
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', undefined, { agent_id: 'fourth' }, mine.id), { now: NOW })
      const byAgent = new Map((await ledger()).runs.map((run) => [run.agentId, run]))
      expect(byAgent.get(agentToken('third'))).toMatchObject({ taskKind: 'multi-file-feature', censored: false })
      expect(byAgent.get(agentToken('fourth'))).toMatchObject({ taskKind: null, censored: true })
      expect(byAgent.get(agentToken('fourth'))?.evidenceRefs).toContain('route-used-by-another-agent')
    })

    // R5: a first stop on a route nobody used, after its reservation lapsed, would land as a trial outside the share that was counted.
    it('censors a first stop that lands after the reservation of its route lapsed, and accepts one inside it (R5)', async () => {
      const day = 86_400_000
      const lapsed = await issue({ now: new Date(NOW().getTime() - 8 * day) })
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', undefined, { agent_id: 'late' }, lapsed.id), { now: NOW })
      const inside = await issue({ now: new Date(NOW().getTime() - 6 * day), trial: true })
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', undefined, { agent_id: 'inside' }, inside.id), { now: NOW })
      const byAgent = new Map((await ledger()).runs.map((run) => [run.agentId, run]))
      expect(byAgent.get(agentToken('late'))).toMatchObject({ taskKind: null, trial: false, censored: true, route: lapsed.id })
      expect(byAgent.get(agentToken('late'))?.evidenceRefs).toContain('route-expired')
      expect(byAgent.get(agentToken('inside'))).toMatchObject({ taskKind: 'multi-file-feature', trial: true, censored: false })
    })

    it('never expires the route of an agent that already used it: a hand-back days later is still its delegation (R5)', async () => {
      const route = await issue()
      const path = join(transcripts, 'claude.jsonl')
      const lines = (await fixture('claude-subagent.jsonl')).trim().split('\n')
      await writeFile(path, `${lines.slice(0, 6).join('\n')}\n`)
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', path, {}, route.id), { now: NOW })
      await appendFile(path, `${lines.slice(6).join('\n')}\n`)
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', path, {}, route.id), { now: () => new Date(NOW().getTime() + 9 * 86_400_000) })
      const { runs } = await ledger()
      expect(runs).toHaveLength(2)
      expect(runs[1]).toMatchObject({ taskKind: 'multi-file-feature', ticket: 1035, continues: runs[0].id, censored: false })
      expect(runs[1].evidenceRefs).not.toContain('route-expired')
    })

    // R4, from the other side: the route a retry gets is the one the capture accepts for the stronger tier.
    it('attributes the retry of a failed delegation to the stronger tier its route was issued for, and marks the first run as not having done the job (R4)', async () => {
      const first = await issue({ tier: 'edit', taskKind: 'scoped-edit' })
      await captureHostEvent(
        'claude-code',
        await payload(
          'claude-subagent-stop.json',
          undefined,
          { agent_type: 'sf-edit', agent_id: 'cheap', last_assistant_message: `SF-DELEGATION: fail route=${first.id} checks=type-check` },
          first.id
        ),
        { now: NOW }
      )
      const failed = (await ledger()).runs.find((run) => run.tier === 'edit')!
      const [retry] = await issueRoutes(await loadRoutingState(root), 'scoped-edit', ['claude-code'], { record: true, trial: false, retryOf: failed.id, now: NOW() })
      expect(retry.tier).toBe('build')
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', undefined, { agent_type: 'sf-build', agent_id: 'strong' }, retry.routeId!), {
        now: () => new Date(NOW().getTime() + 60_000)
      })
      const { runs } = await ledger()
      const stronger = runs.find((run) => run.tier === 'build')!
      expect(stronger).toMatchObject({ taskKind: 'scoped-edit', trial: false, retryOf: failed.id, censored: false })
      expect(stronger.evidenceRefs).not.toContain('route-tier-mismatch')
      expect(runs.find((run) => run.tier === 'edit')).toMatchObject({ escalated: true, effectiveOutcome: 'validation-failed' })
    })

    it('records the duration the host measured for the call and the model it resolved, whichever event arrives first', async () => {
      const route = await issue()
      const stop = await payload('claude-subagent-stop.json', await claudeTranscript(), {}, route.id)
      const tool = await payload('claude-post-tool-use.json', undefined)
      for (const order of [
        [tool, stop],
        [stop, tool]
      ]) {
        await rm(ledgerDir(), { recursive: true, force: true })
        await mkdir(ledgerDir(), { recursive: true })
        await transact(ledgerDir(), ({ append }) => append(route))
        for (const event of order) await captureHostEvent('claude-code', event, { now: NOW })
        const { runs } = await ledger()
        expect(runs).toHaveLength(1)
        expect(runs[0]).toMatchObject({
          taskKind: 'multi-file-feature',
          outcome: 'success',
          tokens: { output: 850 },
          durationMs: 201_500,
          countedDurationMs: 201_500,
          candidate: { model: 'claude-sonnet-5-5' }
        })
        expect(runs[0].cost).not.toBeNull()
      }
    })

    it('reads a tool result that says the agent failed as an execution failure when the agent gave no verdict, and not otherwise', async () => {
      const route = await issue()
      const failed = await payload('claude-post-tool-use.json', undefined, { tool_response: { status: 'failed', agentId: 'a1b2c3', totalDurationMs: 5000 } })
      await captureHostEvent('claude-code', failed, { now: NOW })
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', await claudeTranscript(), { last_assistant_message: 'It broke.' }, route.id), { now: NOW })
      expect((await ledger()).runs[0]).toMatchObject({ outcome: 'execution-failed', effectiveOutcome: 'execution-failed' })
    })

    it('reads a killed or cancelled tool result as censored, not as a failure', async () => {
      const route = await issue()
      await captureHostEvent('claude-code', await payload('claude-post-tool-use.json', undefined, { tool_response: { status: 'killed', agentId: 'a1b2c3' } }), { now: NOW })
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', undefined, { last_assistant_message: 'Stopped.' }, route.id), { now: NOW })
      expect((await ledger()).runs[0]).toMatchObject({ outcome: 'cancelled', censored: true })
    })

    it('ignores a background launch: the stop carries the result', async () => {
      const result = await captureHostEvent('claude-code', await payload('claude-post-tool-use.json', undefined, { tool_response: { status: 'async_launched', agentId: 'a1b2c3' } }), { now: NOW })
      expect(result).toEqual({ status: 'ignored', reason: 'a background launch: the agent stop carries the result' })
      expect((await ledger()).runs).toHaveLength(0)
    })

    it('records the usage as unknown, and still keeps the run, when the transcript cannot be read', async () => {
      const route = await issue()
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', join(transcripts, 'missing.jsonl'), {}, route.id), { now: NOW })
      const [run] = (await ledger()).runs
      expect(run).toMatchObject({ tokens: null, cost: null, durationMs: null, metering: 'unknown', outcome: 'success', taskKind: 'multi-file-feature' })
      // The model is the configured one: the transcript is the only place the observed one would come from.
      expect(run.candidate).toEqual({ model: 'claude-sonnet-5-5', effort: 'xhigh' })
    })

    it('does not follow a transcript path that is a link', async () => {
      const route = await issue()
      const real = await claudeTranscript()
      const link = join(transcripts, 'link.jsonl')
      await symlink(real, link)
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', link, {}, route.id), { now: NOW })
      expect((await ledger()).runs[0].tokens).toBeNull()
    })

    it('never counts a delegate that did not say what it did as a success, and censors it', async () => {
      const route = await issue()
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', await claudeTranscript(), { last_assistant_message: 'All done, I think.' }, route.id), { now: NOW })
      const [run] = (await ledger()).runs
      expect(run).toMatchObject({ outcome: 'outcome-unknown', censored: true, effectiveOutcome: 'outcome-unknown' })
      expect(run.evidenceRefs).toContain('no-sf-delegation-line')
    })

    it.each([
      ['names no check', 'checks=none'],
      ['names only a self-review', 'checks=self-review'],
      ['writes its checks in free text, as the real delegates did before the prompt listed the codes', 'checks=cat-read-back-of-hello.txt']
    ])('does not trust a pass that %s: it is unknown', async (_, checks) => {
      const route = await issue()
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', undefined, { last_assistant_message: `SF-DELEGATION: pass route=${route.id} ${checks}` }, route.id), {
        now: NOW
      })
      const [run] = (await ledger()).runs
      expect(run).toMatchObject({ outcome: 'outcome-unknown', censored: true })
      expect(run.evidenceRefs).toContain('pass-without-check')
    })

    it('records a declared failure as a failed validation', async () => {
      const route = await issue()
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', undefined, { last_assistant_message: `SF-DELEGATION: fail route=${route.id} checks=type-check` }, route.id), {
        now: NOW
      })
      expect((await ledger()).runs[0]).toMatchObject({ outcome: 'validation-failed', censored: false })
    })

    it('prices from the project declaration when the catalogue does not know the model', async () => {
      await manifest({ version: 4, agents: ['claude-code'], routing: { adjust: { prices: { 'claude-sonnet-5-5': { input: '1', output: '1' } } } } })
      const route = await issue()
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', await claudeTranscript(), {}, route.id), { now: NOW })
      // 10 input + 850 output at $1 per million, 2200 cache reads at a tenth and 1200 cache writes at 1.25 times the declared input
      expect((await ledger()).runs[0].cost).toEqual({ amount: '0.00258000', currency: 'USD' })
    })

    it('prices a model with a long-prompt rate call by call from the transcript, and a model that cannot be priced without the calls stays unpriced', async () => {
      const route = await issue({ tier: 'edit' })
      const path = join(transcripts, 'haiku.jsonl')
      const call = (id: string, input: number, output: number) =>
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-10-20T08:00:01.000Z',
          message: { id, model: 'claude-haiku-5-5', usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
        })
      await writeFile(path, `${call('m1', 1_000, 500)}\n${call('m2', 150_000, 500)}\n`)
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', path, { agent_type: 'sf-edit' }, route.id), { now: NOW })
      expect((await ledger()).runs[0]).toMatchObject({ cost: { amount: '0.07660000', currency: 'USD' }, metering: 'partial' })
    })
  })

  describe('an agent that is resumed (Examine finding 1)', () => {
    it('records every stop of the agent as a run of its own, from the real payloads of the host', async () => {
      const route = await issue({ id: 'aaaaaaaaaaaaaaaaaaaa', tier: 'edit', taskKind: 'scoped-edit' })
      const transcript = join(transcripts, 'agent.jsonl')
      const lines = (await fixture('claude-subagent-transcript.jsonl', LIVE)).trim().split('\n')
      // The first stop saw the first eight lines; the host wrote five more when it resumed the agent.
      await writeFile(transcript, `${lines.slice(0, 8).join('\n')}\n`)
      const first = await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', transcript, {}, route.id, LIVE), { now: NOW })
      expect(first.status).toBe('appended')
      await appendFile(transcript, `${lines.slice(8).join('\n')}\n`)
      const second = await captureHostEvent('claude-code', await payload('claude-subagent-stop-resumed.json', transcript, {}, route.id, LIVE), { now: () => new Date('2026-10-20T08:30:00.000Z') })
      expect(second.status).toBe('appended')
      const { runs } = await ledger()
      expect(runs).toHaveLength(2)
      const [early, last] = runs
      expect(last.continues).toBe(early.id)
      expect(early.segment?.to).toBe(last.segment?.from)
      expect(early.agentId).toBe(last.agentId)
      expect(early).toMatchObject({ tier: 'edit', superseded: true, censored: true })
      // Together the two stops are the whole transcript: what the second counted is only what the host wrote after the first.
      const whole = summarizeClaudeLines(lines)
      const parts = [early, last].reduce((sum, run) => sum + run.tokens!.output, 0)
      expect(parts).toBe(whole.tokens!.output)
      expect(last).toMatchObject({ superseded: false, chainSegments: 2 })
      expect(last.countedDurationMs).toBe(early.durationMs! + last.durationMs!)
      // The model of the real run was the cheap one, so it is priced as such, per call.
      expect(last.candidate.model).toBe('claude-haiku-5-5')
      expect(last.countedCost).not.toBeNull()
    })

    it('counts a stop seen twice once: the transcript has nothing the agent last segment did not already count', async () => {
      const route = await issue()
      const stop = await payload('claude-subagent-stop.json', await claudeTranscript(), {}, route.id)
      expect((await captureHostEvent('claude-code', stop, { now: NOW })).status).toBe('appended')
      expect((await captureHostEvent('claude-code', stop, { now: NOW })).status).toBe('replayed')
      expect((await ledger()).runs).toHaveLength(1)
    })
  })

  describe('real payloads of the hosts (Examine finding 30)', () => {
    it('captures the real Claude Code SubagentStop and PostToolUse: the tool result joins the stop by the agent id', async () => {
      const route = await issue({ id: 'aaaaaaaaaaaaaaaaaaaa', tier: 'edit', taskKind: 'scoped-edit' })
      const transcript = join(transcripts, 'agent.jsonl')
      const lines = (await fixture('claude-subagent-transcript.jsonl', LIVE)).trim().split('\n')
      await writeFile(transcript, `${lines.slice(0, 8).join('\n')}\n`)
      const stop = await payload('claude-subagent-stop.json', transcript, { last_assistant_message: 'Done.\nSF-DELEGATION: pass route=aaaaaaaaaaaaaaaaaaaa checks=automated-tests' }, route.id, LIVE)
      const tool = await payload('claude-post-tool-use.json', undefined, {}, undefined, LIVE)
      expect(stop.agent_id).toBe(tool.tool_response.agentId)
      await captureHostEvent('claude-code', stop, { now: NOW })
      await captureHostEvent('claude-code', tool, { now: NOW })
      const { runs } = await ledger()
      expect(runs).toHaveLength(1)
      expect(runs[0]).toMatchObject({ tier: 'edit', taskKind: 'scoped-edit', outcome: 'success', durationMs: 7_806, candidate: { model: 'claude-haiku-5-5', effort: 'high' } })
    })

    it('records the real delegate line as unknown: it wrote its checks in free text, which is why the prompt lists the codes', async () => {
      const route = await issue({ id: 'aaaaaaaaaaaaaaaaaaaa', tier: 'edit', taskKind: 'scoped-edit' })
      await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', undefined, {}, route.id, LIVE), { now: NOW })
      expect((await ledger()).runs[0]).toMatchObject({ outcome: 'outcome-unknown', censored: true })
    })

    it('captures the real Codex SubagentStop: agent type, agent id and rollout fields are the ones the capture reads', async () => {
      const route = await issue({ id: 'aaaaaaaaaaaaaaaaaaaa', provider: 'codex', tier: 'edit', taskKind: 'scoped-edit' })
      const rollout = join(transcripts, 'rollout.jsonl')
      await copyFile(join(LIVE, 'codex-subagent-rollout.jsonl'), rollout)
      const stop = await payload(
        'codex-subagent-stop.json',
        rollout,
        { last_assistant_message: 'Created hello.txt.\nSF-DELEGATION: pass route=aaaaaaaaaaaaaaaaaaaa checks=automated-tests' },
        route.id,
        LIVE
      )
      expect(stop).toMatchObject({ hook_event_name: 'SubagentStop', agent_type: 'sf-edit', model: 'gpt-6.1-sol' })
      await captureHostEvent('codex', stop, { now: NOW })
      expect((await ledger()).runs[0]).toMatchObject({
        host: 'codex',
        provider: 'codex',
        tier: 'edit',
        taskKind: 'scoped-edit',
        agentId: agentToken('01a15f3c-94fb-7981-94c0-8583d7bca7f6'),
        candidate: { model: 'gpt-6.1-sol' },
        tokens: { input: 32_709, output: 135, cacheRead: 32_256, cacheWrite: 0 },
        cost: null,
        outcome: 'success'
      })
    })
  })

  describe('evidence that must not be lost', () => {
    it('keeps the run, against the shipped grid and marked, when the manifest routing cannot be read', async () => {
      const route = await issue()
      await manifest({ version: 4, agents: ['claude-code'], routing: { kinds: { tests: { tier: 'nowhere' } } } })
      const result = await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', await claudeTranscript(), {}, route.id), { now: NOW })
      expect(result.status).toBe('appended')
      const [run] = (await ledger()).runs
      expect(run).toMatchObject({ tier: 'build', taskKind: 'multi-file-feature', outcome: 'success', cost: { amount: '0.01196000' } })
      expect(run.evidenceRefs).toContain('routing-unreadable')
      await writeFile(join(root, '.saasfoundry.json'), '{ nope')
      expect((await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', undefined, { agent_id: 'second' }), { now: NOW })).status).toBe('appended')
    })

    it('hashes every agent id instead of recording it, whatever it looks like', async () => {
      for (const odd of ['/Users/me/.claude/projects/p/api_key=abcdefabcdef\nnext', 'token:abc', 'a1b2c3']) {
        await captureHostEvent('claude-code', await payload('claude-subagent-stop.json', undefined, { agent_id: odd }), { now: NOW })
      }
      const { runs } = await ledger()
      expect(runs).toHaveLength(3)
      for (const run of runs) {
        expect(run.agentId).toMatch(/^[0-9a-f]{16}$/)
        expect(run.eventKey).toMatch(/^claude-code:[0-9a-f]{16}:|^claude-code:/)
        expect(run.evidenceRefs[0]).toMatch(/^agent:[0-9a-f]{16}$/)
        expect(JSON.stringify(run)).not.toMatch(/api_key|token:abc|a1b2c3|Users/)
      }
    })
  })

  describe('Codex', () => {
    const rollout = async () => {
      const path = join(transcripts, 'rollout.jsonl')
      await copyFile(join(FIXTURES, 'codex-rollout.jsonl'), path)
      return path
    }

    it('records a run with its usage when the rollout is parsable, unpriced until the project declares a rate', async () => {
      const route = await issue({ provider: 'codex', taskKind: 'tests', ticket: 1035 })
      await captureHostEvent('codex', await payload('codex-subagent-stop.json', await rollout(), {}, route.id), { now: NOW })
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
      const route = await issue({ provider: 'codex', taskKind: 'tests' })
      await captureHostEvent('codex', await payload('codex-subagent-stop.json', await rollout(), {}, route.id), { now: NOW })
      // 5000 x 0.30 + 1500 x 1.20 + 15000 x 0.03 per million
      expect((await ledger()).runs[0].cost).toEqual({ amount: '0.00375000', currency: 'USD' })
    })

    it('keeps the run with unknown usage when there is no parsable rollout', async () => {
      const route = await issue({ provider: 'codex', taskKind: 'tests' })
      await captureHostEvent('codex', await payload('codex-subagent-stop.json', join(transcripts, 'missing.jsonl'), {}, route.id), { now: NOW })
      expect((await ledger()).runs[0]).toMatchObject({ tokens: null, metering: 'unknown', outcome: 'success' })
    })

    it('bills a resumed agent for the turns written after its previous stop', async () => {
      const route = await issue({ provider: 'codex', taskKind: 'tests' })
      const path = join(transcripts, 'rollout.jsonl')
      const lines = (await fixture('codex-rollout.jsonl')).trim().split('\n')
      // The first stop saw the report after the first turn; the second turn came when the agent was resumed.
      await writeFile(path, `${lines.slice(0, 3).join('\n')}\n`)
      await captureHostEvent('codex', await payload('codex-subagent-stop.json', path, {}, route.id), { now: NOW })
      await appendFile(path, `${lines.slice(3).join('\n')}\n`)
      await captureHostEvent('codex', await payload('codex-subagent-stop.json', path, {}, route.id), { now: () => new Date('2026-10-20T08:30:00.000Z') })
      const { runs } = await ledger()
      expect(runs.map((run) => run.tokens)).toEqual([
        { input: 2000, output: 600, cacheRead: 6000, cacheWrite: 0 },
        { input: 3000, output: 900, cacheRead: 9000, cacheWrite: 0 }
      ])
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
      const route = await issue()
      await mkdir(join(root, 'src', 'deep'), { recursive: true })
      const stop = await payload('claude-subagent-stop.json', undefined, { cwd: join(root, 'src', 'deep') }, route.id)
      expect((await captureHostEvent('claude-code', stop, { now: NOW })).status).toBe('appended')
    })
  })
})
