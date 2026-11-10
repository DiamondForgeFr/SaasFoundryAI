import { spawnSync } from 'child_process'
import { mkdtemp, readFile, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const ROOT = resolve(__dirname, '../../..')
// A commit hook exports GIT_* variables: a fixture must never inherit them.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && key !== 'CLAUDE_PROJECT_DIR'))

interface HookGroup {
  matcher?: string
  hooks: { command: string; timeout?: number }[]
}

// #1106 — the exact line this repository's `.claude/settings.json` runs before a Bash call, fed the payloads a host
// sends: it must refuse the listed calls, stay silent on the ordinary ones, and never fail the host.
describe('the PreToolUse guard hook of .claude/settings.json, run through sh -c', () => {
  let command: string
  let worktree: string
  let empty: string

  const payload = (toolCommand: string, cwd: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ session_id: 's1', hook_event_name: 'PreToolUse', cwd, tool_name: 'Bash', tool_input: { command: toolCommand }, tool_use_id: 'toolu_1', ...extra })
  const hook = (input: string, env: NodeJS.ProcessEnv = { CLAUDE_PROJECT_DIR: ROOT }, cwd = ROOT) => spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8', input, env: { ...cleanEnv, ...env } })
  const decision = (stdout: string) => JSON.parse(stdout).hookSpecificOutput as { hookEventName: string; permissionDecision: string; permissionDecisionReason: string }

  beforeAll(async () => {
    const settings = JSON.parse(await readFile(join(ROOT, '.claude', 'settings.json'), 'utf8')) as { hooks: Record<string, HookGroup[]> }
    const groups = settings.hooks.PreToolUse ?? []
    const group = groups.find((entry) => entry.matcher === 'Bash|PowerShell')
    command = group?.hooks[0].command ?? ''
    expect(group?.hooks[0].timeout).toBe(10)
    expect(command).toContain('agents guard --host claude-code')
    worktree = join(await realpath(await mkdtemp(join(tmpdir(), 'sf-guard-hook-'))), '.claude', 'worktrees', 'agent-x')
    empty = await realpath(await mkdtemp(join(tmpdir(), 'sf-guard-hook-empty-')))
  })
  afterAll(async () => {
    await rm(join(worktree, '..', '..', '..'), { recursive: true, force: true })
    await rm(empty, { recursive: true, force: true })
  })

  it.each([
    ['a bypass variable', 'SF_WORKFLOW_BYPASS_COMPLEXITY_GUARD=1 echo hi', 'SF_WORKFLOW_BYPASS_COMPLEXITY_GUARD'],
    ['the skip flag of the local CI', '.claude/skills/sf-workflow/workflow-cli.sh update-status 1 "Human testing" --skip-local-ci x', '--skip-local-ci'],
    ['a nature label', 'gh issue edit 1 --add-label nature:internal', 'nature label'],
    ['a nature label in capitals', 'gh issue edit 1 --add-label NATURE:INTERNAL', 'nature label']
  ])('refuses %s from the repository root', (_name, toolCommand, quoted) => {
    const result = hook(payload(toolCommand, ROOT))

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(decision(result.stdout)).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: expect.stringContaining(quoted) })
  })

  it.each([
    ['gh pr merge 12'],
    ['.claude/skills/sf-workflow/workflow-cli.sh ready-pr 1106'],
    ['sf agents delegation allow'],
    ['.claude/skills/sf-tool-github-projects/github-projects-cli.sh create-ticket task T --nature internal']
  ])('refuses %s in a worktree of an agent, and allows it from a primary checkout', (toolCommand) => {
    const refused = hook(payload(toolCommand, worktree))
    expect(refused.status).toBe(0)
    expect(decision(refused.stdout).permissionDecision).toBe('deny')
    expect(decision(refused.stdout).permissionDecisionReason).toContain('a delegated agent never')

    // This spec may itself run in a worktree of an agent: the primary checkout is a directory that is none
    const allowed = hook(payload(toolCommand, empty))
    expect(allowed.status).toBe(0)
    expect(allowed.stdout).toBe('')
  })

  it('refuses a merge from a subagent whatever its directory', () => {
    const result = hook(payload('gh pr merge 12', ROOT, { agent_id: 'agent-a1', agent_type: 'sf-build' }))

    expect(decision(result.stdout).permissionDecision).toBe('deny')
  })

  it.each([
    ['npm test'],
    ['git status --short'],
    ['grep -rn SF_WORKFLOW_BYPASS_PUSHED_GUARD src'],
    ['grep -- --skip-local-ci notes.md'],
    ['gh issue edit 1 --add-label "complexity: low"'],
    ['gh pr ready 12 --undo']
  ])('stays silent on %s', (toolCommand) => {
    const result = hook(payload(toolCommand, worktree))

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  it('finds the CLI from the working directory when the host sets no project directory', () => {
    const result = hook(payload('SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog', ROOT), {}, ROOT)

    expect(decision(result.stdout).permissionDecision).toBe('deny')
  })

  it('fails open, with an exit code of 0 and no output, when no CLI can be found', () => {
    const result = hook(payload('SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog', empty), { CLAUDE_PROJECT_DIR: empty, PATH: '/usr/bin:/bin' }, empty)

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })

  it('lets a payload that is not JSON through, whatever it says', () => {
    // From a directory outside any Git checkout: the failure is logged in the Git directory of the clone it runs in
    const result = hook('SF_WORKFLOW_BYPASS_NATURE_GUARD=1 not json', { CLAUDE_PROJECT_DIR: ROOT }, empty)

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })
})
