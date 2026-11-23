import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * #1232 — an agent that could not reach GitHub committed 19 fixes as `fix(#TBD): …` on 19 local
 * `fix/audit-<slug>` branches and pushed nothing. The commit hooks now refuse both: commitlint a
 * ticket reference that is no number, the pre-commit and pre-push hooks a branch the workflow does
 * not name. These specs run the generated hooks (monorepo root, both multirepo apps) and this
 * repository's own, the way husky runs them (`sh -e <hook>`), in throwaway repositories.
 */
const ROOT = path.resolve(__dirname, '../../../..')
const HOOK_DIRS = ['scaffolds/overlays/monorepo/root/.husky', 'scaffolds/overlays/multirepo/api/.husky', 'scaffolds/overlays/multirepo/web/.husky', '.husky']
const COMMITLINT_CONFIGS = [
  'commitlint.config.mjs',
  'scaffolds/overlays/monorepo/root/commitlint.config.mjs',
  'scaffolds/overlays/multirepo/api/commitlint.config.mjs',
  'scaffolds/overlays/multirepo/web/commitlint.config.js'
]
const COMMITLINT_CLI = path.join(ROOT, 'node_modules/@commitlint/cli/cli.js')

// Every case runs git and the hooks in real repositories: a few seconds each under load.
jest.setTimeout(60_000)

const MANIFEST = {
  mainBranch: 'main',
  workflow: {
    workingBranch: 'develop',
    prTargetBranch: 'develop',
    releaseBranch: 'main',
    branchNaming: { feature: 'feature/{N}-{description}', fix: 'fix/{N}-{description}', release: 'rc-{version}' }
  }
}

/** The suite can run inside a git hook that exports `GIT_*`: the fixtures must not inherit them. */
function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_') && !name.startsWith('SF_WORKFLOW_BYPASS_')))
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

describe('the ticket reference of a commit (#1232)', () => {
  let dir: string

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'sf-commitlint-ticket-')))
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  function lint(message: string): SpawnSyncReturns<string> {
    const file = path.join(dir, 'MSG')
    writeFileSync(file, `${message}\n`)
    return spawnSync(process.execPath, [COMMITLINT_CLI, '--config', path.join(ROOT, 'commitlint.config.mjs'), '--edit', file], {
      cwd: ROOT,
      encoding: 'utf8',
      env: cleanEnv()
    })
  }

  it('is one commitlint configuration, in the generated projects and in this repository', () => {
    const [reference, ...copies] = COMMITLINT_CONFIGS.map((file) => readFileSync(path.join(ROOT, file), 'utf8'))
    expect(reference).toContain("'ticket-reference': [2, 'always']")
    for (const copy of copies) expect(copy).toBe(reference)
  })

  it.each(['fix(#TBD): cache the session', 'fix(#XXX): cache the session', 'feat(#12a): cache the session', 'fix(TBD): cache the session'])('refuses %s', (message) => {
    const run = lint(message)
    expect(run.status).not.toBe(0)
    expect(run.stdout).toContain('[ticket-reference]')
    expect(run.stdout).toContain('the scope must be the number of an existing ticket')
  })

  it('accepts fix(#1232): …', () => {
    const run = lint('fix(#1232): refuse a commit under a placeholder ticket')
    expect(run.stdout).not.toContain('✖')
    expect(run.status).toBe(0)
  })
})

describe('the branch guard files', () => {
  it('ship one guard and one pre-commit hook, identical in every generated project and here', () => {
    const guards = HOOK_DIRS.map((dir) => readFileSync(path.join(ROOT, dir, 'workflow-branch-guard.mjs'), 'utf8'))
    for (const guard of guards) expect(guard).toBe(guards[0])
    const generated = HOOK_DIRS.slice(0, 3).map((dir) => readFileSync(path.join(ROOT, dir, 'pre-commit'), 'utf8'))
    for (const hook of generated) expect(hook).toBe(generated[0])
    for (const dir of HOOK_DIRS) {
      expect(readFileSync(path.join(ROOT, dir, 'pre-commit'), 'utf8')).toContain('node "$sf_branch_guard" commit')
      expect(readFileSync(path.join(ROOT, dir, 'pre-push'), 'utf8')).toContain('node "$sf_branch_guard" push')
    }
  })
})

