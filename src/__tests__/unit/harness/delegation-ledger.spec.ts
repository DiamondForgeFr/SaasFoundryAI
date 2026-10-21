import { execFile } from 'child_process'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

import {
  agentToken,
  appendEntry,
  appendRun,
  appendSignal,
  assertRunRecord,
  buildDetailRecord,
  buildRouteRecord,
  buildRunRecord,
  buildSignalRecord,
  buildStatusRecord,
  findAgentSegments,
  findRoute,
  foldLedger,
  LedgerValidationError,
  readLedger,
  resolveLedgerDir,
  withLock,
  type LedgerEntry,
  type RunInput
} from '../../../harness/delegation-ledger'

const exec = promisify(execFile)
// A commit hook exports GIT_* variables: a fixture repository must never inherit them.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))

const T0 = '2026-10-20T08:00:00.000Z'
const at = (minutes: number): string => new Date(Date.parse(T0) + minutes * 60_000).toISOString()

const run = (overrides: Partial<RunInput> = {}): RunInput => ({
  host: 'claude-code',
  provider: 'claude-code',
  tier: 'build',
  taskKind: 'multi-file-feature',
  ticket: 1035,
  model: 'claude-sonnet-5-5',
  effort: 'xhigh',
  at: T0,
  durationMs: 60_000,
  tokens: { input: 100_000, output: 20_000, cacheRead: 0, cacheWrite: 0 },
  outcome: 'pass',
  checks: ['type-check', 'automated-tests'],
  ...overrides
})

const AGENT = agentToken('a71a1dfc68c3db3d7')

