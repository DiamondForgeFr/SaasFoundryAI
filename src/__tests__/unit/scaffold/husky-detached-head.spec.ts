import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../..')

/**
 * Every copy of the two hooks that read the current branch: the three generated ones (monorepo
 * root and both multirepo apps) and this repository's own (#1227).
 */
const HOOK_DIRS = ['scaffolds/overlays/monorepo/root/.husky', 'scaffolds/overlays/multirepo/api/.husky', 'scaffolds/overlays/multirepo/web/.husky', '.husky']

/**
 * This suite can run inside the repository's own pre-commit hook, which exports the hook's
 * `GIT_*` variables: the fixtures must not inherit them, or git would act on the contributor's
 * checkout.
 */
function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')))
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function gitResult(cwd: string, ...args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...cleanEnv(), GIT_EDITOR: 'true' } })
}

/** Husky 9 runs each hook as `sh -e <hook> "$@"`: the wrappers below do the same. */
function installHooks(hooksPath: string, hookDir: string): void {
  mkdirSync(hooksPath, { recursive: true })
  for (const name of ['prepare-commit-msg', 'pre-push']) {
    const wrapper = path.join(hooksPath, name)
    writeFileSync(wrapper, `#!/bin/sh\nsh -e '${path.join(ROOT, hookDir, name)}' "$@"\n`)
    chmodSync(wrapper, 0o755)
  }
}

describe.each(HOOK_DIRS)('%s on a detached HEAD (#1227)', (hookDir) => {
  let fixture: string
  let repo: string

  beforeEach(() => {
    fixture = realpathSync(mkdtempSync(path.join(tmpdir(), 'sf-husky-detached-')))
    repo = path.join(fixture, 'repo')
    mkdirSync(repo)
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.email', 'tests@example.com')
    git(repo, 'config', 'user.name', 'Tests')
    git(repo, 'config', 'commit.gpgsign', 'false')
    writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ version: '1.0.0' }))
    writeFileSync(path.join(repo, 'file.txt'), 'base\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'base')
    git(repo, 'checkout', '-q', '-b', 'feature/1-change')
    writeFileSync(path.join(repo, 'file.txt'), 'feature\n')
    git(repo, 'commit', '-q', '-am', 'feature change')
    git(repo, 'checkout', '-q', 'main')
    writeFileSync(path.join(repo, 'file.txt'), 'main\n')
    git(repo, 'commit', '-q', '-am', 'main change')
    git(repo, 'checkout', '-q', 'feature/1-change')
    installHooks(path.join(fixture, 'hooks'), hookDir)
    git(repo, 'config', 'core.hooksPath', path.join(fixture, 'hooks'))
  })

  afterEach(() => rmSync(fixture, { recursive: true, force: true }))

  it('lets a rebase that stopped on a conflict continue', () => {
    const rebase = gitResult(repo, 'rebase', 'main')
    expect(rebase.status).not.toBe(0)
    expect(gitResult(repo, 'symbolic-ref', '-q', 'HEAD').status).not.toBe(0)

    writeFileSync(path.join(repo, 'file.txt'), 'resolved\n')
    git(repo, 'add', 'file.txt')
    const resume = gitResult(repo, 'rebase', '--continue')

    expect(resume.stderr).not.toContain('prepare-commit-msg script failed')
    expect(resume.status).toBe(0)
    expect(git(repo, 'symbolic-ref', '--short', 'HEAD')).toBe('feature/1-change')
    expect(git(repo, 'log', '--format=%s', 'main..HEAD')).toBe('feature change')
    expect(readFileSync(path.join(repo, 'file.txt'), 'utf8')).toBe('resolved\n')
  })

  it('lets a commit and a push from a detached HEAD through', () => {
    git(fixture, 'init', '-q', '--bare', 'remote.git')
    git(repo, 'remote', 'add', 'origin', path.join(fixture, 'remote.git'))
    git(repo, 'checkout', '-q', '--detach')
    writeFileSync(path.join(repo, 'file.txt'), 'detached\n')

    const commit = gitResult(repo, 'commit', '-q', '-am', 'detached change')
    expect(commit.stderr).not.toContain('script failed')
    expect(commit.status).toBe(0)

    const push = gitResult(repo, 'push', '-q', 'origin', 'HEAD:refs/heads/feature/1-change')
    expect(push.stderr).not.toContain('script failed')
    expect(push.status).toBe(0)
    expect(git(path.join(fixture, 'remote.git'), 'log', '-1', '--format=%s', 'feature/1-change')).toBe('detached change')
  })

  it('still reports the release candidate branch it is on', () => {
    const hook = path.join(ROOT, hookDir, 'prepare-commit-msg')
    git(repo, 'checkout', '-q', '-b', 'rc-1.0.0')
    writeFileSync(path.join(fixture, 'MSG'), 'chore(#1): release\n')
    const out = execFileSync('bash', ['-e', hook, path.join(fixture, 'MSG')], { cwd: repo, encoding: 'utf8', env: cleanEnv() })
    expect(out).toContain('Release candidate branch detected (rc-1.0.0)')
  })
})
