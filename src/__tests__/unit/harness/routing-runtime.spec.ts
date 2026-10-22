import { execFile } from 'child_process'
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

import { promoteLocalRouting } from '../../../harness/agent-support'
import { appendRun, buildRunRecord, readLedger, type RunInput } from '../../../harness/delegation-ledger'
import { emptyLocalRouting, localRoutingPath, readLocalRouting, updateLocalRouting, type LocalAdjustment } from '../../../harness/routing-local'
import { issueRoutes, loadRoutingState, resetLocalRouting, routeKind, runAdjustment } from '../../../harness/routing-runtime'

const exec = promisify(execFile)
// A commit hook exports GIT_* variables: a fixture repository must never inherit them.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
const T0 = Date.parse('2026-10-01T08:00:00.000Z')
const NOW = new Date('2026-10-20T08:00:00.000Z')

const TIER: Record<string, { model: string; effort: string }> = {
  edit: { model: 'claude-haiku-5-5', effort: 'high' },
  build: { model: 'claude-sonnet-5-5', effort: 'xhigh' },
  fix: { model: 'claude-opus-5-5', effort: 'medium' }
}

describe('the routing at work in a clone (#1035)', () => {
  let root: string
  let ledger: string
  let clock = 0
  const git = async (...args: string[]) => (await exec('git', args, { cwd: root, env: cleanEnv })).stdout.trim()
  /** The manifest on disk, committed or not. */
  const writeManifest = (harness: Record<string, unknown> = { version: 4, agents: ['claude-code'] }, workflow?: Record<string, unknown>, where = root) =>
    writeFile(
      join(where, '.saasfoundry.json'),
      JSON.stringify({ version: 'test', projectName: 'runtime-demo', structure: 'cli', ...(workflow ? { workflow } : {}), modules: { harness }, fileHashes: { 'keep.txt': 'abc' } }, null, 2) + '\n'
    )
  const commitManifest = async (message = 'manifest', where = root) => {
    await exec('git', ['add', '.saasfoundry.json'], { cwd: where, env: cleanEnv })
    await exec('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', message], { cwd: where, env: cleanEnv })
  }
  /** What the team committed: a decision rests on it, so the manifests of these scenarios are committed unless a scenario says otherwise. */
  const manifest = async (harness?: Record<string, unknown>) => {
    await writeManifest(harness)
    await commitManifest()
  }
  const record = async (pattern: string, spec: Partial<RunInput> & { tier?: string } = {}) => {
    for (const symbol of pattern) {
      const tier = spec.tier ?? 'build'
      await appendRun(
        ledger,
        buildRunRecord({
          host: 'claude-code',
          provider: 'claude-code',
          taskKind: 'multi-file-feature',
          model: TIER[tier]?.model,
          effort: TIER[tier]?.effort,
          durationMs: 60_000,
          tokens: { input: 100_000, output: 10_000, cacheRead: 0, cacheWrite: 0 },
          outcome: symbol === 'f' ? 'fail' : 'pass',
          checks: ['type-check'],
          ...spec,
          tier,
          at: new Date(T0 + clock++ * 60_000).toISOString()
        })
      )
    }
  }
  const harness = async () => JSON.parse(await readFile(join(root, '.saasfoundry.json'), 'utf8')).modules.harness

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'sf-runtime-')))
    ledger = join(root, '.git', 'saasfoundry')
    await git('init', '-q', '-b', 'main')
    await manifest()
  })
  afterEach(async () => rm(root, { recursive: true, force: true }))

  describe('outside a clone', () => {
    it('answers from the shared routing alone', async () => {
      const elsewhere = await realpath(await mkdtemp(join(tmpdir(), 'sf-runtime-nogit-')))
      try {
        const state = await loadRoutingState(elsewhere)
        expect(state.dir).toBeUndefined()
        expect(routeKind(state, 'tests', 'codex')).toMatchObject({ tier: 'build', source: 'shipped', trial: false })
        expect(await runAdjustment(elsewhere)).toMatchObject({ decisions: [], moved: false })
      } finally {
        await rm(elsewhere, { recursive: true, force: true })
      }
    })
  })

  describe('adjusting', () => {
    it('writes a move to the local layer only, shares it with every worktree of the clone, and leaves the manifest as it is', async () => {
      await record('sssssssfff')
      const before = await readFile(join(root, '.saasfoundry.json'), 'utf8')
      const report = await runAdjustment(root, { now: NOW })
      expect(report.moved).toBe(true)
      expect(report.decisions[0]).toMatchObject({ action: 'escalate', from: 'build', to: 'fix' })
      expect(((await stat(localRoutingPath(ledger))).mode & 0o777).toString(8)).toBe('600')
      expect((await readLocalRouting(ledger)).kinds['multi-file-feature']!['claude-code']).toMatchObject({ tier: 'fix', from: 'build', action: 'escalate' })
      expect(await readFile(join(root, '.saasfoundry.json'), 'utf8')).toBe(before)
      // The layer is read by the route straight away
      const state = await loadRoutingState(root)
      expect(routeKind(state, 'multi-file-feature', 'claude-code', { trial: false })).toMatchObject({ tier: 'fix', source: 'auto', adjustment: { action: 'escalate', from: 'build' } })
      // and the tier agents, committed from the shared routing, are reported as behind it
      expect(report.staleTierAgents).toContain('.claude/agents/sf-fix.md')
    })

    it('decides without writing on a dry run', async () => {
      await record('sssssssfff')
      const report = await runAdjustment(root, { dryRun: true, now: NOW })
      expect(report).toMatchObject({ dryRun: true, moved: true })
      await expect(stat(localRoutingPath(ledger))).rejects.toThrow()
    })

    it('moves nothing while the adjustment is switched off', async () => {
      await manifest({ version: 4, agents: ['claude-code'], routing: { adjust: { enabled: false } } })
      await record('sssssssfff')
      expect(await runAdjustment(root, { now: NOW })).toMatchObject({ moved: false, decisions: [expect.objectContaining({ action: 'hold', hold: 'disabled' })] })
    })

    it('does not move the kind a second time on the same evidence, and logs what it holds once', async () => {
      await record('sssssssfff')
      await runAdjustment(root, { now: NOW })
      expect((await runAdjustment(root, { now: new Date(NOW.getTime() + 60_000) })).moved).toBe(false)
      expect((await runAdjustment(root, { now: new Date(NOW.getTime() + 120_000) })).changed).toBe(false)
      expect((await readLocalRouting(ledger)).log.map((entry) => entry.action)).toEqual(['escalate', 'hold'])
    })

    it('reuses the state a capture just wrote instead of reading the ledger again', async () => {
      await record('sssssssfff')
      const state = await loadRoutingState(root)
      // The ledger on disk is emptied: only the state handed over can have produced the move
      await rm(join(ledger, 'delegations.jsonl'))
      const report = await runAdjustment(root, { now: NOW, state })
      expect(report.moved).toBe(true)
    })
  })

  describe('decisions rest on what the team committed (Examine finding 6, R1, R2)', () => {
    /** The manifest on disk, naming `main` as the working branch, not committed. */
    const withBranch = (routing?: Record<string, unknown>, workingBranch = 'main') => writeManifest({ version: 4, agents: ['claude-code'], ...(routing ? { routing } : {}) }, { workingBranch })
    const commit = (message: string) => commitManifest(message)

    it('reads the thresholds from the committed working branch, not from the worktree a delegated agent may have edited', async () => {
      await withBranch({ adjust: { escalate: { failures: 3, of: 10 } } })
      await commit('committed policy')
      await record('ssssssssff')
      // A worktree edit that lowers the threshold would move the whole clone on two failures
      await withBranch({ adjust: { escalate: { failures: 2, of: 10 } } })
      const refused = await runAdjustment(root, { now: NOW })
      expect(refused.refused).toContain('differs from the one committed on main')
      expect(refused).toMatchObject({ moved: false, decisions: [] })
      await expect(stat(localRoutingPath(ledger))).rejects.toThrow()
    })

    it('decides on the committed block once the worktree matches it', async () => {
      await withBranch({ adjust: { escalate: { failures: 2, of: 10 } } })
      await commit('committed policy')
      await record('ssssssssff')
      const report = await runAdjustment(root, { now: NOW })
      expect(report.refused).toBeNull()
      expect(report.decisions[0]).toMatchObject({ action: 'escalate', from: 'build', to: 'fix' })
    })

    it('applies nothing while the committed block and the worktree one differ, but still routes by the worktree for display, with no trial', async () => {
      await withBranch()
      await commit('committed')
      await record('s'.repeat(9))
      await withBranch({ tiers: { build: { 'claude-code': { model: 'claude-sonnet-5-6', effort: 'xhigh' } } } })
      const state = await loadRoutingState(root)
      expect(state.project.decision).toMatchObject({ source: 'working-branch', branch: 'main', differs: true })
      expect(routeKind(state, 'multi-file-feature', 'claude-code', { now: NOW })).toMatchObject({ tier: 'build', trial: false, candidate: { model: 'claude-sonnet-5-6' } })
    })

    it('still answers a route from the worktree block, and decides nothing, while the committed block is invalid', async () => {
      await withBranch({ kinds: { tests: { tier: 'nowhere' } } })
      await commit('committed with a mistake')
      await withBranch({ kinds: { tests: { tier: 'fix' } } })
      await record('ssssssssff')
      const state = await loadRoutingState(root)
      expect(state.project.decision).toMatchObject({ source: 'working-branch', differs: true, invalid: expect.stringContaining('modules.harness.routing on main is invalid') })
      expect(routeKind(state, 'tests', 'claude-code', { trial: false })).toMatchObject({ tier: 'fix', source: 'project' })
      const report = await runAdjustment(root, { now: NOW })
      expect(report).toMatchObject({ moved: false, decisions: [] })
      expect(report.refused).toContain('is invalid')
      expect(report.refused).toContain('modules.harness.routing on main is invalid')
    })

    // R1: the name of the working branch comes from a committed manifest, never from the one the worktree may have edited.
    describe('the working branch is named by a committed manifest (R1)', () => {
      it('is not fooled by a worktree that names a branch that does not exist: its own thresholds do not come into effect', async () => {
        await withBranch({ adjust: { escalate: { failures: 3, of: 10 } } })
        await commit('committed policy')
        await record('ssssssssff')
        await withBranch({ adjust: { escalate: { failures: 2, of: 10 } } }, 'nope')
        const state = await loadRoutingState(root)
        expect(state.project.decision).toMatchObject({ source: 'working-branch', branch: 'main', differs: true })
        expect(state.project.decision.policy.escalateFailures).toBe(3)
        const report = await runAdjustment(root, { now: NOW })
        expect(report).toMatchObject({ moved: false, decisions: [] })
        expect(report.refused).toContain('differs from the one committed on main')
      })

      it('keeps deciding on the committed block when only the branch name was edited in the worktree', async () => {
        await withBranch({ adjust: { escalate: { failures: 2, of: 10 } } })
        await commit('committed policy')
        await record('ssssssssff')
        await withBranch({ adjust: { escalate: { failures: 2, of: 10 } } }, 'nope')
        const report = await runAdjustment(root, { now: NOW })
        expect(report.refused).toBeNull()
        expect(report.decisions[0]).toMatchObject({ action: 'escalate' })
      })

      it('refuses to decide when the committed manifest names a branch that cannot be read', async () => {
        await withBranch({ adjust: { escalate: { failures: 2, of: 10 } } }, 'develop')
        await commit('names a branch that is not there')
        await record('ssssssssff')
        const state = await loadRoutingState(root)
        expect(state.project.decision).toMatchObject({ branch: 'develop', differs: true, invalid: expect.stringContaining('on the working branch develop') })
        expect(state.project.decision.policy.escalateFailures).toBe(3)
        const report = await runAdjustment(root, { now: NOW })
        expect(report).toMatchObject({ moved: false, decisions: [] })
        expect(report.refused).toContain('no committed .saasfoundry.json can be read on the working branch develop')
      })

      it('refuses to decide in a repository where no commit holds the manifest, instead of falling back to the worktree policy', async () => {
        const fresh = await realpath(await mkdtemp(join(tmpdir(), 'sf-runtime-fresh-')))
        try {
          await exec('git', ['init', '-q', '-b', 'main'], { cwd: fresh, env: cleanEnv })
          await writeManifest({ version: 4, agents: ['claude-code'], routing: { adjust: { escalate: { failures: 1, of: 2 } } } }, { workingBranch: 'main' }, fresh)
          const state = await loadRoutingState(fresh)
          expect(state.project.decision).toMatchObject({ source: 'head', differs: true, invalid: expect.stringContaining('no commit holds .saasfoundry.json yet') })
          expect(state.project.decision.policy.escalateFailures).toBe(3)
          expect((await runAdjustment(fresh, { now: NOW })).refused).toContain('no commit holds .saasfoundry.json yet')
        } finally {
          await rm(fresh, { recursive: true, force: true })
        }
      })

      it('names no working branch in a manifest that has no workflow block: the commit the worktree is on is the committed copy', async () => {
        await manifest({ version: 4, agents: ['claude-code'], routing: { adjust: { escalate: { failures: 2, of: 10 } } } })
        await record('ssssssssff')
        expect((await loadRoutingState(root)).project.decision).toMatchObject({ source: 'head', branch: 'HEAD', differs: false, invalid: null })
        expect((await runAdjustment(root, { now: NOW })).decisions[0]).toMatchObject({ action: 'escalate' })
      })

      it('has nothing to decide on in a project without a harness block', async () => {
        await writeFile(join(root, '.saasfoundry.json'), JSON.stringify({ version: 'test', projectName: 'bare', structure: 'cli' }))
        expect((await loadRoutingState(root)).project.decision).toMatchObject({ source: 'shipped', differs: false, invalid: null })
      })
    })

    // R1 and R2 against a remote: origin/HEAD names the default branch, and the remote branch is the committed copy of the team.
    describe('with a remote', () => {
      let remote: string
      const V1 = { adjust: { escalate: { failures: 3, of: 10 } } }
      const V2 = { adjust: { escalate: { failures: 2, of: 10 } } }

      beforeEach(async () => {
        remote = await realpath(await mkdtemp(join(tmpdir(), 'sf-runtime-remote-')))
        await exec('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: remote, env: cleanEnv })
        await git('remote', 'add', 'origin', remote)
      })
      afterEach(async () => rm(remote, { recursive: true, force: true }))

      it('compares the worktree with origin/<branch> first: a local branch nobody pulled does not make every worktree look different (R2)', async () => {
        await withBranch(V1)
        await commit('v1')
        const v1 = await git('rev-parse', 'HEAD')
        await withBranch(V2)
        await commit('v2')
        await git('push', '-q', 'origin', 'main')
        // The local main is behind the remote one; the worktree, cut from the remote, carries v2.
        await git('reset', '-q', '--soft', v1)
        await withBranch(V2)
        await record('ssssssssff')
        const state = await loadRoutingState(root)
        expect(state.project.decision).toMatchObject({ source: 'working-branch', branch: 'main', differs: false, invalid: null })
        expect(state.project.decision.policy.escalateFailures).toBe(2)
        expect((await runAdjustment(root, { now: NOW })).decisions[0]).toMatchObject({ action: 'escalate' })
      })

      it('falls back to the local branch when the remote does not have it', async () => {
        await withBranch(V1)
        await commit('v1')
        const state = await loadRoutingState(root)
        expect(state.project.decision).toMatchObject({ source: 'working-branch', branch: 'main', differs: false })
      })

      it('takes the name of the working branch from the remote default branch before the commit the worktree is on (R1)', async () => {
        await withBranch(V1, 'main')
        await commit('team policy')
        await git('push', '-q', 'origin', 'main')
        await git('remote', 'set-head', 'origin', 'main')
        // A branch of the delegated agent commits a manifest that names another working branch and lower thresholds
        await git('checkout', '-q', '-b', 'feature/agent')
        await withBranch(V2, 'feature/agent')
        await commit('the agent edits the policy')
        const state = await loadRoutingState(root)
        expect(state.project.decision).toMatchObject({ source: 'working-branch', branch: 'main', differs: true })
        expect(state.project.decision.policy.escalateFailures).toBe(3)
        expect((await runAdjustment(root, { now: NOW })).refused).toContain('differs from the one committed on main')
      })
    })
  })

  describe('route records and the share of trials (Examine findings 4 and 12)', () => {
    it('records a route the delegate echoes, with its kind, tier, ticket and trial flag, and hands out an id', async () => {
      const state = await loadRoutingState(root)
      const [route] = await issueRoutes(state, 'multi-file-feature', ['claude-code'], { record: true, trial: true, ticket: 1035, complexity: 'complex', nature: 'user-facing', now: NOW })
      expect(route).toMatchObject({ tier: 'build', trial: false, routeId: expect.stringMatching(/^[0-9a-f]{20}$/), expiresAt: new Date(NOW.getTime() + 7 * 24 * 3_600_000).toISOString() })
      const { routes } = await readLedger(ledger)
      expect(routes).toEqual([
        expect.objectContaining({
          id: route.routeId,
          taskKind: 'multi-file-feature',
          provider: 'claude-code',
          tier: 'build',
          trial: false,
          ticket: 1035,
          complexity: 'complex',
          nature: 'user-facing',
          retryOf: null
        })
      ])
    })

    it('does not record anything when a route is only read', async () => {
      const state = await loadRoutingState(root)
      const [route] = await issueRoutes(state, 'tests', ['claude-code'], { record: false, trial: true })
      expect(route.routeId).toBeNull()
      expect((await readLedger(ledger)).routes).toEqual([])
    })

    it('reserves a trial as it hands it out: routes asked for together cannot all be trials', async () => {
      await record('s'.repeat(9))
      const first = await issueRoutes(await loadRoutingState(root), 'multi-file-feature', ['claude-code'], { record: true, trial: true, now: NOW })
      expect(first[0]).toMatchObject({ trial: true, tier: 'edit', effectiveTier: 'build' })
      const second = await issueRoutes(await loadRoutingState(root), 'multi-file-feature', ['claude-code'], { record: true, trial: true, now: new Date(NOW.getTime() + 1000) })
      expect(second[0]).toMatchObject({ trial: false, tier: 'build' })
      const { routes } = await readLedger(ledger)
      expect(routes.map((route) => [route.tier, route.trial])).toEqual([
        ['edit', true],
        ['build', false]
      ])
      // Asked at once, from several processes, the share still holds
      await rm(join(ledger, 'delegations.jsonl'))
      await record('s'.repeat(9))
      const together = await Promise.all(
        Array.from({ length: 5 }, async () => (await issueRoutes(await loadRoutingState(root), 'multi-file-feature', ['claude-code'], { record: true, trial: true, now: NOW }))[0])
      )
      expect(together.filter((route) => route.trial)).toHaveLength(1)
    })

    it('links a retry to the delegation it follows, and refuses a link to nothing', async () => {
      const first = (await issueRoutes(await loadRoutingState(root), 'tests', ['claude-code'], { record: true, trial: false, now: NOW }))[0]
      const retry = await issueRoutes(await loadRoutingState(root), 'tests', ['claude-code'], { record: true, trial: false, retryOf: first.routeId, now: NOW })
      expect((await readLedger(ledger)).routes.find((route) => route.id === retry[0].routeId)?.retryOf).toBe(first.routeId)
      await expect(issueRoutes(await loadRoutingState(root), 'tests', ['claude-code'], { record: true, trial: false, retryOf: 'f'.repeat(20) })).rejects.toThrow('names no route or run')
    })

    // R4: a retry that came back on the tier that failed, or on a cheaper tier as a trial, would defeat its own purpose.
    describe('a retry goes one tier above the delegation it retries, and is never a trial (R4)', () => {
      const failedRun = async () => (await readLedger(ledger)).runs.find((run) => run.outcome === 'validation-failed')!

      it('answers the tier above the retried run, although the kind is routed lower and a trial of a cheaper tier is due', async () => {
        await record('s'.repeat(9), { taskKind: 'scoped-edit', tier: 'edit' })
        await record('f', { taskKind: 'scoped-edit', tier: 'edit' })
        const failed = await failedRun()
        // Without the link, the kind is routed to edit and a trial of the tier below it is due
        expect((await issueRoutes(await loadRoutingState(root), 'scoped-edit', ['claude-code'], { record: false, trial: true, now: NOW }))[0]).toMatchObject({ trial: true, tier: 'light' })
        const [retry] = await issueRoutes(await loadRoutingState(root), 'scoped-edit', ['claude-code'], { record: true, trial: true, retryOf: failed.id, now: NOW })
        expect(retry).toMatchObject({ tier: 'build', trial: false, effectiveTier: null, retry: { of: failed.id, from: 'edit' }, candidate: { model: 'claude-sonnet-5-5' } })
        expect((await readLedger(ledger)).routes.find((route) => route.id === retry.routeId)).toMatchObject({ tier: 'build', trial: false, retryOf: failed.id })
      })

      it('climbs one more rung for the retry of a retry, whose route (not yet run) is what it follows', async () => {
        await record('f', { taskKind: 'scoped-edit', tier: 'edit' })
        const failed = await failedRun()
        const [first] = await issueRoutes(await loadRoutingState(root), 'scoped-edit', ['claude-code'], { record: true, trial: false, retryOf: failed.id, now: NOW })
        const [second] = await issueRoutes(await loadRoutingState(root), 'scoped-edit', ['claude-code'], { record: true, trial: false, retryOf: first.routeId, now: new Date(NOW.getTime() + 1000) })
        expect([first.tier, second.tier]).toEqual(['build', 'fix'])
        expect(second.retry).toEqual({ of: first.routeId, from: 'build' })
      })

      it('refuses a retry when nothing stronger is left, and says what to do', async () => {
        await record('f', { taskKind: 'terminal-ci', tier: 'terminal' })
        await expect(issueRoutes(await loadRoutingState(root), 'terminal-ci', ['claude-code'], { record: true, trial: false, retryOf: (await failedRun()).id })).rejects.toThrow(
          'no stronger tier of claude-code is left for terminal-ci'
        )
      })

      it('refuses a retry of another task kind or of another coding agent', async () => {
        await record('f', { taskKind: 'scoped-edit', tier: 'edit' })
        const failed = await failedRun()
        await expect(issueRoutes(await loadRoutingState(root), 'tests', ['claude-code'], { record: true, trial: false, retryOf: failed.id })).rejects.toThrow('a retry has the same task kind')
        await expect(issueRoutes(await loadRoutingState(root), 'scoped-edit', ['codex'], { record: true, trial: false, retryOf: failed.id })).rejects.toThrow(
          'a retry stays with the same coding agent'
        )
        expect((await readLedger(ledger)).routes).toEqual([])
      })
    })

    it('needs a clone to keep the route in', async () => {
      const elsewhere = await realpath(await mkdtemp(join(tmpdir(), 'sf-runtime-nogit-')))
      try {
        await expect(issueRoutes(await loadRoutingState(elsewhere), 'tests', ['claude-code'], { record: true, trial: false })).rejects.toThrow('Git checkout')
      } finally {
        await rm(elsewhere, { recursive: true, force: true })
      }
    })
  })

  describe('trials', () => {
    it('answers the cheaper tier on a bounded sample and says so, unless asked for the routed tier', async () => {
      await record('s'.repeat(9))
      const state = await loadRoutingState(root)
      expect(routeKind(state, 'multi-file-feature', 'claude-code', { now: NOW })).toMatchObject({
        tier: 'edit',
        trial: true,
        effectiveTier: 'build',
        source: 'shipped',
        candidate: { model: 'claude-haiku-5-5', effort: 'high' }
      })
      expect(routeKind(state, 'multi-file-feature', 'claude-code', { now: NOW, trial: false })).toMatchObject({ tier: 'build', trial: false, effectiveTier: null })
      expect(routeKind(state, 'tests', 'claude-code', { now: NOW })).toMatchObject({ trial: false })
    })
  })

  describe('a clone whose history cannot be read', () => {
    it('fails closed for the commands that write, and lets a route fall back to the shared routing', async () => {
      await record('s')
      await writeFile(localRoutingPath(ledger), '{ nope')
      await expect(loadRoutingState(root)).rejects.toThrow('Invalid local routing')
      const warnings: string[] = []
      const state = await loadRoutingState(root, { onDamaged: (message) => warnings.push(message) })
      expect(warnings[0]).toContain('delete the file to start over')
      expect(routeKind(state, 'tests', 'claude-code', { trial: false })).toMatchObject({ tier: 'build', source: 'shipped' })
    })
  })

  describe('undoing a move (AC-6)', () => {
    it('returns the kind to the shipped grid, restarts the evidence, and logs the reset', async () => {
      await record('sssssssfff')
      await runAdjustment(root, { now: NOW })
      const reset = await resetLocalRouting(root, 'multi-file-feature', { now: new Date(NOW.getTime() + 60_000) })
      expect(reset).toEqual({ kind: 'multi-file-feature', reset: [{ provider: 'claude-code', from: 'fix', restoredTo: 'build' }], sharedOverride: null })
      const local = await readLocalRouting(ledger)
      expect(local.kinds).toEqual({})
      expect(local.log.map((line) => line.action)).toEqual(['escalate', 'reset'])
      expect(routeKind(await loadRoutingState(root), 'multi-file-feature', 'claude-code', { trial: false })).toMatchObject({ tier: 'build', source: 'shipped' })
      // The failures that caused the move are not counted again: the next capture does not undo the reset
      expect((await runAdjustment(root, { now: new Date(NOW.getTime() + 120_000) })).moved).toBe(false)
    })

    it('never changes what the developer wrote in the manifest, and says it', async () => {
      await manifest({ version: 4, agents: ['claude-code'], routing: { kinds: { tests: { tier: 'plan' } } } })
      const before = await readFile(join(root, '.saasfoundry.json'), 'utf8')
      await updateLocalRouting(ledger, () => ({
        next: { ...emptyLocalRouting(), kinds: { tests: { 'claude-code': { tier: 'fix', from: 'build', action: 'escalate', at: NOW.toISOString(), evidence: {} as never } } } },
        result: null
      }))
      expect(await resetLocalRouting(root, 'tests')).toEqual({ kind: 'tests', reset: [{ provider: 'claude-code', from: 'fix', restoredTo: 'plan' }], sharedOverride: 'plan' })
      expect(await readFile(join(root, '.saasfoundry.json'), 'utf8')).toBe(before)
    })

    it('only resets the provider it is asked to', async () => {
      const entry = (tier: string): LocalAdjustment => ({ tier, from: 'build', action: 'escalate', at: NOW.toISOString(), evidence: {} as never })
      await updateLocalRouting(ledger, () => ({ next: { ...emptyLocalRouting(), kinds: { tests: { 'claude-code': entry('fix'), codex: entry('terminal') } } }, result: null }))
      const reset = await resetLocalRouting(root, 'tests', { provider: 'codex' })
      expect(reset.reset).toEqual([{ provider: 'codex', from: 'terminal', restoredTo: 'build' }])
      expect(Object.keys((await readLocalRouting(ledger)).kinds.tests ?? {})).toEqual(['claude-code'])
    })

    it('says there is nothing to undo, and refuses outside a clone', async () => {
      expect(await resetLocalRouting(root, 'tests')).toEqual({ kind: 'tests', reset: [], sharedOverride: null })
      const elsewhere = await realpath(await mkdtemp(join(tmpdir(), 'sf-runtime-reset-')))
      try {
        await expect(resetLocalRouting(elsewhere, 'tests')).rejects.toThrow('Git directory of the clone')
      } finally {
        await rm(elsewhere, { recursive: true, force: true })
      }
    })
  })

  describe('promoting a move to the shared manifest', () => {
    const at = '2026-10-20T08:00:00.000Z'
    const evidence = {
      rule: '3 failures',
      from: { tier: 'build', candidate: 'a/b' },
      to: { tier: 'fix', candidate: 'c/d' },
      window: { rated: 10, successes: 7, failures: 3 },
      expectedFeatureCost: { from: '1.000000', to: null, currency: 'USD' as const },
      durationP95Ms: { from: null, to: null },
      runs: []
    }
    const entry = (tier: string, from: string): LocalAdjustment => ({ tier, from, action: 'escalate', at, evidence })
    const putLocal = (kinds: Record<string, Record<string, LocalAdjustment>>) => updateLocalRouting(ledger, () => ({ next: { ...emptyLocalRouting(), kinds: kinds as never }, result: null }))

    it('copies the tier into modules.harness.routing, drops the local entry, logs it, and keeps the rest of the manifest', async () => {
      await record('sssssssfff')
      await runAdjustment(root, { now: NOW })
      const result = await promoteLocalRouting({ targetPath: root, kind: 'multi-file-feature', now: () => NOW })
      expect(result).toEqual({ promoted: [{ kind: 'multi-file-feature', tier: 'fix', providers: ['claude-code'], dropped: [] }], skipped: [], manifestChanged: true })
      const after = JSON.parse(await readFile(join(root, '.saasfoundry.json'), 'utf8'))
      expect(after.modules.harness.routing).toEqual({ kinds: { 'multi-file-feature': { tier: 'fix' } } })
      expect(after.modules.harness.agents).toEqual(['claude-code'])
      expect(after.fileHashes).toEqual({ 'keep.txt': 'abc' })
      const local = await readLocalRouting(ledger)
      expect(local.kinds).toEqual({})
      expect(local.log.map((line) => line.action)).toEqual(['escalate', 'promote'])
      // The shared override now decides, and shows as the project's
      const state = await loadRoutingState(root)
      expect(routeKind(state, 'multi-file-feature', 'claude-code', { trial: false })).toMatchObject({ tier: 'fix', source: 'project' })
    })

    it('promotes every move when no kind is named', async () => {
      await putLocal({ tests: { 'claude-code': entry('fix', 'build') }, prose: { 'claude-code': entry('edit', 'light') } })
      const result = await promoteLocalRouting({ targetPath: root })
      expect(result.promoted.map((promotion) => promotion.kind)).toEqual(['tests', 'prose'])
      expect((await harness()).routing.kinds).toEqual({ tests: { tier: 'fix' }, prose: { tier: 'edit' } })
    })

    it('never replaces what the developer wrote: a kind the manifest already overrides is skipped', async () => {
      await manifest({ version: 4, agents: ['claude-code'], routing: { kinds: { tests: { tier: 'plan' } } } })
      await putLocal({ tests: { 'claude-code': entry('fix', 'build') } })
      const result = await promoteLocalRouting({ targetPath: root, kind: 'tests' })
      expect(result.promoted).toEqual([])
      expect(result.skipped[0].reason).toContain('already overrides tests')
      expect((await harness()).routing.kinds.tests).toEqual({ tier: 'plan' })
      expect((await readLocalRouting(ledger)).kinds.tests).toBeDefined()
    })

    it('refuses to share two moves that disagree, because a shared override covers every provider', async () => {
      await manifest({ version: 4, agents: ['claude-code', 'codex'] })
      await putLocal({ tests: { 'claude-code': entry('fix', 'build'), codex: entry('terminal', 'build') } })
      await expect(promoteLocalRouting({ targetPath: root, kind: 'tests' })).rejects.toThrow('promote one with --provider <agent>')
      const result = await promoteLocalRouting({ targetPath: root, kind: 'tests', provider: 'codex' })
      expect(result.promoted).toEqual([{ kind: 'tests', tier: 'terminal', providers: ['codex'], dropped: ['claude-code'] }])
      expect((await readLocalRouting(ledger)).kinds).toEqual({})
    })

    it('shares two moves that agree', async () => {
      await manifest({ version: 4, agents: ['claude-code', 'codex'] })
      await putLocal({ tests: { 'claude-code': entry('fix', 'build'), codex: entry('fix', 'build') } })
      expect((await promoteLocalRouting({ targetPath: root })).promoted).toEqual([{ kind: 'tests', tier: 'fix', providers: ['claude-code', 'codex'], dropped: [] }])
    })

    it('says so when there is nothing to promote, and refuses what it cannot promote', async () => {
      expect(await promoteLocalRouting({ targetPath: root })).toEqual({ promoted: [], skipped: [], manifestChanged: false })
      expect((await promoteLocalRouting({ targetPath: root, kind: 'tests' })).skipped[0].reason).toContain('no automatic move')
      await expect(promoteLocalRouting({ targetPath: root, kind: 'deploy' })).rejects.toThrow('Unknown task kind')
      await expect(promoteLocalRouting({ targetPath: root, provider: 'gemini-cli' })).rejects.toThrow('Routed coding agents')
    })

    it('needs a harness block to write into', async () => {
      await writeFile(join(root, '.saasfoundry.json'), JSON.stringify({ version: 'test', projectName: 'bare', structure: 'cli' }))
      await putLocal({ tests: { 'claude-code': entry('fix', 'build') } })
      await expect(promoteLocalRouting({ targetPath: root })).rejects.toThrow('no harness block')
    })
  })
})
