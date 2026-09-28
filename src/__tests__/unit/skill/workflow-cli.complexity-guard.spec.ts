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

async function buildSandbox(): Promise<{
  dir: string
  env: NodeJS.ProcessEnv
  toolLogPath: string
  cleanup: () => Promise<void>
}> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-wfcli-cplx-'))
  const toolDir = path.join(dir, '.claude/skills/sf-tool-github-projects')
  const toolLogPath = path.join(dir, 'tool-calls.log')
  await mkdir(toolDir, { recursive: true })

  await writeFile(
    path.join(dir, '.saasfoundry.json'),
    JSON.stringify({
      workflow: {
        tool: 'github-projects',
        projectUrl: 'https://github.com/orgs/FakeOrg/projects/42',
        workingBranch: 'develop'
      }
    })
  )

  const toolShim = `#!/bin/bash
printf '%s\\n' "$*" >> '${toolLogPath}'
case "$1" in
  get-labels)
    if [ "\${FAKE_LABELS_ERROR:-}" = "1" ]; then
      echo "fake-tool-cli: simulated get-labels failure" >&2
      exit 1
    fi
    if [ -n "\${FAKE_LABELS:-}" ]; then
      printf '%s\\n' "\${FAKE_LABELS}"
    fi
    ;;
  update-status)
    echo "✓ Ticket #$2 → $3"
    ;;
  *)
    echo "fake-tool-cli: unhandled $*" >&2
    exit 0
    ;;
esac
`
  const toolPath = path.join(toolDir, 'github-projects-cli.sh')
  writeFileSync(toolPath, toolShim)
  chmodSync(toolPath, 0o755)

  const env: NodeJS.ProcessEnv = { ...process.env, PWD: dir }
  return { dir, env, toolLogPath, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

async function runCli(args: string[], sandbox: { dir: string; env: NodeJS.ProcessEnv }, envOverrides: NodeJS.ProcessEnv = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileP(BASH, [CLI, ...args], {
      cwd: sandbox.dir,
      env: { ...sandbox.env, ...envOverrides }
    })
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

describe('sf-workflow CLI — complexity guard', () => {
  let sandbox: Awaited<ReturnType<typeof buildSandbox>>

  beforeEach(async () => {
    sandbox = await buildSandbox()
  })

  afterEach(async () => {
    await sandbox.cleanup()
  })

  it('blocks "Ready" when no complexity label is set', async () => {
    const res = await runCli(['update-status', '42', 'Ready'], sandbox, { FAKE_LABELS: '' })
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('no complexity label')
    expect(res.stderr).toContain('bug | low | medium | complex')
    const toolCalls = readLog(sandbox.toolLogPath).filter((l) => l.startsWith('update-status'))
    expect(toolCalls).toEqual([])
  })

  it('blocks "In progress" when only a non-complexity label is set', async () => {
    const res = await runCli(['update-status', '42', 'In progress'], sandbox, { FAKE_LABELS: 'bug' })
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('no complexity label')
  })

  it.each(['AI testing', 'Human testing', 'In review', 'Done'])('blocks "%s" when no complexity label is set', async (target) => {
    const res = await runCli(['update-status', '42', target], sandbox, { FAKE_LABELS: '' })
    expect(res.code).toBe(2)
  })

  it('allows "Backlog" transitions even without a complexity label (moving back is always allowed)', async () => {
    const res = await runCli(['update-status', '42', 'Backlog'], sandbox, { FAKE_LABELS: '' })
    expect(res.code).toBe(0)
    const toolCalls = readLog(sandbox.toolLogPath).filter((l) => l.startsWith('update-status'))
    expect(toolCalls).toHaveLength(1)
  })

  it.each(['bug', 'low', 'medium', 'complex'])('allows "Ready" when complexity: %s is set', async (level) => {
    const res = await runCli(['update-status', '42', 'Ready'], sandbox, { FAKE_LABELS: `complexity: ${level}` })
    expect(res.code).toBe(0)
    const toolCalls = readLog(sandbox.toolLogPath).filter((l) => l.startsWith('update-status'))
    expect(toolCalls).toHaveLength(1)
  })

  it('bypasses the guard when SF_WORKFLOW_BYPASS_COMPLEXITY_GUARD=1', async () => {
    const res = await runCli(['update-status', '42', 'Ready'], sandbox, {
      FAKE_LABELS: '',
      SF_WORKFLOW_BYPASS_COMPLEXITY_GUARD: '1'
    })
    expect(res.code).toBe(0)
    const toolCalls = readLog(sandbox.toolLogPath).filter((l) => l.startsWith('update-status'))
    expect(toolCalls).toHaveLength(1)
  })

  it('fails open when the tool CLI errors on get-labels (offline / auth issue)', async () => {
    const res = await runCli(['update-status', '42', 'Ready'], sandbox, { FAKE_LABELS_ERROR: '1' })
    expect(res.code).toBe(0)
    const toolCalls = readLog(sandbox.toolLogPath).filter((l) => l.startsWith('update-status'))
    expect(toolCalls).toHaveLength(1)
  })

  it('coexists with the SRS guard — SRS-labelled ticket with complexity still blocked on code-path targets', async () => {
    const res = await runCli(['update-status', '42', 'AI testing'], sandbox, { FAKE_LABELS: 'srs:drafting\ncomplexity: low' })
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('srs:drafting')
  })
})
