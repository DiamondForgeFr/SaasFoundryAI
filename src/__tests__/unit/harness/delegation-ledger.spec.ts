import { execFile } from 'child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

import {
  appendRun,
  appendSignal,
  assertRunRecord,
  buildRunRecord,
  buildSignalRecord,
  foldLedger,
  LedgerValidationError,
  readLedger,
  resolveLedgerDir,
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

    it.each<[string, Partial<RunInput>, string]>([
      ['tokens and duration', {}, 'complete'],
      ['tokens only', { durationMs: null }, 'partial'],
      ['duration only', { tokens: null }, 'partial'],
      ['neither', { durationMs: null, tokens: null }, 'unknown']
    ])('derives the metering from %s', (_, overrides, metering) => {
      expect(buildRunRecord(run(overrides)).metering).toBe(metering)
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
      ['a ticket that is not a number', { ticket: 0 }, 'ticket']
    ])('refuses %s', (_, overrides, field) => {
      expect(() => buildRunRecord(run(overrides))).toThrow(LedgerValidationError)
      expect(() => buildRunRecord(run(overrides))).toThrow(field)
    })

    it('refuses an unknown field when a record is read back', () => {
      expect(() => assertRunRecord({ ...buildRunRecord(run()), score: 0.9 })).toThrow('unknown field score')
    })
  })

  describe('appending and replaying', () => {
    it('appends a run to a file only its owner can read, and reads it back', async () => {
      const record = buildRunRecord(run())
      expect(await appendRun(dir, record)).toEqual({ status: 'appended', id: record.id })
      expect(((await stat(join(dir, 'delegations.jsonl'))).mode & 0o777).toString(8)).toBe('600')
      const state = await readLedger(dir)
      expect(state.runs).toHaveLength(1)
      expect(state.runs[0]).toMatchObject({ id: record.id, taskKind: 'multi-file-feature', tier: 'build', censored: false, effectiveOutcome: 'success' })
    })

    it('reads an absent ledger as an empty one', async () => {
      expect(await readLedger(join(dir, 'never-written'))).toEqual({ runs: [], skipped: 0, unmatchedSignals: 0 })
    })

    it('replays a host event seen twice instead of appending it twice', async () => {
      const first = buildRunRecord(run({ eventKey: 'claude-code:agent-1' }))
      await appendRun(dir, first)
      expect(await appendRun(dir, buildRunRecord(run({ eventKey: 'claude-code:agent-1' })))).toEqual({ status: 'replayed', id: first.id })
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
      await appendRun(dir, buildRunRecord(run({ eventKey: 'k', outcome: 'pass', durationMs: 5 })))
      expect((await readLedger(dir)).runs[0].outcome).toBe('validation-failed')
    })

    it('skips a torn or edited line and counts it', async () => {
      await appendRun(dir, buildRunRecord(run()))
      await writeFile(join(dir, 'delegations.jsonl'), (await readFile(join(dir, 'delegations.jsonl'), 'utf8')) + '{"v":1,"type":"run","id":"trunc\n{"not":"a record"}\n')
      const state = await readLedger(dir)
      expect(state.runs).toHaveLength(1)
      expect(state.skipped).toBe(2)
    })

    it('refuses a ledger that is a link, not a file', async () => {
      await writeFile(join(dir, 'elsewhere.jsonl'), '')
      await symlink(join(dir, 'elsewhere.jsonl'), join(dir, 'delegations.jsonl'))
      await expect(readLedger(dir)).rejects.toThrow('Expected a regular file')
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

    it('breaks a lock a dead writer left behind, and releases its own lock', async () => {
      await mkdir(dir, { recursive: true })
      const lock = join(dir, 'delegations.lock')
      await writeFile(lock, '')
      const old = new Date(Date.now() - 120_000)
      await utimes(lock, old, old)
      await appendRun(dir, buildRunRecord(run()))
      await expect(stat(lock)).rejects.toThrow()
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

    it('reads a retry on a higher tier as a signal: the first run did not do the job', () => {
      const cheap = buildRunRecord(run({ at: at(0), tier: 'edit', model: 'claude-haiku-5-5', effort: 'high' }))
      const strong = buildRunRecord(run({ at: at(10), tier: 'fix', model: 'claude-opus-5-5', effort: 'medium' }))
      const { runs } = foldLedger([cheap, strong])
      expect(runs.find((entry) => entry.tier === 'edit')).toMatchObject({ escalated: true, effectiveOutcome: 'validation-failed' })
      expect(runs.find((entry) => entry.tier === 'fix')).toMatchObject({ escalated: false, effectiveOutcome: 'success' })
    })

    it('does not read a retry on the same tier, or another ticket, as an escalation', () => {
      const first = buildRunRecord(run({ at: at(0) }))
      const sameTier = buildRunRecord(run({ at: at(5) }))
      const otherTicket = buildRunRecord(run({ at: at(10), ticket: 7, tier: 'fix' }))
      expect(foldLedger([first, sameTier, otherTicket]).runs.every((entry) => !entry.escalated)).toBe(true)
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
