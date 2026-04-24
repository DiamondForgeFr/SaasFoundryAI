import { execFile } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

const CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-tool-github-projects/github-projects-cli.sh')
const BASH = '/bin/bash'

async function buildSandbox(): Promise<{ dir: string; env: NodeJS.ProcessEnv; tracePath: string; cleanup: () => Promise<void> }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-gh-type-flag-'))
  const binDir = path.join(dir, 'bin')
  await mkdir(binDir, { recursive: true })
  const tracePath = path.join(dir, 'gh-trace.txt')

  await writeFile(
    path.join(dir, '.saasfoundry.json'),
    JSON.stringify({
      workflow: { projectUrl: 'https://github.com/orgs/FakeOrg/projects/42', workingBranch: 'develop' }
    })
  )

  // Shim that records the exact --body passed to `gh issue create` so tests
  // can assert on the skeleton text the CLI built.
  const shim = `#!/bin/bash
case "$1" in
  issue)
    case "$2" in
      view)
        echo '{"id":"I_FAKE","url":"https://github.com/FakeOrg/FakeRepo/issues/42"}'
        ;;
      create)
        shift 2
        # Walk the remaining args, capture --body value
        body=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --body)
              body=$2
              shift 2
              ;;
            --body=*)
              body=\${1#--body=}
              shift
              ;;
            *)
              shift
              ;;
          esac
        done
        printf '%s' "$body" > "${tracePath}"
        echo "https://github.com/FakeOrg/FakeRepo/issues/999"
        ;;
      *)
        echo '{}'
        ;;
    esac
    ;;
  api)
    echo '{"data":{"addSubIssue":{"issue":{"number":42,"title":"p"},"subIssue":{"number":999,"title":"c"}}}}'
    ;;
  *)
    echo '{}'
    ;;
esac
`
  const shimPath = path.join(binDir, 'gh')
  writeFileSync(shimPath, shim)
  chmodSync(shimPath, 0o755)

  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH}`,
    PWD: dir
  }

  return { dir, env, tracePath, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

async function runCli(args: string[], sandbox: { dir: string; env: NodeJS.ProcessEnv }): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileP(BASH, [CLI, ...args], { cwd: sandbox.dir, env: sandbox.env })
    return { stdout, stderr, code: 0 }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: typeof e.code === 'number' ? e.code : 1 }
  }
}

describe('sf-tool-github-projects — create-subtask --type flag', () => {
  let sandbox: Awaited<ReturnType<typeof buildSandbox>>

  beforeEach(async () => {
    sandbox = await buildSandbox()
  })

  afterEach(async () => {
    await sandbox.cleanup()
  })

  it('defaults to story skeleton when --type is omitted', async () => {
    const res = await runCli(['create-subtask', '42', 'Login endpoint'], sandbox)
    expect(res.code).toBe(0)
    const body = readFileSync(sandbox.tracePath, 'utf8')
    expect(body).toContain('## Objective')
    expect(body).toContain('Implement Login endpoint.')
    expect(body).toContain('## Acceptance Criteria')
    expect(body).toContain('## Design References')
  })

  it('--type epic produces an epic-shaped body with Goal and Definition of Done sections', async () => {
    const res = await runCli(['create-subtask', '42', 'User authentication', '--type', 'epic'], sandbox)
    expect(res.code).toBe(0)
    const body = readFileSync(sandbox.tracePath, 'utf8')
    expect(body).toContain('## Goal')
    expect(body).toContain('User authentication')
    expect(body).toContain('## Business Value')
    expect(body).toContain('## Dates')
    expect(body).toContain('## Definition of Done')
    expect(body).not.toContain('## Acceptance Criteria')
  })

  it('--type task produces a task-shaped body with Completion Criteria', async () => {
    const res = await runCli(['create-subtask', '42', 'Migrate auth middleware', '--type', 'task'], sandbox)
    expect(res.code).toBe(0)
    const body = readFileSync(sandbox.tracePath, 'utf8')
    expect(body).toContain('## Objective')
    expect(body).toContain('Deliver Migrate auth middleware.')
    expect(body).toContain('## Completion Criteria')
    expect(body).not.toContain('## Acceptance Criteria')
    expect(body).not.toContain('## Design References')
  })

  it('--type issue produces an issue-shaped body with Behavior observed section', async () => {
    const res = await runCli(['create-subtask', '42', 'Login returns 500 on empty password', '--type', 'issue'], sandbox)
    expect(res.code).toBe(0)
    const body = readFileSync(sandbox.tracePath, 'utf8')
    expect(body).toContain('## Behavior observed')
    expect(body).toContain('## Expected Behavior')
    expect(body).toContain('## Steps to Reproduce / Trigger Conditions')
    expect(body).toContain('## Impact / Severity')
    expect(body).toContain('## Evidence / Data')
    expect(body).not.toContain('## Objective')
  })

  it('supports --type=<value> attached-value syntax', async () => {
    const res = await runCli(['create-subtask', '42', 'Thing', '--type=task'], sandbox)
    expect(res.code).toBe(0)
    const body = readFileSync(sandbox.tracePath, 'utf8')
    expect(body).toContain('## Completion Criteria')
  })

  it('rejects unknown --type value with exit code 1', async () => {
    const res = await runCli(['create-subtask', '42', 'Thing', '--type', 'saga'], sandbox)
    expect(res.code).toBe(1)
    expect(res.stderr).toMatch(/--type must be one of/)
    expect(res.stderr).toMatch(/'saga'/)
  })

  it('rejects --type with no value (exit 1)', async () => {
    const res = await runCli(['create-subtask', '42', 'Thing', '--type'], sandbox)
    expect(res.code).toBe(1)
    expect(res.stderr).toMatch(/--type requires a value/)
  })

  it('rejects --type followed by another flag instead of a value (exit 1)', async () => {
    const res = await runCli(['create-subtask', '42', 'Thing', '--type', '--bypass-srs', 'x'], sandbox)
    expect(res.code).toBe(1)
    expect(res.stderr).toMatch(/--type requires a value/)
  })

  it('explicit body arg wins over --type skeleton', async () => {
    const res = await runCli(['create-subtask', '42', 'Thing', 'Custom body text', '--type', 'task'], sandbox)
    expect(res.code).toBe(0)
    const body = readFileSync(sandbox.tracePath, 'utf8')
    expect(body).toBe('Custom body text')
  })

  it('--type composes cleanly with --bypass-srs', async () => {
    const res = await runCli(['create-subtask', '42', 'Meta tooling', '--type', 'task', '--bypass-srs', 'meta'], sandbox)
    expect(res.code).toBe(0)
    const body = readFileSync(sandbox.tracePath, 'utf8')
    expect(body).toContain('## Completion Criteria')
    expect(res.stdout).toMatch(/bypassing rule 8/)
  })
})
