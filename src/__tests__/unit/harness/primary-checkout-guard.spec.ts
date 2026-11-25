import { execFileSync } from 'child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { checkoutKind, type CheckoutKind } from '../../../harness/checkout-kind'
import { readGuardSettings } from '../../../harness/shell-guard-mode'
import { evaluateToolCall, type GuardDecision, type ToolCall } from '../../../harness/tool-call-guard'

// #1332 — two leads of different hosts ran in one folder; one stashed the developer's change and switched the shared
// checkout to its ticket branch under the other. The guard keeps the primary checkout on the working branch: it refuses
// a branch switch or a stash there, never in a linked worktree, and names the worktree command to use instead.

const PRIMARY = '/work/project'
const LINKED = '/work/project-1332'
/** A fake resolver: the primary checkout is `/work/project`, everything under `/work/project-1332` is a linked worktree. */
const kinds = (dir: string): CheckoutKind | undefined => (dir === LINKED || dir.startsWith(`${LINKED}/`) ? 'linked' : dir === PRIMARY || dir.startsWith(`${PRIMARY}/`) ? 'primary' : undefined)

const call = (command: string, extra: Partial<ToolCall> = {}): ToolCall => ({
  host: 'claude-code',
  toolName: 'Bash',
  command,
  cwd: PRIMARY,
  shellShape: 'off',
  workingBranch: 'develop',
  checkoutOf: kinds,
  ...extra
})
const decide = (command: string, extra: Partial<ToolCall> = {}): GuardDecision | undefined => evaluateToolCall(call(command, extra))
const refused = (command: string, extra: Partial<ToolCall> = {}): boolean => decide(command, extra)?.rule === 'primary-checkout'

