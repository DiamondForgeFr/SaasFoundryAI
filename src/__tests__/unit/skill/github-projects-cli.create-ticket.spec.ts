import { execFile } from 'child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileP = promisify(execFile)

const CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-tool-github-projects/github-projects-cli.sh')
const WORKFLOW_CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-workflow/workflow-cli.sh')
const BASH = '/bin/bash'

/**
 * A sandbox whose `gh` logs every call and knows one board (42, Backlog / In progress),
 * one milestone (v1.0.1) and creates issue 12. FAKE_CREATE_FAILS makes `issue create` fail.
 */
async function buildSandbox(manifest: object = {}): Promise<{ dir: string; env: NodeJS.ProcessEnv; logPath: string; cleanup: () => Promise<void> }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-gh-create-ticket-'))
  const binDir = path.join(dir, 'bin')
  const cacheDir = path.join(dir, 'cache')
  const logPath = path.join(dir, 'gh-calls.log')
  await mkdir(binDir, { recursive: true })
  await mkdir(cacheDir, { recursive: true })
  await writeFile(
    path.join(dir, '.saasfoundry.json'),
    JSON.stringify({ workflow: { tool: 'github-projects', projectUrl: 'https://github.com/orgs/FakeOrg/projects/42', workingBranch: 'develop' }, ...manifest })
  )

  const shim = `#!/bin/bash
printf '%s\\n' "$*" >> '${logPath}'
case "$1 $2" in
  "repo view") echo "FakeOrg/FakeRepo" ;;
  "project view") echo '{"id":"PVT_FAKE"}' ;;
  "project field-list") echo '{"fields":[{"id":"PVTSSF_FAKE","name":"Status","options":[{"id":"opt_backlog","name":"Backlog"},{"id":"opt_ip","name":"In progress"}]}]}' ;;
  "project item-add") echo "PVTI_NEW" ;;
  "project item-edit") echo '{"id":"PVTI_NEW"}' ;;
  "issue create")
    [ -n "$FAKE_CREATE_FAILS" ] && exit 1
    echo "https://github.com/FakeOrg/FakeRepo/issues/12" ;;
  "issue view")
    case "$*" in
      *labels*) echo "" ;;
      *) echo "https://github.com/FakeOrg/FakeRepo/issues/12" ;;
    esac ;;
  "issue edit") echo "https://github.com/FakeOrg/FakeRepo/issues/12" ;;
  "api graphql") echo '{"data":{"repository":{"issue":{"title":"T","state":"OPEN","projectItems":{"nodes":[]}}}}}' ;;
  "api repos/FakeOrg/FakeRepo/milestones?state=all&per_page=100") echo '[{"number":3,"title":"v1.0.1"}]' ;;
  # The milestone PATCH, already through its --jq: the issue and milestone GitHub confirms
  "api repos/FakeOrg/FakeRepo/issues/12") echo "12 3" ;;
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

// #832 — the first ticket of a project had no guarded path: `gh issue create`, then the
// board, the type and the labels by hand, outside the CLI every later command relies on
describe('github-projects-cli.sh create-ticket', () => {
  let sandbox: Awaited<ReturnType<typeof buildSandbox>>

  afterEach(async () => {
    await sandbox.cleanup()
  })

  const run = async (args: string[], env: NodeJS.ProcessEnv = {}, cli = CLI) => {
    try {
      const { stdout, stderr } = await execFileP(BASH, [cli, 'create-ticket', ...args], { cwd: sandbox.dir, env: { ...sandbox.env, ...env } })
      return { stdout, stderr, code: 0 }
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; code?: number }
      return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
    }
  }

  it('creates the ticket on the board in Backlog, with its complexity, nature and milestone', async () => {
    sandbox = await buildSandbox()
    await writeFile(path.join(sandbox.dir, 'body.md'), '## Problem\n\nThe repository is empty.\n')

    const result = await run(['task', 'Bootstrap the repository', '--body-file', 'body.md', '--complexity', 'low', '--nature', 'internal', '--milestone', 'v1.0.1'])

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('✓ Ticket #12 created')
    const log = calls(sandbox.logPath)
    expect(log).toContain('issue create --title Bootstrap the repository --body-file body.md')
    expect(log.find((call) => call.startsWith('project item-edit'))).toContain('--single-select-option-id opt_backlog')
    expect(log).toContain('issue edit 12 --add-label complexity: low')
    expect(log).toContain('issue edit 12 --add-label nature:internal')
    expect(log.some((line) => line.startsWith('api repos/FakeOrg/FakeRepo/issues/12 -X PATCH -F milestone=3'))).toBe(true)
  })

  it('renders the type skeleton without a body file, and adds no optional label', async () => {
    sandbox = await buildSandbox()

    const result = await run(['story', 'Show the version'])

    expect(result.code).toBe(0)
    const create = calls(sandbox.logPath).find((call) => call.startsWith('issue create'))
    expect(create).toContain('--title Show the version --body')
    expect(calls(sandbox.logPath).some((call) => call.includes('--add-label'))).toBe(false)
  })

  it.each([
    [['epic', 'A grouper'], 'use create-epic'],
    [['story', 'T', '--complexity', 'huge'], '--complexity must be one of'],
    [['story', 'T', '--nature', 'bundled-pr'], 'use create-subtask'],
    [['story', 'T', '--body-file', 'missing.md'], 'does not exist'],
    [['story', 'T', '--frobnicate'], "unknown create-ticket option '--frobnicate'"],
    [['story'], 'Usage:']
  ])('refuses %j before creating anything', async (args, message) => {
    sandbox = await buildSandbox()

    const result = await run(args)

    expect(result.code).not.toBe(0)
    expect(result.stdout + result.stderr).toContain(message)
    expect(calls(sandbox.logPath).some((call) => call.startsWith('issue create'))).toBe(false)
  })

  it('applies Rule 8 on an SRS-enabled project, and accepts an explicit bypass', async () => {
    sandbox = await buildSandbox({ tools: { srs: { enabled: true, backend: 'notion' } } })

    const refused = await run(['task', 'Bootstrap the repository'])
    expect(refused.code).toBe(2)
    expect(refused.stderr).toContain('Rule 8')
    expect(calls(sandbox.logPath).some((call) => call.startsWith('issue create'))).toBe(false)

    const bypassed = await run(['task', 'Bootstrap the repository', '--bypass-srs', 'first commit of an empty repository'])
    expect(bypassed.code).toBe(0)
    expect(bypassed.stdout).toContain('bypassing rule 8')
  })

  it('reports that nothing exists when the issue cannot be created', async () => {
    sandbox = await buildSandbox()

    const result = await run(['task', 'T'], { FAKE_CREATE_FAILS: '1' })

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Nothing was created')
    expect(calls(sandbox.logPath).some((call) => call.startsWith('project item-add'))).toBe(false)
  })

  it('names the step to finish when a later step fails', async () => {
    sandbox = await buildSandbox()

    const result = await run(['task', 'T', '--milestone', 'v9.9.9'])

    expect(result.code).toBe(1)
    expect(result.stdout).toContain('✓ Ticket #12 created')
    expect(result.stderr).toContain('Ticket #12 exists, but these steps failed')
    expect(result.stderr).toContain('milestone assign 12 "v9.9.9"')
  })

  it('is reachable through workflow-cli.sh', async () => {
    sandbox = await buildSandbox()
    const skills = path.join(sandbox.dir, '.claude', 'skills')
    await mkdir(path.join(skills, 'sf-tool-github-projects'), { recursive: true })
    writeFileSync(path.join(skills, 'sf-tool-github-projects', 'github-projects-cli.sh'), readFileSync(CLI))
    chmodSync(path.join(skills, 'sf-tool-github-projects', 'github-projects-cli.sh'), 0o755)

    const result = await run(['task', 'Bootstrap the repository'], {}, WORKFLOW_CLI)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('✓ Ticket #12 created')
  })
})
