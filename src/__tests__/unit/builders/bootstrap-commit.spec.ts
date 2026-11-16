import { execFileSync } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { commitBootstrap, defersFirstCommitToWorkflow, describeBootstrapCommit, ROOT_COMMIT_MESSAGE } from '../../../builders/bootstrap-commit'
import type { WorkflowConfig } from '../../../types'
import { applySandboxGitEnv } from '../../helpers/pushed-git-sandbox'

/**
 * #969 — the first commit of a generated project is made once, after everything `sf new` writes is on
 * disk, and only when no workflow's `bootstrap` command is going to make it.
 */
describe('commitBootstrap (#969)', () => {
  let root: string
  let restoreGitEnv: () => void

  beforeAll(() => {
    restoreGitEnv = applySandboxGitEnv()
  })

  afterAll(() => {
    restoreGitEnv()
  })

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'sf-bootstrap-commit-')))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const solo: WorkflowConfig = { tool: 'github-projects', workingBranch: 'develop', prTargetBranch: 'develop' }

  /** What `provision*` leaves behind: a repository on its main branch with files in it and no commit. */
  function bornEmpty(name: string, files: Record<string, string> = { 'package.json': '{}\n', '.saasfoundry.json': '{}\n', 'AGENTS.md': '# agents\n' }): string {
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    git(dir, 'init', '-q')
    git(dir, 'checkout', '-q', '-b', 'main')
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(join(dir, file, '..'), { recursive: true })
      writeFileSync(join(dir, file), content)
    }
    return dir
  }

  it('commits everything in one root commit on the main branch and leaves a clean tree', () => {
    const dir = bornEmpty('mono')

    const [result] = commitBootstrap({ repositories: [{ dir, label: 'The monorepo' }], mainBranch: 'main' })

    expect(result).toEqual({ label: 'The monorepo', status: 'committed', branch: 'main', workingBranch: undefined })
    expect(git(dir, 'status', '--porcelain', '--untracked-files=all')).toBe('')
    expect(git(dir, 'rev-list', '--count', 'HEAD')).toBe('1')
    expect(git(dir, 'log', '-1', '--format=%s')).toBe(ROOT_COMMIT_MESSAGE)
    expect(git(dir, 'ls-files').split('\n').sort()).toEqual(['.saasfoundry.json', 'AGENTS.md', 'package.json'])
  })

  it('honours .gitignore: what the project ignores stays out of the commit and out of `git status`', () => {
    const dir = bornEmpty('ignored', { '.gitignore': 'node_modules\n.env\n', 'node_modules/x/index.js': 'x\n', '.env': 'SECRET=1\n', 'src/main.ts': 'export {}\n' })

    commitBootstrap({ repositories: [{ dir, label: 'r' }], mainBranch: 'main' })

    expect(git(dir, 'ls-files').split('\n').sort()).toEqual(['.gitignore', 'src/main.ts'])
    expect(git(dir, 'status', '--porcelain', '--untracked-files=all')).toBe('')
  })

  it('creates the working branch from the root commit and leaves the project on it, when the workflow declares one but delegates nothing', () => {
    const dir = bornEmpty('mono')

    const [result] = commitBootstrap({ repositories: [{ dir, label: 'r' }], mainBranch: 'main', workflow: { tool: 'none', workingBranch: 'develop' } })

    expect(result).toMatchObject({ status: 'committed', branch: 'main', workingBranch: 'develop' })
    expect(git(dir, 'branch', '--show-current')).toBe('develop')
    expect(git(dir, 'rev-parse', 'develop')).toBe(git(dir, 'rev-parse', 'main'))
  })

  it('makes no commit and stages nothing when a workflow is configured: `bootstrap` makes it', () => {
    const dir = bornEmpty('mono')

    const [result] = commitBootstrap({ repositories: [{ dir, label: 'The monorepo' }], mainBranch: 'main', workflow: solo })

    expect(result).toEqual({ label: 'The monorepo', status: 'deferred', branch: 'main', workingBranch: 'develop' })
    expect(() => git(dir, 'rev-parse', '--verify', 'HEAD')).toThrow()
    expect(git(dir, 'diff', '--cached', '--name-only')).toBe('')
    expect(git(dir, 'branch', '--show-current')).toBe('main')
    expect(describeBootstrapCommit(result).message).toContain('.claude/skills/sf-workflow/workflow-cli.sh bootstrap <ticket>')
  })

  it.each([
    [undefined, false],
    [{ tool: 'none' } as WorkflowConfig, false],
    [solo, true],
    [{ tool: 'jira' } as WorkflowConfig, true]
  ])('defers the first commit to the workflow only when it has a tool: %j → %s', (workflow, deferred) => {
    expect(defersFirstCommitToWorkflow(workflow)).toBe(deferred)
  })

  it('never stages a project into the repository it sits in when its own `git init` did not run', () => {
    const outer = bornEmpty('outer', { 'README.md': 'outer\n' })
    git(outer, 'add', '-A')
    git(outer, 'commit', '-q', '-m', 'outer')
    const inner = join(outer, 'project')
    mkdirSync(inner)
    writeFileSync(join(inner, 'package.json'), '{}\n')

    const [result] = commitBootstrap({ repositories: [{ dir: inner, label: 'The monorepo' }], mainBranch: 'main' })

    expect(result).toEqual({ label: 'The monorepo', status: 'no-repository' })
    expect(git(outer, 'diff', '--cached', '--name-only')).toBe('')
    expect(git(outer, 'rev-list', '--count', 'HEAD')).toBe('1')
    expect(describeBootstrapCommit(result)).toEqual({ ok: false, message: 'The monorepo is not a Git repository (git init did not run): nothing was committed' })
  })

  it('treats each repository on its own: a multirepo project commits both applications', () => {
    const api = bornEmpty('apps/acme-api')
    const web = bornEmpty('apps/acme-web')

    const results = commitBootstrap({
      repositories: [
        { dir: api, label: 'apps/acme-api' },
        { dir: web, label: 'apps/acme-web' }
      ],
      mainBranch: 'main'
    })

    expect(results.map((result) => result.status)).toEqual(['committed', 'committed'])
    for (const dir of [api, web]) {
      expect(git(dir, 'status', '--porcelain', '--untracked-files=all')).toBe('')
      expect(git(dir, 'rev-list', '--count', 'HEAD')).toBe('1')
    }
  })

  it('reports a commit Git refuses as a note that says what to run, and does not throw', () => {
    // A hook of the user's own (a global template, a checkout that was already a repository) refuses the commit
    const dir = bornEmpty('refusing-hook')
    const hook = join(dir, '.git', 'hooks', 'pre-commit')
    mkdirSync(join(dir, '.git', 'hooks'), { recursive: true })
    writeFileSync(hook, '#!/bin/sh\necho "lint says no" >&2\nexit 1\n')
    chmodSync(hook, 0o755)

    const [result] = commitBootstrap({ repositories: [{ dir, label: 'apps/acme-api' }], mainBranch: 'main' })

    expect(result).toMatchObject({ label: 'apps/acme-api', status: 'failed', step: 'git commit' })
    expect(result).toMatchObject({ detail: expect.stringContaining('lint says no') })
    const note = describeBootstrapCommit(result)
    expect(note.ok).toBe(false)
    expect(note.message).toContain('Could not commit apps/acme-api')
    expect(note.message).toContain('git add -A')
    // Nothing was forced through: the files are staged, the repository still has no commit
    expect(() => git(dir, 'rev-parse', '--verify', 'HEAD')).toThrow()
  })

  it('stops at the first Git step that fails, so a refused commit never creates the working branch', () => {
    const dir = bornEmpty('refusing-hook')
    const hook = join(dir, '.git', 'hooks', 'pre-commit')
    mkdirSync(join(dir, '.git', 'hooks'), { recursive: true })
    writeFileSync(hook, '#!/bin/sh\nexit 1\n')
    chmodSync(hook, 0o755)

    const [result] = commitBootstrap({ repositories: [{ dir, label: 'r' }], mainBranch: 'main', workflow: { tool: 'none', workingBranch: 'develop' } })

    expect(result).toMatchObject({ status: 'failed', step: 'git commit' })
    expect(git(dir, 'branch', '--show-current')).toBe('main')
  })

  it.each(['bad branch', '-leading-dash', 'a..b'])('refuses the branch name %j before touching any repository', (branch) => {
    const dir = bornEmpty('mono')

    expect(() => commitBootstrap({ repositories: [{ dir, label: 'r' }], mainBranch: branch })).toThrow('Invalid Git branch name')
    expect(git(dir, 'diff', '--cached', '--name-only')).toBe('')
  })

  it('describes a commit by what it holds and where the project now is', () => {
    expect(describeBootstrapCommit({ label: 'The monorepo', status: 'committed', branch: 'main' })).toEqual({
      ok: true,
      message: 'Committed The monorepo as "Initial commit" on main: the working tree is clean'
    })
    expect(describeBootstrapCommit({ label: 'The monorepo', status: 'committed', branch: 'main', workingBranch: 'develop' }).message).toContain('and created "develop" from it')
  })
})