describe('the primary checkout rule', () => {
  describe('in the primary checkout', () => {
    it.each([
      'git checkout fix/1985-agent-opened-download-consent',
      'git checkout -b fix/1332-x',
      'git checkout -B fix/1332-x origin/develop',
      'git checkout -bfix/1332-x',
      'git checkout --orphan gh-pages',
      'git checkout --detach',
      'git checkout -',
      'git checkout -f main',
      'git checkout HEAD~1',
      'git checkout -t origin/feature/x',
      'git switch fix/1332-x',
      'git switch -c fix/1332-x',
      'git switch --create fix/1332-x origin/develop',
      'git switch -Cfix/1332-x',
      'git switch --detach HEAD~2',
      'git switch -',
      'git switch develop --detach',
      'git stash',
      'git stash push -m "mt1985 preexisting claude settings"',
      'git stash -u',
      'git stash save wip',
      'git stash pop',
      'git stash apply stash@{0}',
      'git stash drop',
      'git stash clear',
      'git stash branch fix/1332-x'
    ])('refuses %s', (command) => {
      expect(refused(command)).toBe(true)
    })

    it.each([
      'git checkout develop',
      'git switch develop',
      'git checkout -- src/index.ts',
      'git checkout -- .',
      'git checkout origin/develop -- package.json',
      'git checkout HEAD -- src/a.ts src/b.ts',
      'git checkout .',
      'git checkout ./src/index.ts',
      'git checkout .env',
      'git checkout src/*.ts',
      'git checkout /work/project/src/index.ts',
      'git checkout main src/index.ts',
      'git checkout -p src/index.ts',
      'git checkout --pathspec-from-file=paths.txt',
      'git checkout HEAD',
      'git checkout',
      'git checkout --help',
      'git switch -h',
      'git stash list',
      'git stash show -p stash@{0}',
      'git stash create',
      'git stash store -m x abc123',
      'git status',
      'git log --oneline -5',
      'git branch --show-current',
      'git worktree add ../project-1332 -b fix/1332-x origin/develop',
      'git fetch origin',
      'git restore src/index.ts',
      'echo git checkout feature',
      'grep -n "git stash" docs/a.md'
    ])('leaves %s alone', (command) => {
      expect(refused(command)).toBe(false)
    })

    it('refuses a plain file name without `--`, which git could read as a branch, and says how to restore a file', () => {
      const decision = decide('git checkout README')
      expect(decision?.rule).toBe('primary-checkout')
      expect(decision?.reason).toContain('`git checkout -- <path>`')
      expect(decision?.reason).toContain('`git restore <path>`')
    })

    it('reads the working branch from the call: without one, every switch is refused', () => {
      expect(refused('git checkout main', { workingBranch: 'main' })).toBe(false)
      expect(refused('git checkout develop', { workingBranch: 'main' })).toBe(true)
      expect(refused('git checkout develop', { workingBranch: undefined })).toBe(true)
    })

    it('applies to every caller: the session, a delegated agent, and both hosts', () => {
      expect(refused('git switch fix/x', { agentId: 'agent-a1' })).toBe(true)
      expect(refused('git switch fix/x', { host: 'codex', toolName: 'exec_command' })).toBe(true)
      expect(refused('git stash', { shellShape: 'refuse' })).toBe(true)
    })

    it('follows the git options in front of the subcommand', () => {
      expect(refused('git -c core.pager=cat checkout fix/x')).toBe(true)
      expect(refused('git --no-pager stash')).toBe(true)
      expect(refused('env GIT_TRACE=1 git switch fix/x')).toBe(true)
    })
  })

  describe('where the command runs', () => {
    it('leaves a linked worktree alone, by its working directory or by `git -C`', () => {
      expect(refused('git checkout -b fix/1332-x origin/develop', { cwd: LINKED })).toBe(false)
      expect(refused('git stash pop', { cwd: `${LINKED}/src` })).toBe(false)
      expect(refused(`git -C ${LINKED} switch fix/x`)).toBe(false)
      expect(refused('git -C ../project-1332 switch fix/x')).toBe(false)
    })

    it('follows `git -C` and `cd` into the primary checkout', () => {
      expect(refused(`git -C ${PRIMARY} switch fix/x`, { cwd: LINKED })).toBe(true)
      expect(refused('git -C ../project stash', { cwd: LINKED })).toBe(true)
      expect(refused(`cd ${PRIMARY} && git checkout fix/x`, { cwd: LINKED })).toBe(true)
      expect(refused(`cd ${LINKED} && git checkout fix/x`)).toBe(false)
    })

    it('does not guess: another repository, an unknown directory or no resolver lets the call through', () => {
      expect(refused('git --git-dir=/elsewhere/.git checkout fix/x')).toBe(false)
      expect(refused('git --work-tree /elsewhere checkout fix/x')).toBe(false)
      expect(refused('cd ~/other && git checkout fix/x')).toBe(false)
      expect(refused('git checkout fix/x', { cwd: '/tmp/not-a-checkout' })).toBe(false)
      expect(refused('git checkout fix/x', { checkoutOf: undefined })).toBe(false)
      expect(refused('git checkout fix/x', { cwd: undefined })).toBe(false)
    })
  })

  describe('the reason', () => {
    it('names the checkout, the working branch and the worktree command to use instead, one command per call', () => {
      const reason = decide('git checkout -b fix/1332-x')!.reason
      expect(reason).toMatch(/^Refused by the SaaSFoundry guard hook: this command changes the branch of the primary checkout \(\/work\/project\)/)
      expect(reason).toContain('working branch `develop`')
      expect(reason).toContain('`git fetch origin`, then `git worktree add <path> -b <ticket branch> origin/develop`')
      expect(reason).toContain('a trivial change included')
    })

    it('says a stash moves changes that are not the agent’s', () => {
      const reason = decide('git stash push -m wip')!.reason
      expect(reason).toContain('moves uncommitted changes of the primary checkout (/work/project) through the stash')
      expect(reason).toContain('not yours to set aside, reapply or drop')
      expect(reason).toContain('git worktree add')
      expect(reason).not.toContain('git restore')
    })

    it('never tells the agent a way around the guard', () => {
      for (const command of ['git checkout fix/x', 'git stash']) {
        expect(decide(command)!.reason).not.toMatch(/--no-verify|SF_WORKFLOW_BYPASS|escape hatch|shell-guard|disableAllHooks/i)
      }
    })
  })

  it('leaves the escape hatch rules first', () => {
    expect(decide('SF_WORKFLOW_BYPASS_X=1 git stash')?.rule).toBe('bypass-variable')
  })
})

