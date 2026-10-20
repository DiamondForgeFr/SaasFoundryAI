import { execFile } from 'child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

import { CLAUDE_CAPTURE_HOOKS } from '../../../harness/delegation-hooks'
import { emptyLocalRouting, localRoutingPath, updateLocalRouting } from '../../../harness/routing-local'
import { collectStatus, type StatusRouting } from '../../../status/collect'
import { evaluatePreconditions } from '../../../status/preconditions'
import { renderAgentFriendly, renderHuman, renderJson, routingSummary } from '../../../status/render'

const exec = promisify(execFile)
// A commit hook exports GIT_* variables: a fixture repository must never inherit them.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
const AT = '2026-10-20T08:00:00.000Z'
const move = { kind: 'multi-file-feature', provider: 'claude-code', tier: 'fix', from: 'build', action: 'escalate', at: AT }

describe('the automatic routing in sf status (#1035)', () => {
  describe('routingSummary', () => {
    const enforced = { agent: 'claude-code', state: 'enforced' as const }

    it('says the routing is the shared one while nothing moved, and that capture is enforced', () => {
      expect(routingSummary({ adjustment: 'on', adjustments: [], capture: [enforced] })).toBe('shipped grid and shared overrides, no local adjustment; claude-code capture enforced')
    })

    it('names the moves nobody promoted yet, with the kind, the tier, the agent and the day', () => {
      const summary = routingSummary({ adjustment: 'on', adjustments: [move, { ...move, kind: 'prose', provider: 'codex', tier: 'edit', from: 'light', action: 'deescalate' }], capture: [enforced] })
      expect(summary).toContain('2 local automatic adjustments not promoted (multi-file-feature → fix for claude-code, escalate on 2026-10-20; prose → edit for codex, deescalate on 2026-10-20;')
      expect(summary).toContain('sf agents routing report, promote or reset')
      expect(routingSummary({ adjustment: 'on', adjustments: [move], capture: [enforced] })).toContain('1 local automatic adjustment not promoted')
    })

    it('says what is missing when the hooks are not in place, and what to do instead for a host without hooks', () => {
      const summary = routingSummary({
        adjustment: 'on',
        adjustments: [],
        capture: [
          { agent: 'codex', state: 'missing' },
          { agent: 'gemini-cli', state: 'not-enforced' }
        ]
      })
      expect(summary).toContain('codex capture hook missing (run sf agents refresh --scope shared)')
      expect(summary).toContain('gemini-cli capture not enforced (record its delegations with sf agents outcome record)')
    })

    it('says when the automatic adjustment is off, and never raises on an unreadable layer', () => {
      expect(routingSummary({ adjustment: 'off', adjustments: [], capture: [enforced] })).toContain('automatic adjustment off')
      expect(routingSummary({ error: 'Invalid local routing in x' })).toBe('unreadable (Invalid local routing in x)')
    })
  })

  describe('the status of a project', () => {
    let root: string
    const manifest = (harness?: Record<string, unknown>) =>
      writeFile(
        join(root, '.saasfoundry.json'),
        JSON.stringify({ version: '1.0.0-beta', projectName: 'status-demo', structure: 'cli', generatedAt: AT, ...(harness ? { modules: { harness } } : {}) }, null, 2) + '\n'
      )
    const layer = () => join(root, '.git', 'saasfoundry')
    const report = async () => collectStatus(root, { checkNetwork: false })
    const render = async (renderer: typeof renderAgentFriendly) => {
      const status = await report()
      return renderer({ report: status, preconditions: evaluatePreconditions(status) })
    }

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
        adjustment: 'on',
        adjustments: [],
        capture: [
          { agent: 'claude-code', state: 'missing' },
          { agent: 'codex', state: 'missing' }
        ]
      })
      expect(await render(renderAgentFriendly)).toContain(
        '- routing: shipped grid and shared overrides, no local adjustment; claude-code capture hook missing (run sf agents refresh --scope shared); codex capture hook missing'
      )
    })

    it('shows the local moves and the enforced capture in the three outputs', async () => {
      await manifest({ version: 4, agents: ['claude-code'] })
      await mkdir(join(root, '.claude'), { recursive: true })
      await writeFile(join(root, '.claude', 'settings.json'), JSON.stringify({ hooks: CLAUDE_CAPTURE_HOOKS }))
      await updateLocalRouting(layer(), () => ({
        next: { ...emptyLocalRouting(), kinds: { 'multi-file-feature': { 'claude-code': { tier: 'fix', from: 'build', action: 'escalate', at: AT, evidence: {} as never } } } },
        result: null
      }))
      const routing = (await report()).routing as StatusRouting
      expect(routing).toEqual({ adjustment: 'on', adjustments: [{ ...move }], capture: [{ agent: 'claude-code', state: 'enforced' }] })
      expect(await render(renderAgentFriendly)).toContain('- routing: 1 local automatic adjustment not promoted (multi-file-feature → fix for claude-code, escalate on 2026-10-20')
      expect(await render(renderHuman)).toMatch(/Routing:.*1 local automatic adjustment not promoted/)
      expect(JSON.parse(await render(renderJson)).routing).toEqual(routing)
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
        expect((await collectStatus(elsewhere, { checkNetwork: false })).routing).toMatchObject({ adjustments: [] })
      } finally {
        await rm(elsewhere, { recursive: true, force: true })
      }
    })
  })
})
