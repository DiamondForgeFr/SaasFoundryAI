import { execFileSync, spawnSync } from 'child_process'
import { mkdtemp, readFile, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const ROOT = resolve(__dirname, '../../..')
// A commit hook exports GIT_* variables: a fixture repository must never inherit them.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))

// #1106 — the command the PreToolUse hook of a host runs: the tool event on stdin, the deny decision on stdout,
// nothing to allow, and an exit code of 0 whatever happens.
describe('compiled sf agents guard', () => {
  let project: string
  const git = (...args: string[]) => execFileSync('git', args, { cwd: project, env: cleanEnv, stdio: 'pipe' })
  const guard = (host: string, input: string) => spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', 'guard', '--host', host], { cwd: project, encoding: 'utf8', env: cleanEnv, input })
  const event = (command: unknown, extra: Record<string, unknown> = {}, toolName = 'Bash') =>
    JSON.stringify({ session_id: 's1', hook_event_name: 'PreToolUse', cwd: project, tool_name: toolName, tool_input: { command }, tool_use_id: 'toolu_1', ...extra })

  beforeEach(async () => {
    project = await realpath(await mkdtemp(join(tmpdir(), 'sf-agents-guard-')))
    git('init', '-q', '-b', 'main')
  })
  afterEach(async () => rm(project, { recursive: true, force: true }))

  it('prints the deny decision of Claude Code for a bypass variable, and exits 0', () => {
    const result = guard('claude-code', event('SF_WORKFLOW_BYPASS_COMPLEXITY_GUARD=1 echo hi'))

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    const decision = JSON.parse(result.stdout)
    expect(decision).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: expect.stringContaining('Refused by the SaaSFoundry guard hook') }
    })
    expect(decision.hookSpecificOutput.permissionDecisionReason).toContain('SF_WORKFLOW_BYPASS_COMPLEXITY_GUARD')
    expect(result.stdout.trim().split('\n')).toHaveLength(1)
  })

  it('prints the same shape for Codex', () => {
    const result = guard('codex', event('SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog'))

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' })
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason).toContain('their own terminal')

    const label = guard('codex', event('gh issue edit 1 --add-label nature:internal'))
    expect(JSON.parse(label.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
  })

  it.each([
    ['claude-code', 'npm test'],
    ['claude-code', 'grep -rn SF_WORKFLOW_BYPASS_PUSHED_GUARD src'],
    ['claude-code', 'gh pr merge 12'],
    ['codex', 'ls -la']
  ])('prints nothing for an ordinary call, or one only a delegated agent may not make (%s: %s)', (host, command) => {
    const result = guard(host, event(command))

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  it('refuses a merge when the event carries an agent id, and when it runs in a worktree of an agent', () => {
    for (const extra of [{ agent_id: 'agent-a1', agent_type: 'sf-build' }, { cwd: join(project, '.claude', 'worktrees', 'agent-a1') }]) {
      const result = guard('claude-code', event('gh pr merge 12', extra))
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason).toContain('a delegated agent never merges')
    }
  })

  it('reads the argument vector of a shell tool, and the cmd of an exec_command', () => {
    const vector = guard('codex', event(['bash', '-lc', 'SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog'], {}, 'Bash'))
    expect(JSON.parse(vector.stdout).hookSpecificOutput.permissionDecision).toBe('deny')

    const exec = guard('codex', JSON.stringify({ hook_event_name: 'PreToolUse', cwd: project, tool_name: 'exec_command', tool_input: { cmd: 'SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog' } }))
    expect(JSON.parse(exec.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
  })

  it.each([
    ['a file edit', () => event('SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog', {}, 'Edit')],
    ['a tool event without a command', () => JSON.stringify({ hook_event_name: 'PreToolUse', cwd: project, tool_name: 'Bash', tool_input: {} })],
    ['an event without a tool', () => JSON.stringify({ hook_event_name: 'SessionStart', cwd: project })]
  ])('has no objection to %s', (_name, input) => {
    const result = guard('claude-code', input())

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })

  describe('a payload it cannot read', () => {
    const errorLog = () => join(project, '.git', 'saasfoundry', 'capture-errors.jsonl')

    it('lets the call through with an exit code of 0, and leaves a line in the capture error log', async () => {
      const result = guard('claude-code', 'this is not json, SF_WORKFLOW_BYPASS_NATURE_GUARD=1 secret')

      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('sf agents guard: the call was let through')
      expect(result.stderr).not.toContain('secret')
      const [line] = (await readFile(errorLog(), 'utf8')).trim().split('\n')
      expect(JSON.parse(line)).toMatchObject({ host: 'claude-code', event: 'PreToolUse', stage: 'payload', message: expect.stringContaining('not valid JSON') })
      expect(line).not.toContain('secret')
    })

    it('lets a payload that is not an object through', () => {
      const result = guard('codex', '"just a string"')

      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
    })

    it('lets a payload larger than 1 MiB through', () => {
      const result = guard('claude-code', event(`echo ${'x'.repeat(1024 * 1024 + 1)}`))

      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('larger than 1 MiB')
    })

    it('lets an empty payload through', async () => {
      const result = guard('claude-code', '')

      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
      await expect(readFile(errorLog(), 'utf8')).resolves.toContain('not valid JSON')
    })
  })

  it('exits 0 with a message for a host it does not know, and lists --host in its help', () => {
    const unknown = guard('nobody', event('gh pr merge 1', { agent_id: 'a' }))
    expect(unknown.status).toBe(0)
    expect(unknown.stdout).toBe('')
    expect(unknown.stderr).toContain('--host must be claude-code or codex')

    const help = spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', 'guard', '--help'], { cwd: project, encoding: 'utf8', env: cleanEnv })
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('--host')
  })
})
