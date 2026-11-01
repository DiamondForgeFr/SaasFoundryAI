import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { promisify } from 'util'

import { CLAUDE_CAPTURE_HOOKS, type CaptureProbe } from '../../../harness/delegation-hooks'
import { ROUTING_GRID_VERSION } from '../../../harness/routing-grid'
import { emptyLocalRouting, localRoutingPath, updateLocalRouting } from '../../../harness/routing-local'
import { renderTierAgents } from '../../../harness/tier-agents'
import { collectStatus, type StatusRouting, type StatusRoutingState } from '../../../status/collect'
import { evaluatePreconditions } from '../../../status/preconditions'
import { renderAgentFriendly, renderHuman, renderJson, routingSummary } from '../../../status/render'
import type { HarnessAgent } from '../../../types'

const exec = promisify(execFile)
// A commit hook exports GIT_* variables: a fixture repository must never inherit them.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
const AT = '2026-10-20T08:00:00.000Z'
const move = { kind: 'multi-file-feature', provider: 'claude-code', tier: 'fix', from: 'build', action: 'escalate', at: AT }
const runnable: CaptureProbe = async () => true
const notRunnable: CaptureProbe = async () => false
const sha = (content: string) => createHash('sha256').update(content).digest('hex')
/** The tier agents a refresh would write for these coding agents, shipped grid and no override unless given. */
const tierFiles = (agents: HarnessAgent[] = ['claude-code'], overrides?: Parameters<typeof renderTierAgents>[1]) => renderTierAgents(agents, overrides)
/** The routing state as `sf status` builds it, for the renderers that only read it. */
const routingState = (state: Partial<StatusRoutingState> = {}): StatusRoutingState => ({
  gridVersion: ROUTING_GRID_VERSION,
  overrides: { kinds: [], tiers: [] },
  tierAgents: [],
  adjustment: 'on',
  adjustments: [],
  holds: [],
  capture: [{ agent: 'claude-code', state: 'enforced' }],
  ...state
})

