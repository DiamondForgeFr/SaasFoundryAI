import { execFile } from 'child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileP = promisify(execFile)

const CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-tool-github-projects/github-projects-cli.sh')
const BASH = '/bin/bash'

/**
 * A sandbox whose `gh` logs every call. FAKE_ON_BOARD=<status> puts the issue on board 42 in
 * that status; FAKE_NO_BACKLOG removes the Backlog option from the board.
 */
async function buildSandbox(): Promise<{ dir: string; env: NodeJS.ProcessEnv; logPath: string; cleanup: () => Promise<void> }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-gh-add-to-project-'))
  const binDir = path.join(dir, 'bin')
  const cacheDir = path.join(dir, 'cache')
  const logPath = path.join(dir, 'gh-calls.log')
  await mkdir(binDir, { recursive: true })
  await mkdir(cacheDir, { recursive: true })
  await writeFile(path.join(dir, '.saasfoundry.json'), JSON.stringify({ workflow: { projectUrl: 'https://github.com/orgs/FakeOrg/projects/42', workingBranch: 'develop' } }))

  const shim = `#!/bin/bash
printf '%s\\n' "$*" >> '${logPath}'
case "$1 $2" in
  "repo view") echo "FakeOrg/FakeRepo" ;;
  "project view") echo '{"id":"PVT_FAKE"}' ;;
  "project field-list")
    if [ -n "$FAKE_NO_BACKLOG" ]; then
      echo '{"fields":[{"id":"PVTSSF_FAKE","name":"Status","options":[{"id":"opt_ip","name":"In progress"}]}]}'
    else
      echo '{"fields":[{"id":"PVTSSF_FAKE","name":"Status","options":[{"id":"opt_backlog","name":"Backlog"},{"id":"opt_ip","name":"In progress"}]}]}'
    fi ;;
  "project item-add") echo "PVTI_NEW" ;;
  "project item-edit") echo '{"id":"PVTI_NEW"}' ;;
  "issue view") echo "https://github.com/FakeOrg/FakeRepo/issues/7" ;;
  "api graphql")
    if [ -n "$FAKE_ON_BOARD" ]; then
      echo '{"data":{"repository":{"issue":{"title":"T","state":"OPEN","projectItems":{"nodes":[{"id":"PVTI_OLD","project":{"number":42},"fieldValueByName":{"name":"'"$FAKE_ON_BOARD"'"}}]}}}}}'
    else
      echo '{"data":{"repository":{"issue":{"title":"T","state":"OPEN","projectItems":{"nodes":[]}}}}}'
    fi ;;
  *) echo '{}' ;;
esac
`
  writeFileSync(path.join(binDir, 'gh'), shim)
  chmodSync(path.join(binDir, 'gh'), 0o755)
  return {
    dir,
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, SF_CACHE_DIR: cacheDir, PWD: dir },
    logPath,
    cleanup: () => rm(dir, { recursive: true, force: true })
  }
}

const calls = (logPath: string): string[] => {
  try {
    return readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
}

// #836 — spawned tickets joined their Epic and the milestone, never the board, so every
// later `update-status` on them failed with "not on project board".
describe('github-projects-cli.sh add-to-project', () => {
  let sandbox: Awaited<ReturnType<typeof buildSandbox>>

  beforeEach(async () => {
    sandbox = await buildSandbox()
  })

  afterEach(async () => {
    await sandbox.cleanup()
  })

  const run = async (args: string[], env: NodeJS.ProcessEnv = {}) => {
    try {
      const { stdout, stderr } = await execFileP(BASH, [CLI, 'add-to-project', ...args], { cwd: sandbox.dir, env: { ...sandbox.env, ...env } })
      return { stdout, stderr, code: 0 }
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; code?: number }
      return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
    }
  }

  it('adds an issue that is not on the board, in Backlog', async () => {
    const result = await run(['7'])

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('#7 added to project board 42 → Backlog')
    const log = calls(sandbox.logPath)
    expect(log).toContain('project item-add 42 --owner FakeOrg --url https://github.com/FakeOrg/FakeRepo/issues/7 --format json --jq .id')
    expect(log.find((call) => call.startsWith('project item-edit'))).toContain('--id PVTI_NEW --project-id PVT_FAKE --field-id PVTSSF_FAKE --single-select-option-id opt_backlog')
    // One targeted lookup, never a scan of the whole board
    expect(log.some((call) => call.startsWith('project item-list'))).toBe(false)
  })

  it('leaves an issue already on the board in its status', async () => {
    const result = await run(['7'], { FAKE_ON_BOARD: 'In progress' })

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('already on project board 42 (status kept)')
    const log = calls(sandbox.logPath)
    expect(log.some((call) => call.startsWith('project item-add') || call.startsWith('project item-edit'))).toBe(false)
  })

  it('takes another starting status', async () => {
    await expect(run(['7', '--status', 'In progress'])).resolves.toMatchObject({ code: 0 })
    expect(calls(sandbox.logPath).find((call) => call.startsWith('project item-edit'))).toContain('opt_ip')
  })

  it('adds nothing when the board has no such status', async () => {
    const result = await run(['7'], { FAKE_NO_BACKLOG: '1' })

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain("Unknown status 'Backlog'")
    expect(calls(sandbox.logPath).some((call) => call.startsWith('project item-add'))).toBe(false)
  })
})
