import { execFile, execFileSync } from 'child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'fs'
import { mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

import inquirer from 'inquirer'

import { sandboxGitEnv, sandboxSpawnedGit, type SpawnedGitSandbox } from '../../helpers/pushed-git-sandbox'

jest.mock('inquirer')

jest.mock('../../../utils', () => ({
  ...jest.requireActual('../../../utils'),
  checkNodeVersion: jest.fn()
}))

// npm and Prisma are the builders' only external effects with no bearing on what Git sees, and the only
// slow ones. Everything else runs for real: the scaffold, the harness, the manifest and Git itself.
jest.mock('../../../run', () => ({
  ...jest.requireActual('../../../run'),
  runRequired: jest.fn()
}))

// Label provisioning talks to GitHub: its behaviour is covered by its own unit spec (#973).
jest.mock('../../../installers/harness-provisioning', () => ({
  ...jest.requireActual('../../../installers/harness-provisioning'),
  provisionWorkflowLabels: jest.fn(() => [])
}))

jest.mock('ora', () => () => ({
  start: () => ({ text: '', succeed: jest.fn(), fail: jest.fn() })
}))

jest.mock('terminal-link', () => ({
  __esModule: true,
  default: (text: string) => text
}))

import { newCommand } from '../../../commands/new'
import { NewCommandOptions } from '../../../commands/new.options'

const execFileP = promisify(execFile)
const mockedPrompt = inquirer.prompt as unknown as jest.Mock

/**
 * #969 — `sf new` committed the scaffold inside the builders, before the harness, the agent
 * instructions and the manifest were written. A fresh project showed about 18 modified and untracked
 * files, `sf status` warned that the tree was not clean, and the lone `Initial commit` root was refused
 * by `workflow-cli.sh bootstrap`.
 *
 * These specs run the real command (the scaffold, the harness, the manifest and Git are not mocked; only
 * npm and Prisma are) and read what Git says afterwards.
 */
describe('sf new — the first commit (#969)', () => {
  let tempDir: string
  let originalCwd: string
  let logSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance
  let exitSpy: jest.SpyInstance
  let gitSandbox: SpawnedGitSandbox

  beforeAll(() => {
    // The command starts `git` itself: it must run with the sandbox's identity and configuration, never the
    // machine's (a CI runner has no identity) nor the repository this suite may be running inside a commit
    // hook of (GIT_INDEX_FILE and friends).
    gitSandbox = sandboxSpawnedGit()
  })

  afterAll(() => {
    gitSandbox.restore()
  })

  beforeEach(async () => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'sf-int-first-commit-')))
    originalCwd = process.cwd()
    process.chdir(tempDir)

    jest.clearAllMocks()
    mockedPrompt.mockImplementation(((_questions: unknown, answers: Record<string, unknown>) => Promise.resolve(answers ?? {})) as never)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never)
  })

  afterEach(async () => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    exitSpy.mockRestore()
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {})
  })

  const baseOpts: NewCommandOptions = {
    nonInteractive: true,
    profile: 'full',
    projectName: 'acme',
    projectDescription: 'My acme project',
    mainBranch: 'main',
    dbSetup: 'manual',
    s3Setup: 'manual',
    emailService: 'none',
    analytics: false,
    workflow: 'none'
  }

  const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', env: sandboxGitEnv() }).trim()
  const gitFails = (cwd: string, ...args: string[]): boolean => {
    try {
      execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe', env: sandboxGitEnv() })
      return false
    } catch {
      return true
    }
  }
  const output = (): string => logSpy.mock.calls.map((call) => call.join(' ')).join('\n')
  const readManifest = (dir: string) => JSON.parse(readFileSync(join(dir, '.saasfoundry.json'), 'utf8')) as { fileHashes?: Record<string, string>; mainBranch?: string }

  /** One repository `sf new` made: one commit, nothing left over, the manifest and the harness inside it. */
  function expectCommittedRepository(dir: string, { branch = 'main', tracked = [] as string[] } = {}): void {
    expect(existsSync(join(dir, '.git'))).toBe(true)
    // The point of the ticket: `git status` has nothing to say, untracked files included
    expect(git(dir, 'status', '--porcelain', '--untracked-files=all')).toBe('')
    expect(git(dir, 'rev-list', '--count', 'HEAD')).toBe('1')
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('Initial commit')
    // Made with the sandbox's identity, not the machine's: the spec holds where no Git identity is configured
    expect(git(dir, 'log', '-1', '--format=%an <%ae>')).toBe('Test <test@example.com>')
    expect(git(dir, 'branch', '--show-current')).toBe(branch)
    // The commit could not run the project's hooks: husky had no `.git` to configure when npm ran
    expect(gitFails(dir, 'config', '--get', 'core.hooksPath')).toBe(true)

    const files = git(dir, 'ls-files').split('\n')
    expect(files).toEqual(expect.arrayContaining(['.saasfoundry.json', 'AGENTS.md', '.claude/rules/claude-code.md', ...tracked]))
    // What the manifest says the harness installed is what the commit holds, byte for byte
    expect(git(dir, 'show', 'HEAD:.saasfoundry.json')).toBe(readFileSync(join(dir, '.saasfoundry.json'), 'utf8').trim())
  }

  describe.each([
    ['--setup-repo local', 'local' as const],
    ['--setup-repo existing', 'existing' as const]
  ])('monorepo, %s', (_label, setupRepo) => {
    it('leaves one root commit with everything the command wrote, and a clean tree', async () => {
      await newCommand({ ...baseOpts, structure: 'monorepo', setupRepo, ...(setupRepo === 'existing' ? { monorepoUrl: 'git@example.invalid:acme/acme.git' } : {}) })

      const project = join(tempDir, 'acme')
      expectCommittedRepository(project, { tracked: ['package.json', 'apps/api/package.json', 'apps/web/package.json'] })

      // Every file the manifest hashes (the harness, the agent instructions, the scaffold) is in the commit
      const hashed = Object.keys(readManifest(project).fileHashes ?? {})
      expect(hashed.length).toBeGreaterThan(10)
      const tracked = new Set(git(project, 'ls-files').split('\n'))
      expect(hashed.filter((path) => !tracked.has(path))).toEqual([])

      if (setupRepo === 'existing') expect(git(project, 'remote', 'get-url', 'origin')).toBe('git@example.invalid:acme/acme.git')
      else expect(git(project, 'remote')).toBe('')
    })
  })

  describe.each([
    ['--setup-repo local', 'local' as const],
    ['--setup-repo existing', 'existing' as const]
  ])('multirepo, %s', (_label, setupRepo) => {
    it('leaves one root commit per application repository, each with its own manifest and harness', async () => {
      await newCommand({
        ...baseOpts,
        structure: 'multirepo',
        setupRepo,
        ...(setupRepo === 'existing' ? { backendRepoUrl: 'git@example.invalid:acme/acme-api.git', frontendRepoUrl: 'git@example.invalid:acme/acme-web.git' } : {})
      })

      const project = join(tempDir, 'acme')
      // The project root is a folder, not a repository: the applications are
      expect(existsSync(join(project, '.git'))).toBe(false)

      for (const [app, url] of [
        ['acme-api', 'git@example.invalid:acme/acme-api.git'],
        ['acme-web', 'git@example.invalid:acme/acme-web.git']
      ]) {
        const repository = join(project, 'apps', app)
        expectCommittedRepository(repository, { tracked: ['package.json'] })
        expect(JSON.parse(git(repository, 'show', 'HEAD:.saasfoundry.json'))).toMatchObject({ structure: 'cli', projectName: app })
        if (setupRepo === 'existing') expect(git(repository, 'remote', 'get-url', 'origin')).toBe(url)
        else expect(git(repository, 'remote')).toBe('')
      }
    })
  })

  it('commits a stack-profile project too: no harness is managed, the tree is clean all the same', async () => {
    await newCommand({ ...baseOpts, profile: 'stack', structure: 'monorepo', setupRepo: 'local' })

    const project = join(tempDir, 'acme')
    expect(git(project, 'status', '--porcelain', '--untracked-files=all')).toBe('')
    expect(git(project, 'rev-list', '--count', 'HEAD')).toBe('1')
    expect(git(project, 'ls-files').split('\n')).toContain('.saasfoundry.json')
  })

  it('still finishes, and names what to set, when Git has no identity to commit with (a new machine, a CI runner)', async () => {
    await gitSandbox.withoutIdentity(() => newCommand({ ...baseOpts, structure: 'monorepo', setupRepo: 'local' }))

    const project = join(tempDir, 'acme')
    // The project is written and the command went to its end: only the commit is left to make by hand
    expect(existsSync(join(project, '.saasfoundry.json'))).toBe(true)
    expect(gitFails(project, 'rev-parse', '--verify', 'HEAD')).toBe(true)
    expect(output()).toContain('Could not commit The monorepo (git commit failed: Git does not know who you are: set user.name and user.email)')
    expect(output()).toContain('git add -A')
  })

  it('says in the summary what it committed, so a clean tree is not a surprise', async () => {
    await newCommand({ ...baseOpts, structure: 'monorepo', setupRepo: 'local' })

    expect(output()).toContain('Committed The monorepo as "Initial commit" on main')
  })

  describe('a project with a workflow: the first commit is `bootstrap`’s', () => {
    const workflowOpts: NewCommandOptions = {
      ...baseOpts,
      structure: 'monorepo',
      setupRepo: 'existing',
      workflow: 'solo',
      workingBranch: 'develop',
      prTargetBranch: 'develop',
      projectUrl: 'https://github.com/orgs/FakeOrg/projects/42'
    }

    it('leaves the repository without a commit, on its main branch, and names the command that makes it', async () => {
      const origin = join(tempDir, 'origin.git')
      execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env: sandboxGitEnv() })

      await newCommand({ ...workflowOpts, monorepoUrl: origin })

      const project = join(tempDir, 'acme')
      // A commit made here would be refused by `bootstrap`, which starts an empty repository: #969's second consequence
      expect(gitFails(project, 'rev-parse', '--verify', 'HEAD')).toBe(true)
      expect(git(project, 'branch', '--show-current')).toBe('main')
      expect(git(project, 'remote', 'get-url', 'origin')).toBe(origin)
      expect(output()).toContain('.claude/skills/sf-workflow/workflow-cli.sh bootstrap <ticket>')
      expect(output()).toContain('has no commit yet')
      // Nothing is staged either: `bootstrap` stages and commits everything itself
      expect(git(project, 'diff', '--cached', '--name-only')).toBe('')
    })

    it('fits `workflow-cli.sh bootstrap`: it commits everything sf new wrote and leaves a clean tree', async () => {
      const root = tempDir
      const origin = join(root, 'origin.git')
      execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env: sandboxGitEnv() })

      await newCommand({ ...workflowOpts, monorepoUrl: origin })

      const project = join(root, 'acme')
      const toolLog = join(root, 'tool-calls.log')
      const binDir = join(root, 'bin')
      await mkdir(binDir, { recursive: true })
      // The board and `gh` are the only things replaced: a tool CLI that logs its calls and a `gh` that knows no pull request
      const tool = join(project, '.claude/skills/sf-tool-github-projects/github-projects-cli.sh')
      writeFileSync(
        tool,
        `#!/bin/bash
printf '%s\\n' "$*" >> '${toolLog}'
case "$1" in
  get-labels) echo "complexity: low" ;;
  list-incomplete-children) printf '%s' '[]' ;;
  get-issue-type) printf '%s' '{"name":"sf-task"}' ;;
  update-status) echo "✓ Ticket #$2 → $3" ;;
  comment) cat > /dev/null; echo "✓ Comment recorded on #$2" ;;
esac
exit 0
`
      )
      chmodSync(tool, 0o755)
      writeFileSync(join(binDir, 'gh'), `#!/bin/bash\ncase "$1 $2" in\n  "pr list") echo '[]' ;;\n  *) echo '{}' ;;\nesac\n`)
      chmodSync(join(binDir, 'gh'), 0o755)

      const { stdout } = await execFileP('/bin/bash', [join(project, '.claude/skills/sf-workflow/workflow-cli.sh'), 'bootstrap', '1'], {
        cwd: project,
        // The script is the project's own: it commits and pushes with the sandbox's identity, as `sf new` did
        env: { ...sandboxGitEnv(), PATH: `${binDir}:${process.env.PATH}` }
      })

      expect(stdout).toContain('.saasfoundry.json')
      expect(git(project, 'status', '--porcelain', '--untracked-files=all')).toBe('')
      expect(git(project, 'rev-list', '--count', 'main')).toBe('1')
      expect(git(project, 'log', '-1', '--format=%s', 'main')).toBe('chore(#1): bootstrap the repository')
      expect(git(project, 'show', 'main:.saasfoundry.json')).toContain('"projectName": "acme"')
      expect(git(project, 'ls-files').split('\n')).toEqual(expect.arrayContaining(['.saasfoundry.json', 'AGENTS.md', '.claude/skills/sf-workflow/workflow-cli.sh']))
      // Both branches reached the remote, from the one root commit
      expect(git(project, 'rev-parse', 'origin/develop')).toBe(git(project, 'rev-parse', 'origin/main'))
      expect(readFileSync(toolLog, 'utf8')).toContain('update-status 1 Done')
    })
  })
})
