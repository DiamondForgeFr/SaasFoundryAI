import { execFile } from 'child_process'
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

import { initPushedRepo, sandboxGitEnv, type PushedRepo } from '../../helpers/pushed-git-sandbox'

const execFileP = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const CLI = path.resolve(REPO_ROOT, '.claude/skills/sf-workflow/workflow-cli.sh')
const BASH = '/bin/bash'

// The pushed-commits guard (#1104): `update-status <ticket> "AI testing"` refuses a ticket whose work is not on
// origin. It reads git alone, in the checkout that holds the work, so these tests run against real repositories
// with a bare `origin`; only the tool CLI is a shim, to answer the labels and the native parent of the ticket.

interface Sandbox {
  repo: PushedRepo
  env: NodeJS.ProcessEnv
  toolLogPath: string
  cleanup: () => Promise<void>
}

async function buildSandbox(options: { natureLabel?: 'bundled-pr' | 'internal'; parent?: number; branch?: string; init?: boolean } = {}): Promise<Sandbox> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-wfcli-pushed-'))
  const toolDir = path.join(dir, '.claude/skills/sf-tool-github-projects')
  const binDir = path.join(dir, 'bin')
  const toolLogPath = path.join(dir, 'tool-calls.log')
  await mkdir(toolDir, { recursive: true })
  await mkdir(binDir, { recursive: true })
  await writeFile(
    path.join(dir, '.saasfoundry.json'),
    JSON.stringify({
      workflow: {
        tool: 'github-projects',
        projectUrl: 'https://github.com/orgs/FakeOrg/projects/42',
        workingBranch: 'develop',
        prTargetBranch: 'develop',
        releaseBranch: 'master',
        branchNaming: { feature: 'feature/{N}-{description}', fix: 'fix/{N}-{description}', release: 'rc-{version}' }
      }
    })
  )
  const labels = ['complexity: low', ...(options.natureLabel ? [`nature:${options.natureLabel}`] : [])]
  const labelsBlock = labels.map((l) => `printf '%s\\n' '${l}'`).join('\n    ')
  const toolPath = path.join(toolDir, 'github-projects-cli.sh')
  writeFileSync(
    toolPath,
    `#!/bin/bash
printf '%s\\n' "$*" >> '${toolLogPath}'
case "$1" in
  get-labels)
    ${labelsBlock}
    ;;
  get-parent) printf '%s' '{"number":${options.parent ?? 7}}' ;;
  get-issue-type) printf '%s' '{"name":"sf-task"}' ;;
  list-incomplete-children) printf '%s' '[]' ;;
  update-status) echo "✓ Ticket #$2 → $3" ;;
  *) exit 0 ;;
esac
`
  )
  chmodSync(toolPath, 0o755)
  writeFileSync(path.join(binDir, 'gh'), '#!/bin/bash\nexit 0\n')
  chmodSync(path.join(binDir, 'gh'), 0o755)

  const repo = initPushedRepo(dir, options.branch)
  const env = { ...sandboxGitEnv(), PWD: dir, PATH: `${binDir}:${process.env.PATH ?? ''}` }
  return {
    repo,
    env,
    toolLogPath,
    cleanup: async () => {
      repo.cleanup()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

async function runCli(args: string[], sandbox: Sandbox, options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  try {
    const { stdout, stderr } = await execFileP(BASH, [CLI, ...args], { cwd: options.cwd ?? sandbox.repo.dir, env: { ...sandbox.env, ...options.env } })
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

describe('sf-workflow CLI — pushed-commits guard (→ AI testing)', () => {
  let sandbox: Sandbox

  afterEach(async () => {
    if (sandbox) await sandbox.cleanup()
  })

  const statusCalls = () => readLog(sandbox.toolLogPath).filter((l) => l.startsWith('update-status'))
  const toAiTesting = (options: Parameters<typeof runCli>[2] = {}, ticket = '42') => runCli(['update-status', ticket, 'AI testing'], sandbox, options)

  describe('on the ticket branch of this checkout', () => {
    it('lets a clean, pushed branch through', async () => {
      sandbox = await buildSandbox()
      const res = await toAiTesting()
      expect(res.code).toBe(0)
      expect(statusCalls()).toEqual(['update-status 42 AI testing'])
    })

    it('refuses a modified tracked file, lists it, and names the commit and push commands', async () => {
      sandbox = await buildSandbox()
      writeFileSync(path.join(sandbox.repo.dir, 'work.txt'), 'changed\n')
      const res = await toAiTesting()
      expect(res.code).toBe(2)
      expect(res.stderr).toContain("cannot enter 'AI Testing'")
      expect(res.stderr).toContain('work.txt')
      expect(res.stderr).toContain('git add <paths> && git commit -m "<type>(#42): <description>" && git push')
      expect(res.stderr).toContain('SF_WORKFLOW_BYPASS_PUSHED_GUARD=1')
      expect(statusCalls()).toEqual([])
    })

    it('refuses a staged file', async () => {
      sandbox = await buildSandbox()
      writeFileSync(path.join(sandbox.repo.dir, 'staged.txt'), 'new\n')
      sandbox.repo.git(['add', 'staged.txt'])
      const res = await toAiTesting()
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('staged.txt')
    })

    it('lists at most five paths', async () => {
      sandbox = await buildSandbox()
      for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
        writeFileSync(path.join(sandbox.repo.dir, `${name}.txt`), 'x\n')
        sandbox.repo.git(['add', `${name}.txt`])
      }
      const res = await toAiTesting()
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('7 tracked file(s)')
      expect(res.stderr).toContain('    ...')
      expect(res.stderr).not.toContain('g.txt')
    })

    it('only warns about an untracked file', async () => {
      sandbox = await buildSandbox()
      writeFileSync(path.join(sandbox.repo.dir, 'scratch.txt'), 'notes\n')
      const res = await toAiTesting()
      expect(res.code).toBe(0)
      expect(res.stderr).toContain('Untracked files')
      expect(res.stderr).toContain('scratch.txt')
      expect(statusCalls()).toEqual(['update-status 42 AI testing'])
    })

    it('refuses a commit that origin does not have, and names git push', async () => {
      sandbox = await buildSandbox()
      sandbox.repo.commit('more.txt')
      const res = await toAiTesting()
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('1 commit(s) of feature/42-add-stuff')
      expect(res.stderr).toContain('Push them: git push')
      expect(statusCalls()).toEqual([])
    })

    it('refuses a branch that origin does not have, and names git push -u origin <branch>', async () => {
      sandbox = await buildSandbox()
      sandbox.repo.git(['push', 'origin', '--delete', 'feature/42-add-stuff'])
      const res = await toAiTesting()
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('feature/42-add-stuff is not on origin')
      expect(res.stderr).toContain('git push -u origin feature/42-add-stuff')
    })

    it('refuses a branch that origin has moved past, and names git pull --rebase', async () => {
      sandbox = await buildSandbox()
      const behind = sandbox.repo.git(['rev-parse', 'HEAD'])
      sandbox.repo.commit('later.txt')
      sandbox.repo.git(['push', 'origin', 'feature/42-add-stuff'])
      sandbox.repo.git(['reset', '--hard', behind])
      const res = await toAiTesting()
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('does not contain')
      expect(res.stderr).toContain('git pull --rebase')
    })

    it('refuses when origin cannot be read: an unverifiable push is not a push', async () => {
      sandbox = await buildSandbox()
      sandbox.repo.git(['remote', 'set-url', 'origin', path.join(sandbox.repo.dir, 'no-such-origin.git')])
      const res = await toAiTesting()
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('origin could not be read')
      expect(statusCalls()).toEqual([])
    })

    it('refuses a detached HEAD', async () => {
      sandbox = await buildSandbox()
      sandbox.repo.git(['checkout', '--detach'])
      const res = await toAiTesting()
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('HEAD is detached')
    })

    it('refuses a branch that delivers another ticket', async () => {
      sandbox = await buildSandbox({ branch: 'feature/43-other' })
      const res = await toAiTesting()
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('delivers another ticket')
    })

    it('matches the ticket number exactly: #4 is not on feature/42-…', async () => {
      sandbox = await buildSandbox()
      const res = await toAiTesting({}, '4')
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('delivers another ticket')
    })

    it('reads a fix branch as well', async () => {
      sandbox = await buildSandbox({ branch: 'fix/42-broken' })
      expect((await toAiTesting()).code).toBe(0)
    })
  })

  describe('in a directory that is not a git repository', () => {
    it('refuses, naming the hatch', async () => {
      sandbox = await buildSandbox()
      const lone = mkdtempSync(path.join(tmpdir(), 'sf-wfcli-nogit-'))
      try {
        await writeFile(path.join(lone, '.saasfoundry.json'), readFileSync(path.join(sandbox.repo.dir, '.saasfoundry.json')))
        await mkdir(path.join(lone, '.claude/skills/sf-tool-github-projects'), { recursive: true })
        copyFileSync(path.join(sandbox.repo.dir, '.claude/skills/sf-tool-github-projects/github-projects-cli.sh'), path.join(lone, '.claude/skills/sf-tool-github-projects/github-projects-cli.sh'))
        const res = await toAiTesting({ cwd: lone, env: { GIT_CEILING_DIRECTORIES: path.dirname(lone) } })
        expect(res.code).toBe(2)
        expect(res.stderr).toContain('not a git repository')
      } finally {
        rmSync(lone, { recursive: true, force: true })
      }
    })
  })

  describe('on a branch the host named (worktree-agent-<id>)', () => {
    const hostOnTicketTip = async () => {
      sandbox = await buildSandbox()
      sandbox.repo.git(['checkout', '-b', 'worktree-agent-abc123'])
    }

    it('lets it through when it is at the tip of the ticket branch on origin', async () => {
      await hostOnTicketTip()
      const res = await toAiTesting()
      expect(res.code).toBe(0)
      expect(statusCalls()).toEqual(['update-status 42 AI testing'])
    })

    it('names git push origin HEAD:<ticket branch> for a commit origin does not have', async () => {
      await hostOnTicketTip()
      sandbox.repo.commit('more.txt')
      const res = await toAiTesting()
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('Push them: git push origin HEAD:feature/42-add-stuff')
    })

    it('names the integration when origin moved past the host branch', async () => {
      await hostOnTicketTip()
      const behind = sandbox.repo.git(['rev-parse', 'HEAD'])
      sandbox.repo.commit('later.txt')
      sandbox.repo.git(['push', 'origin', 'HEAD:feature/42-add-stuff'])
      sandbox.repo.git(['reset', '--hard', behind])
      const res = await toAiTesting()
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('git pull --rebase origin feature/42-add-stuff && git push origin HEAD:feature/42-add-stuff')
    })

    it('refuses a modified tracked file and names the push to the ticket branch', async () => {
      await hostOnTicketTip()
      writeFileSync(path.join(sandbox.repo.dir, 'work.txt'), 'changed\n')
      const res = await toAiTesting()
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('&& git push origin HEAD:feature/42-add-stuff')
    })

    it('refuses when origin holds no branch of the ticket', async () => {
      await hostOnTicketTip()
      sandbox.repo.git(['push', 'origin', '--delete', 'feature/42-add-stuff'])
      const res = await toAiTesting()
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('origin holds no branch of #42')
      expect(res.stderr).toContain('git push origin HEAD:<branch>')
    })

    it('takes the branch at HEAD when origin holds several of the ticket', async () => {
      await hostOnTicketTip()
      sandbox.repo.git(['push', 'origin', 'HEAD:refs/heads/feature/42-older-attempt'])
      sandbox.repo.commit('more.txt')
      sandbox.repo.git(['push', 'origin', 'HEAD:refs/heads/feature/42-add-stuff'])
      const res = await toAiTesting()
      expect(res.code).toBe(0)
    })

    it('refuses when origin holds several branches of the ticket and none is at HEAD', async () => {
      await hostOnTicketTip()
      sandbox.repo.git(['push', 'origin', 'HEAD:refs/heads/feature/42-second'])
      sandbox.repo.commit('more.txt')
      const res = await toAiTesting()
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('several branches of #42')
    })
  })

  describe('from the primary checkout, on the working branch', () => {
    const onWorkingBranch = async () => {
      sandbox = await buildSandbox()
      sandbox.repo.git(['checkout', 'develop'])
    }

    it('inspects the worktree that holds the ticket branch, and names it when it is dirty', async () => {
      await onWorkingBranch()
      const worktree = sandbox.repo.addWorktree('feature/42-add-stuff')
      writeFileSync(path.join(worktree, 'work.txt'), 'changed in the worktree\n')
      const res = await toAiTesting()
      expect(res.code).toBe(2)
      expect(res.stderr).toContain(worktree)
      expect(res.stderr).toContain(`git -C ${worktree} add <paths>`)
      expect(statusCalls()).toEqual([])
    })

    it('names the push of the worktree for a commit origin does not have', async () => {
      await onWorkingBranch()
      const worktree = sandbox.repo.addWorktree('feature/42-add-stuff')
      sandbox.repo.commit('more.txt', 'more\n', worktree)
      const res = await toAiTesting()
      expect(res.code).toBe(2)
      expect(res.stderr).toContain(`Push them: git -C ${worktree} push`)
    })

    it('lets a clean, pushed worktree through', async () => {
      await onWorkingBranch()
      sandbox.repo.addWorktree('feature/42-add-stuff')
      const res = await toAiTesting()
      expect(res.code).toBe(0)
      expect(statusCalls()).toEqual(['update-status 42 AI testing'])
    })

    it('checks origin alone, and says so, when no worktree holds a branch of the ticket', async () => {
      await onWorkingBranch()
      const res = await toAiTesting()
      expect(res.code).toBe(0)
      expect(res.stderr).toContain('only origin was checked')
      expect(res.stderr).toContain('feature/42-add-stuff')
    })

    it('refuses when neither a worktree nor origin holds a branch of the ticket', async () => {
      await onWorkingBranch()
      sandbox.repo.git(['push', 'origin', '--delete', 'feature/42-add-stuff'])
      const res = await toAiTesting()
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('origin holds no branch of #42')
    })
  })

  describe('for a nature:bundled-pr child, whose commit lands on its delivery parent’s branch', () => {
    it('inspects the parent branch of this checkout', async () => {
      sandbox = await buildSandbox({ natureLabel: 'bundled-pr', parent: 41, branch: 'feature/41-parent' })
      const res = await toAiTesting()
      expect(res.code).toBe(0)
      expect(statusCalls()).toEqual(['update-status 42 AI testing'])
    })

    it('refuses an uncommitted change on the parent branch', async () => {
      sandbox = await buildSandbox({ natureLabel: 'bundled-pr', parent: 41, branch: 'feature/41-parent' })
      writeFileSync(path.join(sandbox.repo.dir, 'work.txt'), 'changed\n')
      const res = await toAiTesting()
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('work.txt')
    })

    it('refuses a checkout on the branch of an unrelated ticket', async () => {
      sandbox = await buildSandbox({ natureLabel: 'bundled-pr', parent: 41, branch: 'feature/43-other' })
      const res = await toAiTesting()
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('delivers another ticket')
    })
  })

  describe('the escape hatch and the other transitions', () => {
    it('SF_WORKFLOW_BYPASS_PUSHED_GUARD=1 lets an unpushed ticket through and announces it on the ticket', async () => {
      sandbox = await buildSandbox()
      sandbox.repo.commit('more.txt')
      const res = await toAiTesting({ env: { SF_WORKFLOW_BYPASS_PUSHED_GUARD: '1', SF_WORKFLOW_BYPASS_REASON: 'origin outage' } })
      expect(res.code).toBe(0)
      expect(res.stderr).toContain('SF_WORKFLOW_BYPASS_PUSHED_GUARD')
      expect(readLog(sandbox.toolLogPath).some((l) => l.startsWith('comment 42'))).toBe(true)
      expect(statusCalls()).toEqual(['update-status 42 AI testing'])
    })

    it.each(['In progress', 'Ready'])('does not look at the tree for a move to %s', async (target) => {
      sandbox = await buildSandbox()
      writeFileSync(path.join(sandbox.repo.dir, 'work.txt'), 'changed\n')
      const res = await runCli(['update-status', '42', target], sandbox)
      expect(res.code).toBe(0)
      expect(statusCalls()).toEqual([`update-status 42 ${target}`])
    })
  })
})