describe('the delegation ledger (#1035)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sf-ledger-'))
  })
  afterEach(async () => rm(dir, { recursive: true, force: true }))

  describe('building a record', () => {
    it('prices the whole usage exactly from the shipped catalogue, cache included', () => {
      const record = buildRunRecord(run({ tokens: { input: 1_000_000, output: 100_000, cacheRead: 500_000, cacheWrite: 200_000 } }))
      // 1M x $2 + 100k x $10 + 500k x $0.20 + 200k x ($2 x 1.25) per million
      expect(record.cost).toEqual({ amount: '3.60000000', currency: 'USD' })
      expect(record.metering).toBe('complete')
      expect(record.outcome).toBe('success')
    })

    it('leaves an unpriced model without a cost, never a guess, and prices it once the project declares a rate', () => {
      expect(buildRunRecord(run({ provider: 'codex', model: 'gpt-6.1-sol' })).cost).toBeNull()
      const declared = buildRunRecord(run({ provider: 'codex', model: 'gpt-6.1-sol' }), { prices: { 'gpt-6.1-sol': { input: '0.30', output: '1.20' } } })
      expect(declared.cost).toEqual({ amount: '0.05400000', currency: 'USD' })
    })

    it('does not price half a count', () => {
      const record = buildRunRecord(run({ tokens: { output: 5_000 } }))
      expect(record.cost).toBeNull()
      expect(record.metering).toBe('partial')
    })

    it('prices a model with a long-prompt rate call by call, and calls a run without its calls partial: no cost, no comparison', () => {
      const small = { input: 1_000, output: 500, cacheRead: 0, cacheWrite: 0 }
      const long = { input: 150_000, output: 500, cacheRead: 0, cacheWrite: 0 }
      const tokens = { input: 151_000, output: 1_000, cacheRead: 0, cacheWrite: 0 }
      const priced = buildRunRecord(run({ model: 'claude-haiku-5-5', tokens, calls: [small, long] }))
      // small: 1000 x 0.10 + 500 x 0.50 ; long (over 100K prompt tokens): 150000 x 0.50 + 500 x 2.50, per million
      expect(priced.cost).toEqual({ amount: '0.07660000', currency: 'USD' })
      expect(priced.metering).toBe('complete')
      const withoutCalls = buildRunRecord(run({ model: 'claude-haiku-5-5', tokens }))
      expect(withoutCalls.cost).toBeNull()
      expect(withoutCalls.metering).toBe('partial')
    })

    it.each<[string, Partial<RunInput>, string]>([
      ['tokens and duration', {}, 'complete'],
      ['tokens only', { durationMs: null }, 'partial'],
      ['duration only', { tokens: null }, 'partial'],
      ['neither', { durationMs: null, tokens: null }, 'unknown']
    ])('derives the metering from %s', (_, overrides, metering) => {
      expect(buildRunRecord(run(overrides)).metering).toBe(metering)
    })

    it('clamps an absurd duration instead of dropping the measurement', () => {
      expect(buildRunRecord(run({ durationMs: 30 * 24 * 3_600_000 })).durationMs).toBe(7 * 24 * 3_600_000)
    })

    it('records a measurement that is missing as unknown: never a success', () => {
      const record = buildRunRecord(run({ outcome: undefined }))
      expect(record.outcome).toBe('outcome-unknown')
      expect(foldLedger([record]).runs[0]).toMatchObject({ censored: true, effectiveOutcome: 'outcome-unknown' })
    })

    it('accepts pass and fail as the two verdicts a delegate can give', () => {
      expect(buildRunRecord(run({ outcome: 'pass' })).outcome).toBe('success')
      expect(buildRunRecord(run({ outcome: 'fail' })).outcome).toBe('validation-failed')
    })

    it.each<[string, Partial<RunInput>, string]>([
      ['an unknown task kind', { taskKind: 'deploy' }, 'taskKind'],
      ['an unrouted coding agent', { provider: 'gemini-cli' }, 'provider'],
      ['a tier that is not an identifier', { tier: 'Build!' }, 'tier'],
      ['an outcome outside the library codes', { outcome: 'great' }, 'outcome'],
      ['a check outside the library codes', { checks: ['vibes'] }, 'checks'],
      ['a secret in an evidence reference', { evidenceRefs: ['api_key=abcdefabcdef'] }, 'evidenceRefs'],
      ['a negative duration', { durationMs: -1 }, 'durationMs'],
      ['a ticket that is not a number', { ticket: 0 }, 'ticket'],
      ['a model with a terminal escape in it', { model: 'claude\u001b[31m-red' }, 'candidate.model'],
      ['a segment that ends before it starts', { segment: { from: 10, to: 5 } }, 'segment']
    ])('refuses %s', (_, overrides, field) => {
      expect(() => buildRunRecord(run(overrides))).toThrow(LedgerValidationError)
      expect(() => buildRunRecord(run(overrides))).toThrow(field)
    })

    it('refuses an unknown field when a record is read back', () => {
      expect(() => assertRunRecord({ ...buildRunRecord(run()), score: 0.9 })).toThrow('unknown field score')
    })

    it('hashes a host agent id the same way every time and keeps no secret-looking id out of the ledger', () => {
      expect(agentToken('token:abc')).toMatch(/^[0-9a-f]{16}$/)
      expect(agentToken('token:abc')).toBe(agentToken('token:abc'))
      expect(agentToken('token:abc')).not.toBe(agentToken('token:abd'))
    })
  })

  describe('appending and replaying', () => {
    it('appends a run to a file only its owner can read, and reads it back', async () => {
      const record = buildRunRecord(run())
      expect(await appendRun(dir, record)).toMatchObject({ status: 'appended', id: record.id })
      expect(((await stat(join(dir, 'delegations.jsonl'))).mode & 0o777).toString(8)).toBe('600')
      const state = await readLedger(dir)
      expect(state.runs).toHaveLength(1)
      expect(state.runs[0]).toMatchObject({ id: record.id, taskKind: 'multi-file-feature', tier: 'build', censored: false, decisive: true, effectiveOutcome: 'success' })
    })

    it('returns the folded state after the append, so nothing has to be read again', async () => {
      const first = await appendRun(dir, buildRunRecord(run({ at: at(0), eventKey: 'a' })))
      const second = await appendRun(dir, buildRunRecord(run({ at: at(1), eventKey: 'b' })))
      expect(first.state.runs).toHaveLength(1)
      expect(second.state.runs).toHaveLength(2)
    })

    it('reads an absent ledger as an empty one', async () => {
      expect(await readLedger(join(dir, 'never-written'))).toEqual({ runs: [], routes: [], statuses: [], skipped: 0, unmatchedSignals: 0 })
    })

    it('replays a host event seen twice instead of appending it twice', async () => {
      const first = buildRunRecord(run({ eventKey: 'claude-code:agent-1' }))
      await appendRun(dir, first)
      expect(await appendRun(dir, buildRunRecord(run({ eventKey: 'claude-code:agent-1' })))).toMatchObject({ status: 'replayed', id: first.id })
      expect((await readFile(join(dir, 'delegations.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1)
    })

    it('merges the facts a second sighting adds and keeps what the first one knew', async () => {
      const stop = buildRunRecord(run({ eventKey: 'claude-code:agent-2', durationMs: null, model: null, tokens: null, outcome: undefined, taskKind: null }))
      await appendRun(dir, stop)
      const enriched = buildRunRecord(run({ eventKey: 'claude-code:agent-2', durationMs: 90_000, model: 'claude-sonnet-5-5', tokens: { input: 10, output: 20 }, outcome: 'pass' }))
      expect((await appendRun(dir, enriched)).status).toBe('merged')
      const { runs } = await readLedger(dir)
      expect(runs).toHaveLength(1)
      expect(runs[0]).toMatchObject({ id: stop.id, durationMs: 90_000, outcome: 'success', taskKind: 'multi-file-feature', censored: false })
      expect(runs[0].cost).not.toBeNull()
    })

    it('never turns a verdict into another one: the first known outcome stays', async () => {
      await appendRun(dir, buildRunRecord(run({ eventKey: 'k', outcome: 'fail' })))
      await appendRun(dir, buildRunRecord(run({ eventKey: 'k', outcome: 'pass', durationMs: 5, at: at(1) })))
      expect((await readLedger(dir)).runs[0].outcome).toBe('validation-failed')
    })

    it('reaches the same outcome whatever order two sightings of one event arrive in', () => {
      const unknown = buildRunRecord(run({ eventKey: 'order', at: at(0), outcome: undefined }))
      const failed = buildRunRecord(run({ eventKey: 'order', at: at(1), outcome: 'execution-failed' }))
      const verdict = buildRunRecord(run({ eventKey: 'order', at: at(2), outcome: 'pass' }))
      const outcomes = [
        [unknown, failed, verdict],
        [verdict, failed, unknown],
        [failed, verdict, unknown],
        [unknown, verdict, failed]
      ].map((entries) => foldLedger(entries).runs[0].outcome)
      expect(new Set(outcomes)).toEqual(new Set(['success']))
    })

    it('skips a torn or edited line and counts it', async () => {
      await appendRun(dir, buildRunRecord(run()))
      await writeFile(join(dir, 'delegations.jsonl'), (await readFile(join(dir, 'delegations.jsonl'), 'utf8')) + '{"v":1,"type":"run","id":"trunc\n{"not":"a record"}\n')
      const state = await readLedger(dir)
      expect(state.runs).toHaveLength(1)
      expect(state.skipped).toBe(2)
    })

    it('reads a line written before the segment fields existed', async () => {
      const added = ['agentId', 'segment', 'continues', 'retryOf', 'route']
      const legacy = Object.fromEntries(Object.entries(buildRunRecord(run())).filter(([key]) => !added.includes(key)))
      await writeFile(join(dir, 'delegations.jsonl'), `${JSON.stringify(legacy)}\n`)
      expect((await readLedger(dir)).runs[0]).toMatchObject({ agentId: null, segment: null, route: null, decisive: true })
    })

    it('refuses a ledger that is a link, not a file', async () => {
      await writeFile(join(dir, 'elsewhere.jsonl'), '')
      await symlink(join(dir, 'elsewhere.jsonl'), join(dir, 'delegations.jsonl'))
      await expect(readLedger(dir)).rejects.toThrow('Expected a regular file')
    })
  })

  describe('an agent that is resumed', () => {
    const first = (): ReturnType<typeof buildRunRecord> =>
      buildRunRecord(
        run({
          eventKey: `claude-code:${AGENT}:100`,
          agentId: AGENT,
          segment: { from: 0, to: 100 },
          at: at(0),
          durationMs: 8_000,
          tokens: { input: 1_000, output: 100, cacheRead: 0, cacheWrite: 0 },
          outcome: 'pass'
        })
      )
    const resumed = (continues: string, overrides: Partial<RunInput> = {}): ReturnType<typeof buildRunRecord> =>
      buildRunRecord(
        run({
          eventKey: `claude-code:${AGENT}:250`,
          agentId: AGENT,
          segment: { from: 100, to: 250 },
          continues,
          at: at(30),
          durationMs: 5_000,
          tokens: { input: 2_000, output: 400, cacheRead: 0, cacheWrite: 0 },
          outcome: 'fail',
          ...overrides
        })
      )

    it('records each stop as its own run: the second stop is not dropped as a replay', async () => {
      const one = first()
      expect((await appendRun(dir, one)).status).toBe('appended')
      expect((await appendRun(dir, resumed(one.id))).status).toBe('appended')
      expect((await readFile(join(dir, 'delegations.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(2)
    })

    it('counts the cost and the active time of every stop on the last one, and the latest verdict as its outcome', () => {
      const one = first()
      const { runs } = foldLedger([one, resumed(one.id)])
      const [early, last] = runs
      expect(early).toMatchObject({ superseded: true, censored: true, decisive: false })
      expect(last).toMatchObject({ superseded: false, chainSegments: 2, effectiveOutcome: 'validation-failed', censored: false, decisive: true, countedDurationMs: 13_000 })
      // 1000 x 2 + 100 x 10 and 2000 x 2 + 400 x 10, per million
      expect(last.countedCost).toEqual({ amount: '0.01100000', currency: 'USD' })
    })

    it('keeps the earlier verdict when the resumed stop reports none', () => {
      const one = first()
      const { runs } = foldLedger([one, resumed(one.id, { outcome: undefined })])
      expect(runs[1]).toMatchObject({ effectiveOutcome: 'success', censored: false })
    })

    it('cannot price the chain when one stop has no cost', () => {
      const one = first()
      const { runs } = foldLedger([one, resumed(one.id, { tokens: null })])
      expect(runs[1].countedCost).toBeNull()
    })

    it('finds the stops already recorded for an agent, oldest first, from the file', async () => {
      const one = first()
      await appendRun(dir, one)
      await appendRun(dir, resumed(one.id))
      await appendRun(dir, buildRunRecord(run({ eventKey: 'other', agentId: agentToken('someone-else'), segment: { from: 0, to: 9 } })))
      const found = await findAgentSegments(dir, 'claude-code', AGENT)
      expect(found.map((segment) => segment.segment?.to)).toEqual([100, 250])
    })

    it('takes the host duration of the tool result for the first stop, whichever line arrives first', () => {
      const one = first()
      const detail = buildDetailRecord({ host: 'claude-code', agentId: AGENT, durationMs: 7_806, model: 'claude-haiku-5-5', status: null, at: at(1) })
      const forward = foldLedger([one, detail]).runs[0]
      const backward = foldLedger([detail, one]).runs[0]
      expect(forward.durationMs).toBe(7_806)
      expect(backward.durationMs).toBe(7_806)
      expect(forward.countedDurationMs).toBe(7_806)
    })

    it('turns a failed tool status into a failure only when the agent gave no verdict', () => {
      const silent = buildRunRecord(run({ eventKey: 'silent', agentId: AGENT, segment: { from: 0, to: 5 }, outcome: undefined }))
      const failure = buildDetailRecord({ host: 'claude-code', agentId: AGENT, status: 'failed', at: at(1) })
      expect(foldLedger([silent, failure]).runs[0]).toMatchObject({ outcome: 'execution-failed', censored: false })
      expect(foldLedger([failure, silent]).runs[0]).toMatchObject({ outcome: 'execution-failed' })
      const passed = buildRunRecord(run({ eventKey: 'passed', agentId: AGENT, segment: { from: 0, to: 5 }, outcome: 'pass' }))
      expect(foldLedger([passed, failure]).runs[0].outcome).toBe('success')
    })

    it('treats a killed or cancelled tool status as censored, not as a failure', () => {
      const silent = buildRunRecord(run({ eventKey: 'silent', agentId: AGENT, segment: { from: 0, to: 5 }, outcome: undefined }))
      const killed = buildDetailRecord({ host: 'claude-code', agentId: AGENT, status: 'cancelled', at: at(1) })
      expect(foldLedger([silent, killed]).runs[0]).toMatchObject({ outcome: 'cancelled', censored: true })
    })
  })

  describe('concurrent writers (one worktree and one hook per delegated ticket)', () => {
    it('keeps every line whole when many appends race', async () => {
      const records = Array.from({ length: 30 }, (_, index) => buildRunRecord(run({ eventKey: `host:${index}`, at: at(index) })))
      await Promise.all(records.map((record) => appendRun(dir, record)))
      const lines = (await readFile(join(dir, 'delegations.jsonl'), 'utf8')).trim().split('\n')
      expect(lines).toHaveLength(30)
      expect(lines.every((line) => JSON.parse(line).type === 'run')).toBe(true)
      expect((await readLedger(dir)).runs).toHaveLength(30)
    })

    it('breaks a lock whose holder is gone, and releases its own lock', async () => {
      await mkdir(dir, { recursive: true })
      const lock = join(dir, 'delegations.lock')
      await writeFile(lock, `${2 ** 22 + 12345}:dead-token`)
      await appendRun(dir, buildRunRecord(run()))
      await expect(stat(lock)).rejects.toThrow()
      expect((await readLedger(dir)).runs).toHaveLength(1)
    })

    it('does not break a lock whose holder is alive, and keeps the record in a spool the next writer merges', async () => {
      await mkdir(dir, { recursive: true })
      const lock = join(dir, 'delegations.lock')
      await writeFile(lock, `${process.pid}:live-token`)
      const record = buildRunRecord(run({ eventKey: 'spooled' }))
      expect(await appendRun(dir, record, { waitMs: 60 })).toMatchObject({ status: 'spooled', id: record.id })
      expect(await readFile(lock, 'utf8')).toBe(`${process.pid}:live-token`)
      // Everyone reads it meanwhile.
      expect((await readLedger(dir)).runs.map((entry) => entry.id)).toEqual([record.id])
      expect(await readdir(join(dir, 'delegations.spool'))).toHaveLength(1)
      await rm(lock)
      await appendRun(dir, buildRunRecord(run({ eventKey: 'next', at: at(1) })))
      expect(await readdir(join(dir, 'delegations.spool'))).toHaveLength(0)
      const lines = (await readFile(join(dir, 'delegations.jsonl'), 'utf8')).trim().split('\n')
      expect(lines).toHaveLength(2)
      expect((await readLedger(dir)).runs).toHaveLength(2)
    })

    it('breaks a lock that is far too old even when its pid looks alive (the pid may have been reused)', async () => {
      await mkdir(dir, { recursive: true })
      const lock = join(dir, 'delegations.lock')
      await writeFile(lock, `${process.pid}:ancient`)
      const old = new Date(Date.now() - 3_600_000)
      await utimes(lock, old, old)
      await appendRun(dir, buildRunRecord(run()))
      expect((await readLedger(dir)).runs).toHaveLength(1)
    })

    it('never frees a lock another writer took after the holder was done', async () => {
      await mkdir(dir, { recursive: true })
      const lock = join(dir, 'delegations.lock')
      await withLock(dir, async () => {
        // Somebody else took the lock (this writer was deemed dead): the late release must leave it alone.
        await rm(lock)
        await writeFile(lock, `${process.pid}:someone-else`)
      })
      expect(await readFile(lock, 'utf8')).toBe(`${process.pid}:someone-else`)
    })
  })

  describe('later signals', () => {
    it('counts a success the session had to rework as a failure, without editing the run', async () => {
      const record = buildRunRecord(run({ at: at(0) }))
      await appendRun(dir, record)
      await appendSignal(dir, buildSignalRecord({ target: { run: record.id }, signal: 'rework', note: 'wrong file set', at: at(5) }))
      const [folded] = (await readLedger(dir)).runs
      expect(folded.outcome).toBe('success')
      expect(folded.effectiveOutcome).toBe('validation-failed')
      expect(folded.signals).toEqual([{ signal: 'rework', at: at(5), note: 'wrong file set' }])
    })

    it('lands the signal of a ticket on the latest run of each task kind that was done by then', async () => {
      const feature = buildRunRecord(run({ at: at(0) }))
      const later = buildRunRecord(run({ at: at(10) }))
      const tests = buildRunRecord(run({ at: at(5), taskKind: 'tests' }))
      const afterwards = buildRunRecord(run({ at: at(60) }))
      for (const record of [feature, later, tests, afterwards]) await appendRun(dir, record)
      const result = await appendSignal(dir, buildSignalRecord({ target: { ticket: 1035, taskKind: null }, signal: 'human-defect', at: at(30) }))
      expect(result.matched).toBe(2)
      const byId = new Map((await readLedger(dir)).runs.map((entry) => [entry.id, entry]))
      expect(byId.get(feature.id)!.signals).toEqual([])
      expect(byId.get(later.id)!.effectiveOutcome).toBe('validation-failed')
      expect(byId.get(tests.id)!.effectiveOutcome).toBe('validation-failed')
      expect(byId.get(afterwards.id)!.effectiveOutcome).toBe('success')
    })

    it('lands the signal on the last stop of a resumed agent', async () => {
      const one = buildRunRecord(run({ eventKey: 'one', agentId: AGENT, segment: { from: 0, to: 10 }, at: at(0) }))
      const two = buildRunRecord(run({ eventKey: 'two', agentId: AGENT, segment: { from: 10, to: 20 }, continues: one.id, at: at(5) }))
      for (const record of [one, two]) await appendRun(dir, record)
      await appendSignal(dir, buildSignalRecord({ target: { run: one.id }, signal: 'rework', at: at(9) }))
      const byId = new Map((await readLedger(dir)).runs.map((entry) => [entry.id, entry]))
      expect(byId.get(two.id)).toMatchObject({ effectiveOutcome: 'validation-failed' })
      expect(byId.get(one.id)!.signals).toEqual([])
    })

    it('narrows a ticket signal to one task kind', async () => {
      await appendRun(dir, buildRunRecord(run({ at: at(0) })))
      await appendRun(dir, buildRunRecord(run({ at: at(1), taskKind: 'tests' })))
      const result = await appendSignal(dir, buildSignalRecord({ target: { ticket: 1035, taskKind: 'tests' }, signal: 'rework', at: at(2) }))
      expect(result.matched).toBe(1)
    })

    it('refuses a signal that matches no run instead of keeping it silently', async () => {
      await appendRun(dir, buildRunRecord(run()))
      await expect(appendSignal(dir, buildSignalRecord({ target: { ticket: 999, taskKind: null }, signal: 'rework' }))).rejects.toThrow('No delegation run is recorded for ticket #999')
      await expect(appendSignal(dir, buildSignalRecord({ target: { run: 'a'.repeat(20) }, signal: 'rework' }))).rejects.toThrow('No delegation run')
      expect((await readFile(join(dir, 'delegations.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1)
    })
  })

  describe('a retry on a higher tier', () => {
    const cheap = (overrides: Partial<RunInput> = {}) => buildRunRecord(run({ eventKey: 'cheap', at: at(0), tier: 'edit', model: 'claude-haiku-5-5', effort: 'high', ...overrides }))
    const strong = (overrides: Partial<RunInput> = {}) => buildRunRecord(run({ eventKey: 'strong', at: at(10), tier: 'fix', model: 'claude-opus-5-5', effort: 'medium', ...overrides }))

    it('says the first run did not do the job when the second one is linked to it', () => {
      const first = cheap()
      const { runs } = foldLedger([first, strong({ retryOf: first.id })])
      expect(runs.find((entry) => entry.tier === 'edit')).toMatchObject({ escalated: true, effectiveOutcome: 'validation-failed' })
      expect(runs.find((entry) => entry.tier === 'fix')).toMatchObject({ escalated: false, effectiveOutcome: 'success' })
    })

    it('follows a link made by the route id of the first delegation', () => {
      const first = cheap({ route: 'b'.repeat(20) })
      const { runs } = foldLedger([first, strong({ retryOf: 'b'.repeat(20) })])
      expect(runs.find((entry) => entry.tier === 'edit')?.escalated).toBe(true)
    })

    it('does not read a later run on a higher tier, linked to nothing, as a retry: a trial that succeeded stays a success', () => {
      const trial = cheap({ trial: true })
      const routed = strong()
      const { runs } = foldLedger([trial, routed])
      expect(runs.every((entry) => !entry.escalated && entry.effectiveOutcome === 'success')).toBe(true)
    })

    it('does not read a link to a lower or an equal tier as an escalation', () => {
      const first = buildRunRecord(run({ eventKey: 'first', at: at(0) }))
      const same = buildRunRecord(run({ eventKey: 'same', at: at(5), retryOf: first.id }))
      expect(foldLedger([first, same]).runs.every((entry) => !entry.escalated)).toBe(true)
    })
  })

  describe('what a rate may count', () => {
    it('censors a run without a task kind, an unknown outcome, a cancelled run and an unavailable candidate', () => {
      const records = [
        buildRunRecord(run({ at: at(0), taskKind: null })),
        buildRunRecord(run({ at: at(1), outcome: undefined })),
        buildRunRecord(run({ at: at(2), outcome: 'cancelled' })),
        buildRunRecord(run({ at: at(3), outcome: 'candidate-unavailable' })),
        buildRunRecord(run({ at: at(4), outcome: 'execution-failed' })),
        buildRunRecord(run({ at: at(5), outcome: 'pass' }))
      ]
      expect(foldLedger(records).runs.map((entry) => entry.censored)).toEqual([true, true, true, true, false, false])
    })

    it('keeps a run recorded by hand out of the decisions: rated for the report, never decisive', () => {
      const { runs } = foldLedger([buildRunRecord(run({ host: 'manual' })), buildRunRecord(run({ eventKey: 'hook', at: at(1) }))])
      expect(runs.map((entry) => [entry.censored, entry.decisive])).toEqual([
        [false, false],
        [false, true]
      ])
    })
  })

  describe('routes and statuses', () => {
    it('keeps the route records a delegation can echo, and says which run claimed each', () => {
      const route = buildRouteRecord({ taskKind: 'tests', provider: 'claude-code', tier: 'build', trial: false, ticket: 7, complexity: 'medium', now: new Date(T0) })
      const claimed = buildRunRecord(run({ route: route.id }))
      const state = foldLedger([route, claimed])
      expect(state.routes).toEqual([{ ...route, consumedBy: claimed.id }])
      expect(route.expiresAt).toBe(new Date(Date.parse(T0) + 6 * 3_600_000).toISOString())
    })

    it('finds a route and the agents that echoed it without folding the ledger', async () => {
      const route = buildRouteRecord({ taskKind: 'tests', provider: 'claude-code', tier: 'build', trial: true, ticket: 7, now: new Date(T0) })
      await writeFile(
        join(dir, 'delegations.jsonl'),
        `${[route, buildRunRecord(run({ route: route.id, agentId: AGENT, segment: { from: 0, to: 1 } }))].map((entry) => JSON.stringify(entry)).join('\n')}\n`
      )
      expect(await findRoute(dir, route.id)).toMatchObject({ id: route.id, trial: true, ticket: 7, users: [AGENT] })
      expect(await findRoute(dir, 'f'.repeat(20))).toBeUndefined()
    })

    it('keeps the status transitions of tickets, once each', async () => {
      const entry = buildStatusRecord({ ticket: 1067, status: 'In progress', at: at(0) })
      await appendEntry(dir, entry)
      await appendEntry(dir, entry)
      const state = await readLedger(dir)
      expect(state.statuses).toEqual([entry])
      expect(entry.status).toBe('in progress')
    })

    it('does not let a malformed route or status line into the history', () => {
      const entries: LedgerEntry[] = [buildStatusRecord({ ticket: 1, status: 'Done', at: at(0) })]
      expect(() => buildStatusRecord({ ticket: 0, status: 'Done' })).toThrow(LedgerValidationError)
      expect(() => buildRouteRecord({ taskKind: 'tests', provider: 'gemini-cli' as never, tier: 'build', trial: false })).toThrow('provider')
      expect(foldLedger(entries).statuses).toHaveLength(1)
    })
  })

  describe('where the ledger lives', () => {
    const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd, env: cleanEnv })).stdout.trim()

    it('resolves to the common Git directory from a linked worktree, so every ticket worktree shares one history', async () => {
      const repo = await realpath(dir)
      await git(repo, 'init', '-q', '-b', 'main')
      await git(repo, 'config', 'user.email', 'test@example.com')
      await git(repo, 'config', 'user.name', 'Test')
      await writeFile(join(repo, 'a.txt'), 'a')
      await git(repo, 'add', 'a.txt')
      await git(repo, 'commit', '-q', '-m', 'init')
      const linked = join(repo, '..', `${join(repo).split('/').pop()}-linked`)
      await git(repo, 'worktree', 'add', '-q', '-b', 'feature/x', linked)
      try {
        const fromPrimary = await resolveLedgerDir(repo)
        const fromLinked = await resolveLedgerDir(linked)
        expect(fromPrimary).toBe(join(repo, '.git', 'saasfoundry'))
        expect(fromLinked).toBe(fromPrimary)
        await appendRun(fromLinked!, buildRunRecord(run()))
        expect((await readLedger(fromPrimary!)).runs).toHaveLength(1)
      } finally {
        await rm(linked, { recursive: true, force: true })
      }
    })

    it('has no ledger outside a Git checkout', async () => {
      expect(await resolveLedgerDir(await mkdtemp(join(tmpdir(), 'sf-no-git-')))).toBeUndefined()
    })
  })
})
