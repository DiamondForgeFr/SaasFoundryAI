import { execFile, execFileSync } from 'child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileP = promisify(execFile)

const CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-workflow/workflow-cli.sh')
const BASH = '/bin/bash'
const GIT_IDENTITY = { GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com' }

/**
 * A fresh `git init -b main` project with a bare `origin`, a tool CLI that logs its calls
 * (FAKE_NO_COMPLEXITY drops the complexity label) and a `gh` that knows no pull request.
 */
async function buildSandbox(options: { initialBranch?: string } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'sf-wfcli-bootstrap-'))
  const dir = path.join(root, 'project')
  const origin = path.join(root, 'origin.git')
  const binDir = path.join(root, 'bin')
  const toolDir = path.join(dir, '.claude/skills/sf-tool-github-projects')
  const toolLog = path.join(root, 'tool-calls.log')
  const commentFile = path.join(root, 'comment.md')
  await mkdir(toolDir, { recursive: true })
  await mkdir(binDir, { recursive: true })
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
  execFileSync('git', ['init', '-q', '-b', options.initialBranch ?? 'main'], { cwd: dir })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir })
  execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: dir })

  await writeFile(
    path.join(dir, '.saasfoundry.json'),
    JSON.stringify({ mainBranch: 'main', workflow: { tool: 'github-projects', projectUrl: 'https://github.com/orgs/FakeOrg/projects/42', workingBranch: 'develop', prTargetBranch: 'develop' } })
  )
  writeFileSync(
    path.join(toolDir, 'github-projects-cli.sh'),
    `#!/bin/bash
printf '%s\\n' "$*" >> '${toolLog}'
case "$1" in
  get-labels) [ -z "$FAKE_NO_COMPLEXITY" ] && echo "complexity: low" ;;
  list-incomplete-children) printf '%s' '[]' ;;
  get-issue-type) printf '%s' '{"name":"sf-task"}' ;;
  update-status) echo "✓ Ticket #$2 → $3" ;;
  comment) cat > '${commentFile}'; echo "✓ Comment recorded on #$2" ;;
esac
exit 0
`
  )
  chmodSync(path.join(toolDir, 'github-projects-cli.sh'), 0o755)
  writeFileSync(path.join(binDir, 'gh'), `#!/bin/bash\ncase "$1 $2" in\n  "pr list") echo '[]' ;;\n  *) echo '{}' ;;\nesac\n`)
  chmodSync(path.join(binDir, 'gh'), 0o755)

  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...GIT_IDENTITY } }).trim()
  const toolCalls = () => {
    try {
      return readFileSync(toolLog, 'utf8').split('\n').filter(Boolean)
    } catch {
      return []
    }
  }
  const run = async (args: string[], env: NodeJS.ProcessEnv = {}) => {
    try {
      const { stdout, stderr } = await execFileP(BASH, [CLI, ...args], { cwd: dir, env: { ...process.env, ...GIT_IDENTITY, PATH: `${binDir}:${process.env.PATH}`, ...env } })
      return { stdout, stderr, code: 0 }
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; code?: number }
      return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
    }
  }
  return { dir, origin, git, run, toolCalls, comment: () => readFileSync(commentFile, 'utf8'), cleanup: () => rm(root, { recursive: true, force: true }) }
}

// #833 — on a repository with no commit the first ticket had no branch to start from nor
// a PR to merge, and could only close through two bypass variables
describe('workflow-cli.sh bootstrap', () => {
  let sandbox: Awaited<ReturnType<typeof buildSandbox>>

  afterEach(async () => {
    await sandbox.cleanup()
  })

  it('commits the setup as the root commit, creates the working branch and closes the ticket on it', async () => {
    sandbox = await buildSandbox()

    const result = await sandbox.run(['bootstrap', '1'])

    expect(result.code).toBe(0)
    expect(sandbox.git('log', '-1', '--format=%s', 'main')).toBe('chore(#1): bootstrap the repository')
    expect(sandbox.git('ls-remote', '--heads', 'origin')).toContain('refs/heads/main')
    expect(sandbox.git('ls-remote', '--heads', 'origin')).toContain('refs/heads/develop')
    expect(sandbox.git('rev-parse', 'origin/develop')).toBe(sandbox.git('rev-parse', 'origin/main'))
    expect(sandbox.toolCalls()).toEqual(expect.arrayContaining(['update-status 1 In progress', 'comment 1 -', 'update-status 1 Done']))
    expect(sandbox.comment()).toContain(`root commit ${sandbox.git('rev-parse', 'main')}`)
    expect(result.stdout).toContain('.saasfoundry.json')
  })

  it('lets only the bootstrapped ticket close without a merged pull request', async () => {
    sandbox = await buildSandbox()
    await sandbox.run(['bootstrap', '1'])

    const other = await sandbox.run(['update-status', '2', 'Done'])

    expect(other.code).toBe(2)
    expect(other.stderr).toContain('no verified merged PR')
    expect(sandbox.toolCalls()).not.toContain('update-status 2 Done')
  })

  it('refuses a repository that already has commits', async () => {
    sandbox = await buildSandbox()
    sandbox.git('commit', '-q', '--allow-empty', '-m', 'initial')

    const result = await sandbox.run(['bootstrap', '1'])

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('already has commits')
    expect(sandbox.toolCalls()).toEqual([])
  })

  it('refuses without an origin remote, and on another branch than the main one, before committing', async () => {
    sandbox = await buildSandbox()
    sandbox.git('remote', 'remove', 'origin')
    const noRemote = await sandbox.run(['bootstrap', '1'])
    expect(noRemote.code).toBe(2)
    expect(noRemote.stderr).toContain("No 'origin' remote")
    await sandbox.cleanup()

    sandbox = await buildSandbox({ initialBranch: 'master' })
    const otherBranch = await sandbox.run(['bootstrap', '1'])
    expect(otherBranch.code).toBe(2)
    expect(otherBranch.stderr).toContain("the manifest's main branch is 'main'")
    expect(() => sandbox.git('rev-parse', '--verify', 'HEAD')).toThrow()
  })

  it('keeps the complexity guard: a ticket without complexity is not committed for', async () => {
    sandbox = await buildSandbox()

    const result = await sandbox.run(['bootstrap', '1'], { FAKE_NO_COMPLEXITY: '1' })

    expect(result.code).toBe(2)
    expect(() => sandbox.git('rev-parse', '--verify', 'HEAD')).toThrow()
  })

  it('resumes after a failed push without committing again', async () => {
    sandbox = await buildSandbox()
    sandbox.git('remote', 'set-url', 'origin', path.join(sandbox.dir, 'missing.git'))

    const failed = await sandbox.run(['bootstrap', '1'])
    expect(failed.code).toBe(1)
    expect(failed.stderr).toContain('re-run: workflow-cli.sh bootstrap 1')
    const root = sandbox.git('rev-parse', 'HEAD')

    sandbox.git('remote', 'set-url', 'origin', sandbox.origin)
    const resumed = await sandbox.run(['bootstrap', '1'])

    expect(resumed.code).toBe(0)
    expect(resumed.stdout).toContain('Resuming the bootstrap of #1')
    expect(sandbox.git('rev-parse', 'origin/main')).toBe(root)
    expect(sandbox.toolCalls().filter((call) => call === 'update-status 1 In progress')).toHaveLength(1)
    expect(sandbox.toolCalls()).toContain('update-status 1 Done')
  })
})
