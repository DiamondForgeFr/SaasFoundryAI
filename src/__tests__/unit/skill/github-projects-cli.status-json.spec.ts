import { execFile } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

// Regression guard for PR #283 (Story #279): the `status --json` mode is the
// machine-readable interface that `workflow-cli.sh get_current_status` now
// parses via jq instead of grep/awk. If the JSON shape drifts, the workflow
// skill silently breaks — so we pin the contract here (ticket/title/state/
// status/labels) and the flag-order behavior (the reviewer of PR #283 claimed
// `status <n> --json` would lose the ticket number; proving them wrong is part
// of the contract).
const CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-tool-github-projects/github-projects-cli.sh')
const BASH = '/bin/bash'

async function buildSandbox(): Promise<{ dir: string; env: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-gh-status-json-'))
  const binDir = path.join(dir, 'bin')
  await mkdir(binDir, { recursive: true })

  await writeFile(
    path.join(dir, '.saasfoundry.json'),
    JSON.stringify({
      workflow: { projectUrl: 'https://github.com/orgs/FakeOrg/projects/42', workingBranch: 'develop' }
    })
  )

  // gh shim:
  //  - `repo view --json nameWithOwner --jq '.nameWithOwner'` → FakeOrg/FakeRepo
  //  - `api graphql ...` → issue #277 found on project 42 with status "In progress";
  //    issue #999 returns null (not-found path).
  //  - `issue view <n> --json labels --jq '[.labels[].name]'` → array of labels
  const shim = `#!/bin/bash
case "$1" in
  repo)
    # gh repo view --json nameWithOwner --jq '.nameWithOwner'
    echo "FakeOrg/FakeRepo"
    ;;
  api)
    # Only graphql is used here. Grab the -F "n=<ticket>" arg to decide which
    # issue to emulate.
    ticket=""
    while [ $# -gt 0 ]; do
      case "$1" in
        -F)
          case "$2" in
            n=*) ticket=\${2#n=} ;;
          esac
          shift 2
          ;;
        *) shift ;;
      esac
    done
    if [ "$ticket" = "999" ]; then
      echo '{"data":{"repository":{"issue":null}}}'
    else
      cat <<EOF
{"data":{"repository":{"issue":{"title":"Sample ticket","state":"OPEN","projectItems":{"nodes":[{"id":"PVTI_ABC","project":{"number":42},"fieldValueByName":{"name":"In progress"}}]}}}}}
EOF
    fi
    ;;
  issue)
    # gh issue view <num> --json labels --jq '[.labels[].name]'
    case "$2" in
      view)
        echo '["bug","priority:high"]'
        ;;
      *) echo '{}' ;;
    esac
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

  return { dir, env, cleanup: () => rm(dir, { recursive: true, force: true }) }
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

describe('sf-tool-github-projects — status --json contract', () => {
  let sandbox: Awaited<ReturnType<typeof buildSandbox>>

  beforeEach(async () => {
    sandbox = await buildSandbox()
  })

  afterEach(async () => {
    await sandbox.cleanup()
  })

  it('returns the documented JSON shape with --json after the ticket', async () => {
    const res = await runCli(['status', '277', '--json'], sandbox)
    expect(res.code).toBe(0)
    const payload = JSON.parse(res.stdout)
    expect(payload).toEqual({
      ticket: 277,
      title: 'Sample ticket',
      state: 'OPEN',
      status: 'In progress',
      labels: ['bug', 'priority:high']
    })
  })

  it('returns the same shape with --json before the ticket (flag-order independence)', async () => {
    const res = await runCli(['status', '--json', '277'], sandbox)
    expect(res.code).toBe(0)
    const payload = JSON.parse(res.stdout)
    expect(payload.ticket).toBe(277)
    expect(payload.title).toBe('Sample ticket')
    expect(payload.status).toBe('In progress')
  })

  it('emits not-found error JSON with exit code 1 when the issue does not resolve', async () => {
    const res = await runCli(['status', '999', '--json'], sandbox)
    expect(res.code).toBe(1)
    const payload = JSON.parse(res.stdout)
    expect(payload).toEqual({
      ticket: 999,
      title: '',
      state: '',
      status: '',
      labels: [],
      error: 'not-found'
    })
  })

  it('falls back to human-readable output when --json is omitted', async () => {
    const res = await runCli(['status', '277'], sandbox)
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('Issue #277: Sample ticket')
    expect(res.stdout).toContain('State: OPEN')
    expect(res.stdout).toContain('Status: In progress')
  })

  it('exits 1 with usage message when no ticket is provided', async () => {
    const res = await runCli(['status', '--json'], sandbox)
    expect(res.code).toBe(1)
    expect(res.stderr).toMatch(/Usage: .* status <ticket-number> \[--json\]/)
  })
})
