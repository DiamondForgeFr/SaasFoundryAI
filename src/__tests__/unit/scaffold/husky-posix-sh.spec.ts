import { type SpawnSyncReturns } from 'node:child_process'
import { execFileSync, spawnSync } from '../../helpers/bounded-child'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../..')

/** The generated hook folders (monorepo root, both multirepo apps) and this repository's own (#1238). */
const HOOK_DIRS = ['scaffolds/overlays/monorepo/root/.husky', 'scaffolds/overlays/multirepo/api/.husky', 'scaffolds/overlays/multirepo/web/.husky', '.husky']

/**
 * Husky 9 runs each hook as `sh -e <hook>`. On macOS `sh` is bash in POSIX mode, which accepts
 * bash-only tests; on Debian, Ubuntu and most Linux CI images it is dash, which does not. The
 * hooks run under both: `sh` everywhere, `dash` where it is installed.
 */
const HAS_DASH = spawnSync('dash', ['-c', 'exit 0']).status === 0
const SHELLS = HAS_DASH ? ['sh', 'dash'] : ['sh']

if (!HAS_DASH) {
  console.warn('husky-posix-sh.spec: dash is not installed, so the hooks run under sh only. Install dash to cover Linux hosts.')
}

/** The suite can run inside a git hook that exports `GIT_*`: the fixtures must not inherit them. */
function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')))
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

describe('husky hooks hold no bash-only syntax (#1238)', () => {
  it.each(HOOK_DIRS)('%s', (hookDir) => {
    const dir = path.join(ROOT, hookDir)
    const hooks = readdirSync(dir).filter((name) => statSync(path.join(dir, name)).isFile())
    expect(hooks).toEqual(expect.arrayContaining(['prepare-commit-msg', 'pre-push']))
    for (const name of hooks) {
      const source = readFileSync(path.join(dir, name), 'utf8')
      expect({ hook: name, hasDoubleBracket: source.includes('[['), hasRegexMatch: source.includes('=~') }).toEqual({
        hook: name,
        hasDoubleBracket: false,
        hasRegexMatch: false
      })
    }
  })
})

describe.each(SHELLS.flatMap((shell) => HOOK_DIRS.map((hookDir) => [shell, hookDir] as const)))('%s -e %s (#1238)', (shell, hookDir) => {
  const isDogfood = hookDir === '.husky'
  let fixture: string
  let repo: string
  let remote: string
  let env: NodeJS.ProcessEnv

  /** Runs one hook the way husky does, on the branch the fixture is on. */
  function runHook(name: string, ...args: string[]): SpawnSyncReturns<string> {
    return spawnSync(shell, ['-e', path.join(ROOT, hookDir, name), ...args], { cwd: repo, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
  }

  function checkout(branch: string): void {
    git(repo, 'checkout', '-q', '-b', branch)
    git(repo, 'push', '-q', '-u', 'origin', branch)
  }

  beforeEach(() => {
    fixture = realpathSync(mkdtempSync(path.join(tmpdir(), 'sf-husky-posix-')))
    repo = path.join(fixture, 'repo')
    remote = path.join(fixture, 'remote.git')
    mkdirSync(repo)
    git(fixture, 'init', '-q', '--bare', remote)
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.email', 'tests@example.com')
    git(repo, 'config', 'user.name', 'Tests')
    git(repo, 'config', 'commit.gpgsign', 'false')
    git(repo, 'remote', 'add', 'origin', remote)
    writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ version: '1.0.0' }))
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'base')

    // The generated pre-push hands an rc-* push to `npm run version:manage`: a stub records the call.
    const bin = path.join(fixture, 'bin')
    mkdirSync(bin)
    writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\necho "stub npm $*"\n')
    chmodSync(path.join(bin, 'npm'), 0o755)
    env = { ...cleanEnv(), PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` }

    writeFileSync(path.join(fixture, 'MSG'), 'chore(#1): change\n')
  })

  afterEach(() => rmSync(fixture, { recursive: true, force: true }))

  it('prepare-commit-msg reports an rc-* branch', () => {
    checkout('rc-1.0.0')
    const run = runHook('prepare-commit-msg', path.join(fixture, 'MSG'))
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('Release candidate branch detected (rc-1.0.0)')
  })

  it('prepare-commit-msg stays silent off an rc-* branch', () => {
    checkout('feature/1-change')
    const run = runHook('prepare-commit-msg', path.join(fixture, 'MSG'))
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('')
  })

  it('pre-push runs the release checks on an rc-* branch', () => {
    checkout('rc-1.0.0')
    const run = runHook('pre-push', 'origin', remote)
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('Release candidate branch detected: rc-1.0.0')
    expect(run.stdout).not.toContain('This is not a release candidate branch.')
    expect(run.stdout).toContain(isDogfood ? 'RC version is committed and v1.0.0 is still available.' : 'stub npm run version:manage')
  })

  it('pre-push skips the release checks off an rc-* branch', () => {
    checkout('feature/1-change')
    const run = runHook('pre-push', 'origin', remote)
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('This is not a release candidate branch.')
    expect(run.stdout).not.toContain('Release candidate branch detected')
    expect(run.stdout).not.toContain('stub npm')
  })

  if (isDogfood) {
    it('pre-push refuses an rc-* branch whose name is no version', () => {
      checkout('rc-next')
      const run = runHook('pre-push', 'origin', remote)
      expect(run.status).toBe(1)
      expect(run.stdout).toContain('Invalid release branch name. Expected rc-X.Y.Z, got rc-next.')
    })

    it('pre-push accepts a prerelease version and refuses one package.json does not hold', () => {
      checkout('rc-1.0.1-beta.1')
      const run = runHook('pre-push', 'origin', remote)
      expect(run.stdout).not.toContain('Invalid release branch name')
      expect(run.status).toBe(1)
      expect(run.stdout).toContain('Release version mismatch: rc-1.0.1-beta.1 expects 1.0.1-beta.1, package.json contains 1.0.0.')
    })

    it('pre-push refuses an rc-* version whose tag is already published', () => {
      checkout('rc-1.0.0')
      git(repo, 'tag', 'v1.0.0')
      git(repo, 'push', '-q', 'origin', 'v1.0.0')
      const run = runHook('pre-push', 'origin', remote)
      expect(run.status).toBe(1)
      expect(run.stdout).toContain('Tag v1.0.0 already exists on origin')
    })
  }
})
