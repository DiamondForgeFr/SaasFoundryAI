import { execFile } from 'child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileP = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const CLI = path.resolve(REPO_ROOT, '.claude/skills/sf-workflow/workflow-cli.sh')
const BASH = '/bin/bash'

// The local CI guard (#1104): `update-status <ticket> "Human testing"` refuses a ticket whose draft pull request
// head lacks the project's required local CI statuses. The guard owns no knowledge of which statuses those are: it
// calls the tool's `local-ci-gate` on the one pull request the PR-existence guard matched. These tests pin what the
// workflow script does around that call, with a tool shim that records its calls and answers the gate.

const DRAFT_PR = '[{"number":555,"isDraft":true,"headRefName":"feature/42-add-stuff","baseRefName":"develop"}]'
const READY_PR = '[{"number":555,"isDraft":false,"headRefName":"feature/42-add-stuff","baseRefName":"develop"}]'

interface SandboxOptions {
  tool?: 'github-projects' | 'jira'
  natureLabel?: 'internal' | 'user-facing' | null
}

async function buildSandbox(prListPayload: string, options: SandboxOptions = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-wfcli-localci-'))
  const tool = options.tool ?? 'github-projects'
  const toolDir = path.join(dir, `.claude/skills/sf-tool-${tool}`)
  const binDir = path.join(dir, 'bin')
  const toolLogPath = path.join(dir, 'tool-calls.log')
  await mkdir(toolDir, { recursive: true })
  await mkdir(binDir, { recursive: true })

  await writeFile(
    path.join(dir, '.saasfoundry.json'),
    JSON.stringify({
      workflow: {
        tool,
        projectUrl: 'https://github.com/orgs/FakeOrg/projects/42',
        workingBranch: 'develop',
        prTargetBranch: 'develop',
        releaseBranch: 'master',
        branchNaming: { feature: 'feature/{N}-{description}', fix: 'fix/{N}-{description}', release: 'rc-{version}' }
      }
    })
  )

  const labels = ['complexity: low', ...(options.natureLabel ? [`nature:${options.natureLabel}`] : [])]
  const labelsBlock = labels.map((l) => `printf '%s\\n' '${l}'`).join('\n    ')
  const toolShim = `#!/bin/bash
printf '%s\\n' "$*" >> '${toolLogPath}'
case "$1" in
  get-labels)
    ${labelsBlock}
    ;;
  list-incomplete-children) printf '%s' '[]' ;;
  get-parent) printf '%s' '{"number":7}' ;;
  get-issue-type) printf '%s' '{"name":"sf-task"}' ;;
  local-ci-gate)
    if [ "$GATE_EXIT" != 0 ] && [ -n "$GATE_EXIT" ]; then echo "tool: local CI is not green on abc" >&2; exit "$GATE_EXIT"; fi
    echo "tool: local CI green"
    ;;
  update-status) echo "✓ Ticket #$2 → $3" ;;
  *) exit 0 ;;
esac
`
  const toolPath = path.join(toolDir, `${tool}-cli.sh`)
  writeFileSync(toolPath, toolShim)
  chmodSync(toolPath, 0o755)

  const escaped = prListPayload.replace(/'/g, "'\\''")
  const ghShim = `#!/bin/bash
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then printf '%s' '${escaped}'; exit 0; fi
exit 0
`
  const ghPath = path.join(binDir, 'gh')
  writeFileSync(ghPath, ghShim)
  chmodSync(ghPath, 0o755)

  const env: NodeJS.ProcessEnv = { ...process.env, PWD: dir, PATH: `${binDir}:${process.env.PATH ?? ''}` }
  return { dir, env, toolLogPath, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

async function runCli(args: string[], sandbox: { dir: string; env: NodeJS.ProcessEnv }, envOverrides: NodeJS.ProcessEnv = {}) {
  try {
    const { stdout, stderr } = await execFileP(BASH, [CLI, ...args], { cwd: sandbox.dir, env: { ...sandbox.env, ...envOverrides } })
    return { stdout, stderr, code: 0 }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: typeof e.code === 'number' ? e.code : 1 }
  }
}

function readLog(logPath: string): string[] {
  try {
    return readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
}

describe('sf-workflow CLI — local CI guard (→ Human testing)', () => {
  let sandbox: Awaited<ReturnType<typeof buildSandbox>>

  afterEach(async () => {
    if (sandbox) await sandbox.cleanup()
  })

  const gateCalls = () => readLog(sandbox.toolLogPath).filter((l) => l.startsWith('local-ci-gate'))
  const statusCalls = () => readLog(sandbox.toolLogPath).filter((l) => l.startsWith('update-status'))

  it('checks the local CI on the one pull request the existence guard matched, then routes the transition', async () => {
    sandbox = await buildSandbox(DRAFT_PR)
    const res = await runCli(['update-status', '42', 'Human testing'], sandbox, { GATE_EXIT: '0' })
    expect(res.code).toBe(0)
    expect(gateCalls()).toEqual(['local-ci-gate 42 --pr 555'])
    expect(statusCalls()).toEqual(['update-status 42 Human testing'])
    expect(readLog(sandbox.toolLogPath).findIndex((l) => l.startsWith('local-ci-gate'))).toBeLessThan(readLog(sandbox.toolLogPath).findIndex((l) => l.startsWith('update-status')))
  })

  it('refuses with exit 2 when the gate is not green, moves nothing and sends the agent to the developer', async () => {
    sandbox = await buildSandbox(DRAFT_PR)
    const res = await runCli(['update-status', '42', 'Human testing'], sandbox, { GATE_EXIT: '1' })
    expect(res.code).toBe(2)
    expect(res.stderr).toContain("cannot enter 'Human testing'")
    expect(res.stderr).toContain('local CI is not green')
    expect(res.stderr).not.toContain('--skip-local-ci')
    expect(res.stderr).toContain('ask the developer')
    expect(statusCalls()).toEqual([])
  })

  describe('--skip-local-ci', () => {
    it.each([
      [['update-status', '42', 'Human testing', '--skip-local-ci', 'runner offline, suite green by hand']],
      [['update-status', '42', '--skip-local-ci', 'runner offline, suite green by hand', 'Human testing']]
    ])('is passed to the gate, never to the tool update-status: %j', async (args) => {
      sandbox = await buildSandbox(DRAFT_PR)
      const res = await runCli(args, sandbox, { GATE_EXIT: '0' })
      expect(res.code).toBe(0)
      expect(gateCalls()).toEqual(['local-ci-gate 42 --pr 555 --skip-local-ci runner offline, suite green by hand'])
      expect(statusCalls()).toEqual(['update-status 42 Human testing'])
    })

    it('needs a reason', async () => {
      sandbox = await buildSandbox(DRAFT_PR)
      const res = await runCli(['update-status', '42', 'Human testing', '--skip-local-ci'], sandbox)
      expect(res.code).toBe(1)
      expect(res.stderr).toContain('--skip-local-ci requires a reason')
      expect(statusCalls()).toEqual([])
    })

    it('is ignored, with a warning, for a move that is not Human testing', async () => {
      sandbox = await buildSandbox(READY_PR, { natureLabel: 'internal' })
      const res = await runCli(['update-status', '42', 'In review', '--skip-local-ci', 'not applicable'], sandbox)
      expect(res.code).toBe(0)
      expect(res.stderr).toContain('--skip-local-ci only applies to a move to Human testing')
      expect(gateCalls()).toEqual([])
      expect(statusCalls()).toEqual(['update-status 42 In review'])
    })

    it('records the skip on the ticket when the PR existence guard was bypassed and no pull request can carry it', async () => {
      sandbox = await buildSandbox('[]')
      const res = await runCli(['update-status', '42', 'Human testing', '--skip-local-ci', 'PR opened from a renamed branch'], sandbox, {
        SF_WORKFLOW_BYPASS_PR_EXISTENCE_GUARD: '1',
        GATE_EXIT: '1'
      })
      expect(res.code).toBe(0)
      expect(res.stderr).toContain('the skip is recorded on the ticket')
      // one comment announces the bypassed existence guard, the second records the skip
      expect(readLog(sandbox.toolLogPath).filter((l) => l.startsWith('comment 42'))).toHaveLength(2)
      expect(statusCalls()).toEqual(['update-status 42 Human testing'])
    })

    it('does not skip silently when the PR existence guard was bypassed and the gate cannot find a pull request', async () => {
      sandbox = await buildSandbox('[]')
      const res = await runCli(['update-status', '42', 'Human testing'], sandbox, { SF_WORKFLOW_BYPASS_PR_EXISTENCE_GUARD: '1', GATE_EXIT: '1' })
      expect(res.code).toBe(2)
      expect(gateCalls()).toEqual(['local-ci-gate 42'])
      expect(statusCalls()).toEqual([])
    })
  })

  describe('where the guard does not apply', () => {
    it.each(['In review', 'In progress'])('does not call the gate for a move to %s', async (target) => {
      sandbox = await buildSandbox(READY_PR, { natureLabel: 'internal' })
      const res = await runCli(['update-status', '42', target], sandbox, { GATE_EXIT: '1' })
      expect(res.code).toBe(0)
      expect(gateCalls()).toEqual([])
    })

    it('comes after the PR existence guard: a ticket with no pull request is refused for that reason first', async () => {
      sandbox = await buildSandbox('[]')
      const res = await runCli(['update-status', '42', 'Human testing'], sandbox, { GATE_EXIT: '1' })
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('has no open PR')
      expect(gateCalls()).toEqual([])
    })

    it('says the gate is not available for a tool without pull request commands, and routes the transition', async () => {
      sandbox = await buildSandbox(DRAFT_PR, { tool: 'jira' })
      const res = await runCli(['update-status', '42', 'Human testing'], sandbox)
      expect(res.code).toBe(0)
      expect(res.stderr).toContain('local CI gate is not available for jira')
      expect(gateCalls()).toEqual([])
      expect(statusCalls()).toEqual(['update-status 42 Human testing'])
    })
  })

  it('lists the command and the hatch in the help', async () => {
    sandbox = await buildSandbox(DRAFT_PR)
    const res = await runCli([], sandbox)
    expect(res.stdout + res.stderr).toContain('--skip-local-ci')
    expect(res.stdout + res.stderr).toContain('local-ci-gate')
  })

  it('exposes local-ci-gate through the workflow script', async () => {
    sandbox = await buildSandbox(DRAFT_PR)
    const res = await runCli(['local-ci-gate', '42', '--pr', '555'], sandbox, { GATE_EXIT: '0' })
    expect(res.code).toBe(0)
    expect(gateCalls()).toEqual(['local-ci-gate 42 --pr 555'])
  })
})