describe('checkoutKind', () => {
  let root: string
  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'sf-checkout-kind-')))
    // a hook that runs the suite may export GIT_DIR or GIT_INDEX_FILE: they would point these commands at this repository
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
    const git = (args: string[]): void => {
      execFileSync('git', args, { cwd: root, stdio: 'ignore', env })
    }
    await mkdir(join(root, 'primary'))
    git(['-C', 'primary', 'init', '-q', '-b', 'develop'])
    await writeFile(join(root, 'primary', 'a.txt'), 'a\n')
    git(['-C', 'primary', 'add', 'a.txt'])
    git(['-C', 'primary', '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'])
    git(['-C', 'primary', 'worktree', 'add', '-q', '-b', 'fix/1332-x', join(root, 'linked')])
    await mkdir(join(root, 'primary', 'src', 'deep'), { recursive: true })
    await mkdir(join(root, 'linked', 'src'), { recursive: true })
    await mkdir(join(root, 'plain'))
    // a submodule-like checkout: a `.git` file that does not point into `worktrees/`
    await mkdir(join(root, 'module'))
    await writeFile(join(root, 'module', '.git'), 'gitdir: ../primary/.git/modules/module\n')
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('tells the primary checkout from a linked worktree, from any directory inside them', () => {
    expect(checkoutKind(join(root, 'primary'))).toBe('primary')
    expect(checkoutKind(join(root, 'primary', 'src', 'deep'))).toBe('primary')
    expect(checkoutKind(join(root, 'linked'))).toBe('linked')
    expect(checkoutKind(join(root, 'linked', 'src'))).toBe('linked')
  })

  it('says nothing outside a checkout or for a `.git` file that is not a linked worktree', () => {
    expect(checkoutKind(join(root, 'module'))).toBeUndefined()
  })

  it('drives the rule end to end on real checkouts', () => {
    const real = (command: string, cwd: string): boolean =>
      evaluateToolCall({ host: 'claude-code', toolName: 'Bash', command, cwd, workingBranch: 'develop', checkoutOf: checkoutKind })?.rule === 'primary-checkout'
    expect(real('git switch fix/other', join(root, 'primary'))).toBe(true)
    expect(real('git stash', join(root, 'primary', 'src'))).toBe(true)
    expect(real('git switch fix/other', join(root, 'linked'))).toBe(false)
    expect(real('git stash', join(root, 'linked'))).toBe(false)
  })
})

describe('readGuardSettings', () => {
  let root: string
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-guard-settings-'))
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reads the working branch next to the shell shape mode, from the nearest manifest', async () => {
    await writeFile(join(root, '.saasfoundry.json'), JSON.stringify({ workflow: { workingBranch: 'develop' }, modules: { harness: { guard: { shellShape: 'warn' } } } }))
    await mkdir(join(root, 'sub'), { recursive: true })
    expect(readGuardSettings(join(root, 'sub'), undefined)).toEqual({ shellShape: 'warn', workingBranch: 'develop' })
  })

  it('names no working branch when the manifest records none, or one that is not a plain branch name', async () => {
    await writeFile(join(root, '.saasfoundry.json'), JSON.stringify({ workflow: { workingBranch: 'a b; rm -rf' } }))
    expect(readGuardSettings(root, undefined)).toEqual({ shellShape: 'refuse' })
    await writeFile(join(root, '.saasfoundry.json'), JSON.stringify({}))
    expect(readGuardSettings(root, undefined)).toEqual({ shellShape: 'refuse' })
  })
})