describe.each(HOOK_DIRS)('%s branch guard (#1232)', (hookDir) => {
  let fixture: string
  let repo: string
  let remote: string
  let env: NodeJS.ProcessEnv

  /** A repository at `relative` under the fixture, with the hooks installed the way husky 9 runs them. */
  function createRepo(relative: string, manifest: unknown = MANIFEST, manifestDir = relative): string {
    const dir = path.join(fixture, relative)
    mkdirSync(dir, { recursive: true })
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'config', 'user.email', 'tests@example.com')
    git(dir, 'config', 'user.name', 'Tests')
    git(dir, 'config', 'commit.gpgsign', 'false')
    git(dir, 'remote', 'add', 'origin', remote)
    if (manifest !== undefined) writeFileSync(path.join(fixture, manifestDir, '.saasfoundry.json'), JSON.stringify(manifest))
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.3.0' }))
    writeFileSync(path.join(dir, '.gitignore'), '.saasfoundry.json\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '--no-verify', '-m', 'chore(#1): base')
    const hooks = path.join(fixture, `hooks-${relative.replace(/[^A-Za-z0-9]/g, '_')}`)
    mkdirSync(hooks, { recursive: true })
    for (const name of ['pre-commit', 'pre-push']) {
      writeFileSync(path.join(hooks, name), `#!/bin/sh\nsh -e '${path.join(ROOT, hookDir, name)}' "$@"\n`)
      chmodSync(path.join(hooks, name), 0o755)
    }
    git(dir, 'config', 'core.hooksPath', hooks)
    return dir
  }

  function run(cwd: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> {
    return spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...env, ...extraEnv } })
  }

  const commit = (cwd: string, extraEnv?: NodeJS.ProcessEnv) => run(cwd, ['commit', '-q', '--allow-empty', '-m', 'fix(#1232): change'], extraEnv)

  beforeEach(() => {
    fixture = realpathSync(mkdtempSync(path.join(tmpdir(), 'sf-branch-guard-')))
    remote = path.join(fixture, 'remote.git')
    git(fixture, 'init', '-q', '--bare', remote)
    // The pre-commit hooks then run `npm run test:staged`: a stub stands for it.
    const bin = path.join(fixture, 'bin')
    mkdirSync(bin)
    writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nexit 0\n')
    chmodSync(path.join(bin, 'npm'), 0o755)
    env = { ...cleanEnv(), PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` }
    repo = createRepo('repo')
  })

  afterEach(() => rmSync(fixture, { recursive: true, force: true }))

  it('refuses a commit on a branch the workflow does not name', () => {
    git(repo, 'checkout', '-q', '-b', 'fix/audit-session-cache')
    const result = commit(repo)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Workflow branch guard (#1232): commit refused on "fix/audit-session-cache"')
    expect(result.stderr).toContain('feature/{N}-{description}, fix/{N}-{description}, rc-{version}')
    expect(result.stderr).toContain('git branch -m feature/<N>-<description>')
    expect(result.stderr).toContain('SF_WORKFLOW_BYPASS_BRANCH_GUARD=1')
    expect(git(repo, 'log', '--format=%s')).toBe('chore(#1): base')
  })

  it.each(['fix/1232-refuse-placeholder-tickets', 'feature/12-dashboard', 'develop', 'main', 'rc-1.3.0', 'worktree-agent-a742ddcd82951fdf5'])('accepts a commit on %s', (branch) => {
    if (branch !== 'main') git(repo, 'checkout', '-q', '-b', branch)
    const result = commit(repo)
    expect(result.stderr).not.toContain('Workflow branch guard')
    expect(result.status).toBe(0)
  })

  it('accepts a commit on a detached HEAD, as every rebase step makes (#1227)', () => {
    git(repo, 'checkout', '-q', '--detach')
    const result = commit(repo)
    expect(result.stderr).not.toContain('Workflow branch guard')
    expect(result.status).toBe(0)
  })

  it('checks the pushed name: a host-named agent branch pushes to its ticket branch, not under its own name', () => {
    git(repo, 'checkout', '-q', '-b', 'worktree-agent-a742ddcd82951fdf5')
    expect(commit(repo).status).toBe(0)

    const own = run(repo, ['push', '-q', 'origin', 'worktree-agent-a742ddcd82951fdf5'])
    expect(own.status).not.toBe(0)
    expect(own.stderr).toContain('Workflow branch guard (#1232): push refused on "worktree-agent-a742ddcd82951fdf5"')
    expect(own.stderr).toContain('git push origin HEAD:feature/<N>-<description>')

    const ticket = run(repo, ['push', '-q', 'origin', 'HEAD:refs/heads/fix/1232-refuse-placeholder-tickets'])
    expect(ticket.stderr).not.toContain('Workflow branch guard')
    expect(ticket.status).toBe(0)
    expect(git(remote, 'branch', '--format=%(refname:short)')).toBe('fix/1232-refuse-placeholder-tickets')
  })

  it('refuses a push to an unnamed branch, from a detached HEAD as well', () => {
    git(repo, 'checkout', '-q', '--detach')
    const result = run(repo, ['push', '-q', 'origin', 'HEAD:refs/heads/fix/audit-session-cache'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('push refused on "fix/audit-session-cache"')
    expect(git(remote, 'branch', '--format=%(refname:short)')).toBe('')
  })

  it('accepts the long-lived branches, a release candidate and a tag at push', () => {
    git(repo, 'branch', 'develop')
    git(repo, 'branch', 'rc-1.3.0')
    git(repo, 'tag', 'v0.0.1')
    for (const ref of ['main', 'develop', 'rc-1.3.0', 'v0.0.1']) {
      const result = run(repo, ['push', '-q', 'origin', ref])
      expect({ ref, stderr: result.stderr.includes('Workflow branch guard') }).toEqual({ ref, stderr: false })
    }
  })

  it('lets the developer apply the hatch, never inside the worktree of a delegated agent', () => {
    git(repo, 'checkout', '-q', '-b', 'fix/audit-session-cache')
    const hatch = { SF_WORKFLOW_BYPASS_BRANCH_GUARD: '1', SF_WORKFLOW_BYPASS_REASON: 'developer hotfix' }
    const applied = commit(repo, hatch)
    expect(applied.status).toBe(0)
    expect(applied.stderr).toContain('SF_WORKFLOW_BYPASS_BRANCH_GUARD set')
    expect(applied.stderr).toContain('developer hotfix')

    const worktree = createRepo('primary/.claude/worktrees/agent-1')
    git(worktree, 'checkout', '-q', '-b', 'fix/audit-session-cache')
    const refused = commit(worktree, hatch)
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toContain('is ignored in the worktree of a delegated agent')
  })

  it('follows the branch naming the manifest declares', () => {
    const custom = createRepo('custom', { mainBranch: 'main', workflow: { workingBranch: 'dev', branchNaming: { feature: 'feat/{N}_{description}' } } })
    git(custom, 'checkout', '-q', '-b', 'feat/12_dashboard')
    expect(commit(custom).status).toBe(0)
    git(custom, 'checkout', '-q', '-b', 'feature/12-dashboard')
    expect(commit(custom).stderr).toContain('commit refused on "feature/12-dashboard"')
  })

  it('reads the manifest of the project around a multirepo app', () => {
    mkdirSync(path.join(fixture, 'project/apps'), { recursive: true })
    const app = createRepo('project/apps/shop-api', MANIFEST, 'project')
    git(app, 'checkout', '-q', '-b', 'fix/audit-session-cache')
    expect(commit(app).stderr).toContain('commit refused on "fix/audit-session-cache"')
  })

  it('checks nothing in a project with no workflow configured', () => {
    const bare = createRepo('bare', { mainBranch: 'main' })
    git(bare, 'checkout', '-q', '-b', 'anything-goes')
    expect(commit(bare).status).toBe(0)
  })
})
