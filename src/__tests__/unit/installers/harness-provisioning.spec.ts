import { execSync } from 'node:child_process'
import { mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { buildWorkflowLabels, ensureWorkflowLabels, ensureWorkingBranch, resolveRepoSlug, type CommandRunner } from '../../../installers/harness-provisioning'

const sh = (cmd: string, cwd: string) => execSync(cmd, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })

describe('harness-provisioning', () => {
  describe('ensureWorkingBranch', () => {
    let dir: string

    beforeEach(async () => {
      dir = join(tmpdir(), `sf-prov-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      await mkdir(dir, { recursive: true })
    })

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    })

    const initRepo = (branch = 'main') => {
      sh(`git init -b ${branch}`, dir)
      sh('git -c user.email=t@t -c user.name=t commit --allow-empty -m init', dir)
    }

    const branchExists = (branch: string) => {
      try {
        sh(`git rev-parse --verify --quiet refs/heads/${branch}`, dir)
        return true
      } catch {
        return false
      }
    }

    it('creates the working branch from main without switching the current branch', () => {
      initRepo('main')
      sh('git checkout -b feature/wip', dir)

      const result = ensureWorkingBranch({ cwd: dir, workingBranch: 'develop', mainBranch: 'main' })

      expect(result.action).toBe('created')
      expect(result.branch).toBe('develop')
      expect(result.pushed).toBe(false)
      expect(result.reason).toBe('no-remote')
      expect(branchExists('develop')).toBe(true)
      // user stays on their branch — harness must not move them
      expect(sh('git branch --show-current', dir).toString().trim()).toBe('feature/wip')
    })

    it('is a no-op when the branch already exists', () => {
      initRepo('main')
      sh('git branch develop', dir)

      const result = ensureWorkingBranch({ cwd: dir, workingBranch: 'develop', mainBranch: 'main' })

      expect(result.action).toBe('exists')
      expect(result.branch).toBe('develop')
    })

    it('is a no-op when the working branch is already the current branch', () => {
      initRepo('develop')

      const result = ensureWorkingBranch({ cwd: dir, workingBranch: 'develop', mainBranch: 'main' })

      expect(result).toEqual({ action: 'skipped', reason: 'already-current', branch: 'develop' })
    })

    it('falls back to the default branch when mainBranch does not exist locally', () => {
      initRepo('master')
      sh('git checkout -b feature/wip', dir)

      const result = ensureWorkingBranch({ cwd: dir, workingBranch: 'develop', mainBranch: 'main' })

      expect(result.action).toBe('created')
      expect(branchExists('develop')).toBe(true)
    })

    it('skips gracefully outside a git repository', () => {
      const result = ensureWorkingBranch({ cwd: dir, workingBranch: 'develop', mainBranch: 'main' })
      expect(result).toEqual({ action: 'skipped', reason: 'not-a-git-repo', branch: 'develop' })
    })

    it('skips when no working branch is configured', () => {
      initRepo('main')
      expect(ensureWorkingBranch({ cwd: dir, workingBranch: undefined })).toEqual({ action: 'skipped', reason: 'no-working-branch' })
      expect(ensureWorkingBranch({ cwd: dir, workingBranch: '   ' })).toEqual({ action: 'skipped', reason: 'no-working-branch' })
    })

    it('pushes to origin when a remote is configured', () => {
      // Bare "remote" + working clone so push actually succeeds locally.
      const remote = `${dir}-remote.git`
      sh(`git init --bare -b main ${remote}`, dir)
      initRepo('main')
      sh(`git remote add origin ${remote}`, dir)
      sh('git push -u origin main', dir)
      sh('git checkout -b feature/wip', dir)

      const result = ensureWorkingBranch({ cwd: dir, workingBranch: 'develop', mainBranch: 'main' })

      expect(result).toMatchObject({ action: 'created', branch: 'develop', pushed: true })
      // remote now has the branch
      const remoteBranches = execSync(`git ls-remote --heads ${remote}`, { encoding: 'utf-8' })
      expect(remoteBranches).toContain('refs/heads/develop')

      execSync(`rm -rf ${remote}`)
    })
  })

  describe('buildWorkflowLabels', () => {
    it('includes complexity + nature labels and excludes feedback labels', () => {
      const names = buildWorkflowLabels({ srs: false }).map((l) => l.name)
      expect(names).toEqual(expect.arrayContaining(['complexity: bug', 'complexity: low', 'complexity: medium', 'complexity: complex', 'nature:user-facing', 'nature:internal', 'nature:bundled-pr']))
      expect(names).not.toContain('module-request')
      expect(names).not.toContain('cli-bug')
      expect(names).not.toContain('scaffold-bug')
      expect(names.some((n) => n.startsWith('srs:'))).toBe(false)
    })

    it('adds the srs labels only when srs is enabled', () => {
      const names = buildWorkflowLabels({ srs: true }).map((l) => l.name)
      expect(names).toEqual(expect.arrayContaining(['srs:drafting', 'srs:update', 'srs:new']))
    })
  })

  describe('ensureWorkflowLabels', () => {
    it('creates every label and reports them', () => {
      const calls: string[] = []
      const run: CommandRunner = (cmd) => {
        calls.push(cmd)
        return ''
      }

      const result = ensureWorkflowLabels('acme/notulias', { srs: true }, run)

      expect(result.created).toHaveLength(10)
      expect(result.existing).toHaveLength(0)
      expect(result.failed).toHaveLength(0)
      expect(calls).toHaveLength(10)
      expect(calls[0]).toContain('gh label create')
      expect(calls[0]).toContain("--repo 'acme/notulias'")
    })

    it('treats "already exists" as idempotent success, not a failure', () => {
      const run: CommandRunner = () => {
        throw Object.assign(new Error('failed to run git: GraphQL: Label "complexity: bug" already exists'), { stderr: 'already exists' })
      }

      const result = ensureWorkflowLabels('acme/notulias', { srs: false }, run)

      expect(result.created).toHaveLength(0)
      expect(result.existing).toHaveLength(7)
      expect(result.failed).toHaveLength(0)
    })

    it('records real failures separately', () => {
      const run: CommandRunner = () => {
        throw Object.assign(new Error('HTTP 403'), { stderr: 'must have admin rights' })
      }

      const result = ensureWorkflowLabels('acme/notulias', { srs: false }, run)

      expect(result.failed).toHaveLength(7)
      expect(result.existing).toHaveLength(0)
    })
  })

  describe('resolveRepoSlug', () => {
    it('returns the slug from gh', () => {
      expect(resolveRepoSlug(() => 'acme/notulias\n')).toBe('acme/notulias')
    })

    it('returns null when gh fails', () => {
      expect(
        resolveRepoSlug(() => {
          throw new Error('not authenticated')
        })
      ).toBeNull()
    })
  })
})