describe('the automatic routing in sf status (#1035)', () => {
  describe('routingSummary', () => {
    const enforced = { agent: 'claude-code', state: 'enforced' as const }

    it('says the routing is the shared one while nothing moved, and that capture is enforced', () => {
      expect(routingSummary(routingState())).toBe(`grid v${ROUTING_GRID_VERSION}, 0 overrides; shipped grid and shared overrides, no local adjustment; claude-code capture enforced`)
    })

    it('names the grid version and each override the project makes, so the route is known not to be the shipped one (#933)', () => {
      const summary = routingSummary(
        routingState({
          overrides: {
            kinds: [
              { kind: 'multi-file-feature', tier: 'plan' },
              { kind: 'prose', tier: 'light' }
            ],
            tiers: [{ tier: 'build', providers: ['claude-code', 'codex'] }]
          }
        })
      )
      expect(summary).toContain(`grid v${ROUTING_GRID_VERSION}, 3 overrides (multi-file-feature → plan; prose → light; tier build for claude-code, codex); `)
      expect(routingSummary(routingState({ overrides: { kinds: [{ kind: 'prose', tier: 'light' }], tiers: [] } }))).toContain(`grid v${ROUTING_GRID_VERSION}, 1 override (prose → light); `)
      expect(routingSummary(routingState({ overrides: { kinds: [], tiers: [{ tier: 'custom', providers: [] }] } }))).toContain('1 override (tier custom);')
    })

    it('names the moves nobody promoted yet, with the kind, the tier, the agent and the day', () => {
      const summary = routingSummary(routingState({ adjustments: [move, { ...move, kind: 'prose', provider: 'codex', tier: 'edit', from: 'light', action: 'deescalate' }] }))
      expect(summary).toContain('2 local automatic adjustments not promoted (multi-file-feature → fix for claude-code, escalate on 2026-10-20; prose → edit for codex, deescalate on 2026-10-20;')
      expect(summary).toContain('sf agents routing report, promote or reset')
      expect(routingSummary(routingState({ adjustments: [move] }))).toContain('1 local automatic adjustment not promoted')
    })

    it('names a kind the adjustment cannot move, and counts the ones that are only waiting for evidence', () => {
      const summary = routingSummary(
        routingState({
          holds: [
            { kind: 'terminal-ci', provider: 'claude-code', reason: 'top-of-ladder', since: AT },
            { kind: 'tests', provider: 'claude-code', reason: 'trial-not-proven', since: AT },
            { kind: 'prose', provider: 'claude-code', reason: 'no-evidence', since: AT }
          ]
        })
      )
      expect(summary).toContain('terminal-ci (claude-code) held: top-of-ladder since 2026-10-20')
      expect(summary).toContain('2 other kinds left where they are for now')
      expect(summary).toContain('sf agents routing report')
    })

    it('says what is missing when the hooks are not in place, and what to do instead for a host without hooks', () => {
      const summary = routingSummary(
        routingState({
          capture: [
            { agent: 'codex', state: 'missing' },
            { agent: 'gemini-cli', state: 'not-enforced' }
          ]
        })
      )
      expect(summary).toContain('codex capture hook missing (run sf agents refresh --scope shared)')
      expect(summary).toContain('gemini-cli capture not enforced (record its delegations with sf agents outcome record)')
    })

    it('does not call a hook enforced when nothing can run it, or when the host has not trusted it yet', () => {
      const summary = routingSummary(
        routingState({
          capture: [
            { agent: 'claude-code', state: 'declared-not-runnable' },
            { agent: 'codex', state: 'declared' }
          ]
        })
      )
      expect(summary).toContain('claude-code capture hook declared but no CLI can run it')
      expect(summary).toContain('delegations are not recorded')
      expect(summary).toContain('codex capture declared (Codex runs it once the .codex/ layer and the hook are trusted)')
      expect(summary).not.toContain('enforced')
    })

    it('says an earlier release hook needs a refresh', () => {
      expect(routingSummary(routingState({ capture: [{ agent: 'claude-code', state: 'outdated' }] }))).toContain('capture hook outdated (run sf agents refresh --scope shared)')
    })

    it('says when the automatic adjustment is off, and never raises on an unreadable layer', () => {
      expect(routingSummary(routingState({ adjustment: 'off', capture: [enforced] }))).toContain('automatic adjustment off')
      expect(routingSummary({ error: 'Invalid local routing in x' })).toBe('unreadable (Invalid local routing in x)')
    })
  })

  describe('the status of a project', () => {
    let root: string
    const manifest = (harness?: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      writeFile(
        join(root, '.saasfoundry.json'),
        JSON.stringify({ version: '1.0.0-beta', projectName: 'status-demo', structure: 'cli', generatedAt: AT, ...extra, ...(harness ? { modules: { harness } } : {}) }, null, 2) + '\n'
      )
    const layer = () => join(root, '.git', 'saasfoundry')
    const report = async (captureProbe: CaptureProbe = runnable) => collectStatus(root, { checkNetwork: false, captureProbe })
    const render = async (renderer: typeof renderAgentFriendly, captureProbe: CaptureProbe = runnable) => {
      const status = await report(captureProbe)
      return renderer({ report: status, preconditions: evaluatePreconditions(status) })
    }
    const notDeposited = (agents: HarnessAgent[]) => tierFiles(agents).map(({ path }) => ({ path, state: 'missing' }))

    beforeEach(async () => {
      root = await realpath(await mkdtemp(join(tmpdir(), 'sf-status-routing-')))
      await exec('git', ['init', '-q', '-b', 'main'], { cwd: root, env: cleanEnv })
      await mkdir(join(root, '.claude/skills'), { recursive: true })
    })
    afterEach(async () => rm(root, { recursive: true, force: true }))

    it('has no routing line on a project without a harness', async () => {
      await manifest()
      expect((await report()).routing).toBeUndefined()
      expect(await render(renderAgentFriendly)).not.toContain('- routing:')
      expect(JSON.parse(await render(renderJson)).routing).toBeNull()
    })

    it('says the routing is the shipped one, and that the capture hooks are missing, on a harness that has none yet', async () => {
      await manifest({ version: 4, agents: ['claude-code', 'codex'] })
      expect((await report()).routing).toEqual({
        gridVersion: ROUTING_GRID_VERSION,
        overrides: { kinds: [], tiers: [] },
        tierAgents: notDeposited(['claude-code', 'codex']),
        adjustment: 'on',
        adjustments: [],
        holds: [],
        capture: [
          { agent: 'claude-code', state: 'missing' },
          { agent: 'codex', state: 'missing' }
        ]
      })
      expect(await render(renderAgentFriendly)).toContain(
        `- routing: grid v${ROUTING_GRID_VERSION}, 0 overrides; shipped grid and shared overrides, no local adjustment; claude-code capture hook missing (run sf agents refresh --scope shared); codex capture hook missing`
      )
    })

    it('shows the local moves, the holds and the enforced capture in the three outputs', async () => {
      await manifest({ version: 4, agents: ['claude-code'] })
      await mkdir(join(root, '.claude'), { recursive: true })
      await writeFile(join(root, '.claude', 'settings.json'), JSON.stringify({ hooks: CLAUDE_CAPTURE_HOOKS }))
      await updateLocalRouting(layer(), () => ({
        next: {
          ...emptyLocalRouting(),
          kinds: { 'multi-file-feature': { 'claude-code': { tier: 'fix', from: 'build', action: 'escalate', at: AT, evidence: {} as never } } },
          holds: { 'terminal-ci': { 'claude-code': { reason: 'top-of-ladder', since: AT } } }
        },
        result: null
      }))
      const routing = (await report()).routing as StatusRouting
      expect(routing).toEqual({
        gridVersion: ROUTING_GRID_VERSION,
        overrides: { kinds: [], tiers: [] },
        tierAgents: notDeposited(['claude-code']),
        adjustment: 'on',
        adjustments: [{ ...move }],
        holds: [{ kind: 'terminal-ci', provider: 'claude-code', reason: 'top-of-ladder', since: AT }],
        capture: [{ agent: 'claude-code', state: 'enforced' }]
      })
      expect(await render(renderAgentFriendly)).toContain(
        `- routing: grid v${ROUTING_GRID_VERSION}, 0 overrides; 1 local automatic adjustment not promoted (multi-file-feature → fix for claude-code, escalate on`
      )
      expect(await render(renderAgentFriendly)).toContain('terminal-ci (claude-code) held: top-of-ladder since 2026-10-20')
      expect(await render(renderHuman)).toMatch(/Routing:.*1 local automatic adjustment not promoted/)
      expect(JSON.parse(await render(renderJson)).routing).toEqual(routing)
    })

    it('reports a declared hook as not runnable when the project resolves no CLI that has the command', async () => {
      await manifest({ version: 4, agents: ['claude-code'] })
      await mkdir(join(root, '.claude'), { recursive: true })
      await writeFile(join(root, '.claude', 'settings.json'), JSON.stringify({ hooks: CLAUDE_CAPTURE_HOOKS }))
      expect(((await report(notRunnable)).routing as { capture: unknown }).capture).toEqual([{ agent: 'claude-code', state: 'declared-not-runnable' }])
      expect(await render(renderAgentFriendly, notRunnable)).toContain('claude-code capture hook declared but no CLI can run it')
    })

    it('reads a manifest that switches the adjustment off', async () => {
      await manifest({ version: 4, agents: ['claude-code'], routing: { adjust: { enabled: false } } })
      expect(((await report()).routing as { adjustment: string }).adjustment).toBe('off')
    })

    it('never fails on a damaged layer: it says it is unreadable', async () => {
      await manifest({ version: 4, agents: ['claude-code'] })
      await mkdir(layer(), { recursive: true })
      await writeFile(localRoutingPath(layer()), '{ nope')
      const routing = (await report()).routing as { error: string }
      expect(routing.error).toContain('Invalid local routing')
      expect(await render(renderAgentFriendly)).toContain('- routing: unreadable (Invalid local routing')
    })

    it('is quiet about the routing outside a Git checkout, which has no clone to keep moves in', async () => {
      const elsewhere = await realpath(await mkdtemp(join(tmpdir(), 'sf-status-routing-nogit-')))
      try {
        await writeFile(join(elsewhere, '.saasfoundry.json'), JSON.stringify({ version: '1.0.0-beta', projectName: 'x', structure: 'cli', modules: { harness: { version: 4 } } }))
        expect((await collectStatus(elsewhere, { checkNetwork: false, captureProbe: runnable })).routing).toMatchObject({ adjustments: [] })
      } finally {
        await rm(elsewhere, { recursive: true, force: true })
      }
    })

    describe('the grid and the project overrides (#933)', () => {
      it('lists what modules.harness.routing replaces in the three outputs', async () => {
        await manifest({
          version: 4,
          agents: ['claude-code'],
          routing: { kinds: { 'multi-file-feature': { tier: 'plan' } }, tiers: { build: { 'claude-code': { model: 'claude-sonnet-5-5', effort: 'high' } } } }
        })
        const routing = (await report()).routing as StatusRoutingState
        expect(routing.gridVersion).toBe(ROUTING_GRID_VERSION)
        expect(routing.overrides).toEqual({ kinds: [{ kind: 'multi-file-feature', tier: 'plan' }], tiers: [{ tier: 'build', providers: ['claude-code'] }] })
        expect(await render(renderAgentFriendly)).toContain(`- routing: grid v${ROUTING_GRID_VERSION}, 2 overrides (multi-file-feature → plan; tier build for claude-code); `)
        expect(await render(renderHuman)).toMatch(/Routing:.*2 overrides \(multi-file-feature → plan; tier build for claude-code\)/)
        expect(JSON.parse(await render(renderJson)).routing).toMatchObject({ gridVersion: ROUTING_GRID_VERSION, overrides: routing.overrides })
      })
    })

    describe('the tier agents (#933)', () => {
      const deposit = async (files = tierFiles()) => {
        for (const file of files) {
          await mkdir(dirname(join(root, file.path)), { recursive: true })
          await writeFile(join(root, file.path), file.content)
        }
      }
      const states = async () => ((await report()).routing as StatusRoutingState).tierAgents
      const precondition = async () => {
        const status = await report()
        return evaluatePreconditions(status).find((entry) => entry.name === 'tierAgents')!
      }
      const BUILD = '.claude/agents/sf-build.md'
      const stateOf = async (path: string) => (await states()).find((entry) => entry.path === path)?.state

      it('finds every tier agent in place when the files are the render', async () => {
        await manifest({ version: 4, agents: ['claude-code'] })
        await deposit()
        expect(await states()).toEqual(tierFiles().map(({ path }) => ({ path, state: 'ok' })))
        expect(await precondition()).toMatchObject({ status: 'ok', details: `${tierFiles().length} match routing grid v${ROUTING_GRID_VERSION}` })
      })

      it('warns about a missing tier agent and sends it to a refresh', async () => {
        await manifest({ version: 4, agents: ['claude-code'] })
        await deposit(tierFiles().filter(({ path }) => path !== BUILD))
        expect(await stateOf(BUILD)).toBe('missing')
        const warning = await precondition()
        expect(warning).toMatchObject({ status: 'warn', details: `${BUILD} missing` })
        expect(warning.remediation).toContain('sf agents refresh --scope shared')
        expect(warning.remediation).not.toContain('Restore')
        expect(await render(renderAgentFriendly)).toContain(`- [warn] Tier agents match the routing grid — ${BUILD} missing`)
      })

      it('warns about an edited tier agent, whatever baseline the manifest records, and keeps the file as it is', async () => {
        const [build] = tierFiles().filter(({ path }) => path === BUILD)
        await manifest({ version: 4, agents: ['claude-code'] }, { fileHashes: { [BUILD]: sha(build.content) } })
        await deposit()
        await writeFile(join(root, BUILD), `${build.content}\nAlways answer in French.\n`)
        expect(await stateOf(BUILD)).toBe('edited')
        const warning = await precondition()
        expect(warning).toMatchObject({ status: 'warn', details: `${BUILD} edited` })
        expect(warning.remediation).toContain(`Restore ${BUILD}`)
        expect(warning.remediation).toContain('modules.harness.routing')
        expect(warning.remediation).toContain('sf agents refresh --scope shared')
        expect(warning.remediation).not.toContain('to regenerate the missing and outdated ones')
        // Read-only: no sidecar, and the edit is still there.
        expect(await readFile(join(root, BUILD), 'utf8')).toContain('Always answer in French.')
        expect((await readdir(join(root, '.claude/agents'))).filter((name) => name.endsWith('.saasfoundry.new'))).toEqual([])
      })

      it('calls a file that differs from the render without any recorded baseline edited, as the refresh does', async () => {
        await manifest({ version: 4, agents: ['claude-code'] })
        await deposit()
        await writeFile(join(root, BUILD), 'something else\n')
        expect(await stateOf(BUILD)).toBe('edited')
      })

      it('calls an unedited tier agent outdated when the overrides moved on, and sends it to a refresh', async () => {
        const shipped = tierFiles()
        const baselines = Object.fromEntries(shipped.map((file) => [file.path, sha(file.content)]))
        await manifest({ version: 4, agents: ['claude-code'], routing: { tiers: { build: { 'claude-code': { model: 'claude-sonnet-5-5', effort: 'high' } } } } }, { fileHashes: baselines })
        await deposit(shipped)
        expect(await stateOf(BUILD)).toBe('outdated')
        expect((await states()).filter((entry) => entry.state !== 'outdated').every((entry) => entry.state === 'ok')).toBe(true)
        const warning = await precondition()
        expect(warning).toMatchObject({ status: 'warn', details: `${BUILD} outdated` })
        expect(warning.remediation).toContain('sf agents refresh --scope shared')
        expect(warning.remediation).not.toContain('Restore')
      })

      it('reports a mix of states with the remediation of each', async () => {
        const shipped = tierFiles()
        const baselines = Object.fromEntries(shipped.map((file) => [file.path, sha(file.content)]))
        await manifest({ version: 4, agents: ['claude-code'], routing: { tiers: { build: { 'claude-code': { model: 'claude-sonnet-5-5', effort: 'high' } } } } }, { fileHashes: baselines })
        await deposit(shipped.filter(({ path }) => path !== '.claude/agents/sf-fix.md'))
        await writeFile(join(root, '.claude/agents/sf-plan.md'), 'edited\n')
        const warning = await precondition()
        const expected: Record<string, string> = { [BUILD]: 'outdated', '.claude/agents/sf-fix.md': 'missing', '.claude/agents/sf-plan.md': 'edited' }
        expect(warning.details).toBe(
          shipped
            .filter(({ path }) => expected[path])
            .map(({ path }) => `${path} ${expected[path]}`)
            .join('; ')
        )
        expect(warning.remediation).toContain('to regenerate the missing and outdated ones')
        expect(warning.remediation).toContain('Restore .claude/agents/sf-plan.md')
      })

      it('reads the baseline of a tier agent a local setup wrote in the private inventory of the clone', async () => {
        const shipped = tierFiles()
        await manifest({ version: 4, agents: ['claude-code'], routing: { tiers: { build: { 'claude-code': { model: 'claude-sonnet-5-5', effort: 'high' } } } } })
        await deposit(shipped)
        // Nothing records the shipped render as a baseline yet: the refresh would call the file edited.
        expect(await stateOf(BUILD)).toBe('edited')
        await mkdir(layer(), { recursive: true })
        await writeFile(join(layer(), 'agents.json'), JSON.stringify({ version: 1, agents: [], fileHashes: Object.fromEntries(shipped.map((file) => [file.path, sha(file.content)])) }))
        expect(await stateOf(BUILD)).toBe('outdated')
      })

      it('says so, and does not fail, when the private inventory cannot be read', async () => {
        await manifest({ version: 4, agents: ['claude-code'] })
        await deposit()
        await writeFile(join(root, BUILD), 'edited\n')
        await mkdir(layer(), { recursive: true })
        await writeFile(join(layer(), 'agents.json'), '{ nope')
        const routing = (await report()).routing as StatusRoutingState
        expect(routing.tierAgents).toEqual([])
        expect(routing.tierAgentsIssue).toContain('Invalid private agent inventory')
        expect(await precondition()).toMatchObject({ status: 'warn' })
      })

      it('says so, and does not fail, when the overrides cannot be rendered', async () => {
        await manifest({ version: 4, agents: ['claude-code'], routing: { kinds: { prose: { tier: 'nowhere' } } } })
        const routing = (await report()).routing as StatusRoutingState
        expect(routing.tierAgents).toEqual([])
        expect(routing.tierAgentsIssue).toContain("routing.kinds.prose.tier 'nowhere' is neither shipped nor declared")
        expect(routing.tierAgentsIssue).not.toContain('\n')
        const warning = await precondition()
        expect(warning.status).toBe('warn')
        expect(warning.remediation).toContain('modules.harness.routing')
        expect(warning.remediation).toContain('sf agents refresh --scope shared')
      })

      it('treats a tier agent the refresh would refuse to touch, a link for instance, as edited', async () => {
        await manifest({ version: 4, agents: ['claude-code'] })
        await deposit()
        await writeFile(join(root, 'elsewhere.md'), tierFiles().find(({ path }) => path === BUILD)!.content)
        await rm(join(root, BUILD))
        await symlink(join(root, 'elsewhere.md'), join(root, BUILD))
        expect(await stateOf(BUILD)).toBe('edited')
      })

      it('covers each routed coding agent, and none that the grid does not route', async () => {
        await manifest({ version: 4, agents: ['claude-code', 'codex', 'gemini-cli'] })
        const paths = (await states()).map((entry) => entry.path)
        expect(paths).toEqual(tierFiles(['claude-code', 'codex']).map(({ path }) => path))
        expect(paths.some((path) => path.startsWith('.codex/agents/'))).toBe(true)

        await manifest({ version: 4, agents: ['gemini-cli'] })
        expect(await states()).toEqual([])
        expect(await precondition()).toMatchObject({ status: 'skip' })
      })

      it('is skipped without a harness, and when the routing could not be read', async () => {
        await manifest()
        expect(await precondition()).toMatchObject({ status: 'skip', details: 'No managed harness' })
        await manifest({ version: 4, agents: ['claude-code'] })
        await mkdir(layer(), { recursive: true })
        await writeFile(localRoutingPath(layer()), '{ nope')
        expect(await precondition()).toMatchObject({ status: 'skip', details: 'The routing could not be read' })
      })

      it('gives the same facts to the JSON output', async () => {
        await manifest({ version: 4, agents: ['claude-code'] })
        await deposit(tierFiles().filter(({ path }) => path !== BUILD))
        const json = JSON.parse(await render(renderJson))
        expect(json.routing.tierAgents).toContainEqual({ path: BUILD, state: 'missing' })
        expect(json.preconditions.find((entry: { name: string }) => entry.name === 'tierAgents')).toMatchObject({ status: 'warn', details: `${BUILD} missing` })
      })
    })
  })
})
