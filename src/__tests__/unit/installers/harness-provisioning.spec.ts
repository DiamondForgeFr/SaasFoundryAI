import { execSync } from 'node:child_process'
import { mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  buildWorkflowLabels,
  describeBranchProvision,
  ensureWorkflowLabels,
  ensureWorkingBranch,
  provisionWorkflowLabels,
  resolveRepoSlug,
  runnerIn,
  type CommandRunner
} from '../../../installers/harness-provisioning'

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

    // #822 — a fresh `git init` has nothing to branch from; the failure used to be silent
    it('names the missing first commit on an unborn branch', () => {
      sh('git init -b main', dir)

      const result = ensureWorkingBranch({ cwd: dir, workingBranch: 'develop', mainBranch: 'main' })

      expect(result).toEqual({ action: 'skipped', reason: 'no-commits', branch: 'develop', base: 'main' })
      expect(describeBranchProvision(result)).toEqual({
        ok: false,
        message:
          'Working branch "develop" not created: "main" has no commits yet. Create the first ticket, then run `.claude/skills/sf-workflow/workflow-cli.sh bootstrap <ticket>`: it commits the setup on main, creates "develop" and closes the ticket'
      })
    })

    it('describes every outcome, with the next step when one is left', () => {
      initRepo('main')
      sh('git checkout -b feature/wip', dir)
      const created = ensureWorkingBranch({ cwd: dir, workingBranch: 'develop', mainBranch: 'main' })
      expect(describeBranchProvision(created)).toEqual({
        ok: false,
        message: 'Created the working branch "develop" from main locally — no remote yet; push it with `git push -u origin develop` once one exists'
      })
      expect(describeBranchProvision(ensureWorkingBranch({ cwd: dir, workingBranch: 'develop', mainBranch: 'main' }))).toEqual({ ok: true, message: 'Working branch "develop" already exists' })
      expect(describeBranchProvision(ensureWorkingBranch({ cwd: dir, workingBranch: 'feature/wip' }))).toEqual({ ok: true, message: 'Working branch "feature/wip" is the current branch' })
      expect(describeBranchProvision({ action: 'created', branch: 'develop', base: 'main', pushed: true })).toEqual({ ok: true, message: 'Created and pushed the working branch "develop" from main' })
      expect(describeBranchProvision({ action: 'created', branch: 'develop', base: 'main', pushed: false, reason: 'push-failed' })?.message).toContain(
        'the push failed — run `git push -u origin develop`'
      )
      expect(describeBranchProvision({ action: 'skipped', reason: 'no-working-branch' })).toBeNull()
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

  // #973 — one helper for the harness and the full paths, so both create and report the labels alike
  describe('provisionWorkflowLabels', () => {
    /** A fake `gh`: each directory answers its own slug (or none), each label call is recorded with its directory. */
    function fakeGh(slugs: Record<string, string | null>, onLabel: (dir: string) => void = () => {}) {
      const labelCalls: { dir: string; cmd: string }[] = []
      const runnerFor = (dir: string): CommandRunner => {
        return (cmd) => {
          if (cmd.startsWith('gh repo view')) {
            const slug = slugs[dir]
            if (!slug) throw new Error('no git remotes found')
            return `${slug}\n`
          }
          labelCalls.push({ dir, cmd })
          onLabel(dir)
          return ''
        }
      }
      return { runnerFor, labelCalls }
    }

    it('creates the labels on the repository of the directory and reports the count', () => {
      const gh = fakeGh({ '.': 'acme/acme' })

      const notes = provisionWorkflowLabels({ srs: true, dirs: ['.'] }, gh.runnerFor)

      expect(notes).toEqual([{ ok: true, message: 'Created 10 workflow labels on acme/acme' }])
      expect(gh.labelCalls).toHaveLength(10)
      expect(gh.labelCalls.every((call) => call.dir === '.' && call.cmd.includes("--repo 'acme/acme'"))).toBe(true)
    })

    it('provisions every repository of a multirepo, each through its own directory', () => {
      const gh = fakeGh({ 'apps/acme-api': 'acme/acme-api', 'apps/acme-web': 'acme/acme-web' })

      const notes = provisionWorkflowLabels({ srs: false, dirs: ['apps/acme-api', 'apps/acme-web'] }, gh.runnerFor)

      expect(notes.map((note) => note.message)).toEqual(['Created 7 workflow labels on acme/acme-api', 'Created 7 workflow labels on acme/acme-web'])
      expect(gh.labelCalls.filter((call) => call.dir === 'apps/acme-api')).toHaveLength(7)
      expect(gh.labelCalls.filter((call) => call.dir === 'apps/acme-web')).toHaveLength(7)
    })

    it('provisions a repository shared by two directories once', () => {
      const gh = fakeGh({ a: 'acme/acme', b: 'acme/acme' })

      expect(provisionWorkflowLabels({ srs: false, dirs: ['a', 'b'] }, gh.runnerFor)).toHaveLength(1)
      expect(gh.labelCalls).toHaveLength(7)
    })

    it('says so when every label was already there', () => {
      const gh = fakeGh({ '.': 'acme/acme' }, () => {
        throw Object.assign(new Error('exit 1'), { stderr: 'label with name "x" already exists' })
      })

      expect(provisionWorkflowLabels({ srs: false, dirs: ['.'] }, gh.runnerFor)).toEqual([{ ok: true, message: 'All 7 workflow labels already exist on acme/acme' }])
    })

    it('warns about the labels it could not create', () => {
      const gh = fakeGh({ '.': 'acme/acme' }, () => {
        throw Object.assign(new Error('HTTP 403'), { stderr: 'must have admin rights' })
      })

      expect(provisionWorkflowLabels({ srs: false, dirs: ['.'] }, gh.runnerFor)).toEqual([{ ok: false, message: "7 label(s) could not be created on acme/acme — check 'gh auth status' (repo scope)" }])
    })

    it('warns, naming the directory and the way out, when the repository cannot be resolved', () => {
      const gh = fakeGh({})

      const notes = provisionWorkflowLabels({ srs: false, dirs: ['.', 'apps/acme-web'] }, gh.runnerFor)

      expect(notes).toHaveLength(2)
      expect(notes.every((note) => !note.ok)).toBe(true)
      expect(notes[0].message).toMatch(/^Could not resolve the GitHub repo — skipped label creation/)
      expect(notes[1].message).toMatch(/^Could not resolve the GitHub repo of apps\/acme-web — skipped label creation/)
      expect(notes[0].message).toContain("'gh auth login'")
      expect(notes[0].message).toContain('.claude/docs/github-labels.md')
      expect(gh.labelCalls).toHaveLength(0)
    })

    it('runs gh in the directory it is given', () => {
      expect(runnerIn(tmpdir())('pwd').trim()).toBe(execSync('pwd', { cwd: tmpdir(), encoding: 'utf-8' }).trim())
      expect(() => runnerIn(join(tmpdir(), `sf-missing-${Date.now()}`))('pwd')).toThrow()
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
