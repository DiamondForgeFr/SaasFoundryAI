import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../..')
const RUNNER = path.join(ROOT, 'scaffolds/shared/validation/run-impact-validation.mjs')

/**
 * This suite itself runs inside the repository's pre-commit hook, which exports the hook's
 * `GIT_*` variables. The fixtures must not inherit them, or every git call below would act on
 * the contributor's own checkout.
 */
function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')))
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv() }).trim()
}

/** Every lane runs the same command: the fixture only needs one of them to execute. */
function validationConfig(script: string): string {
  const lanes = ['guards', 'docs', 'frontend', 'backend', 'shared', 'harnessScaffold', 'lifecycle', 'full']
  return JSON.stringify({ version: 1, profile: 'monorepo', commands: Object.fromEntries(lanes.map((lane) => [lane, [['npm', 'run', script]]])) })
}

/**
 * The validation command checks, from inside the snapshot, that git resolves the snapshot's own
 * repository directory (the one its `.git` file names) and that it sees the staged content.
 */
const SNAPSHOT_CHECK = `import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'

const own = readFileSync('.git', 'utf8').replace(/^gitdir: /, '').trim()
const used = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim()
if (realpathSync(resolve(own)) !== realpathSync(used)) {
  console.error('snapshot git directory: ' + used + ', expected ' + own)
  process.exit(3)
}
if (readFileSync('README.md', 'utf8') !== 'staged\\n') process.exit(4)
`

describe('staged impact validation from a real pre-commit hook (#1153)', () => {
  let fixture: string
  let main: string

  beforeEach(() => {
    fixture = realpathSync(mkdtempSync(path.join(tmpdir(), 'sf-hook-env-')))
    main = path.join(fixture, 'main')
    mkdirSync(path.join(main, '.saasfoundry'), { recursive: true })
    git(main, 'init', '-q')
    git(main, 'config', 'user.email', 'tests@example.com')
    git(main, 'config', 'user.name', 'Tests')
    writeFileSync(path.join(main, 'package.json'), JSON.stringify({ private: true, scripts: { check: 'node check.mjs' } }))
    writeFileSync(path.join(main, 'check.mjs'), SNAPSHOT_CHECK)
    writeFileSync(path.join(main, '.saasfoundry/validation.commit.json'), validationConfig('check'))
    writeFileSync(path.join(main, 'README.md'), 'base\n')
    git(main, 'add', '.')
    git(main, 'commit', '-qm', 'base')
    // A real hook: git runs it and exports its variables to it, as it does for husky.
    const hook = path.join(main, '.git/hooks/pre-commit')
    writeFileSync(hook, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(RUNNER)} --staged --config .saasfoundry/validation.commit.json\n`)
    chmodSync(hook, 0o755)
  })

  afterEach(() => rmSync(fixture, { recursive: true, force: true }))

  function commitFrom(checkout: string, cwd = checkout) {
    writeFileSync(path.join(checkout, 'README.md'), 'staged\n')
    git(checkout, 'add', 'README.md')
    return spawnSync('git', ['commit', '-m', 'staged change'], { cwd, encoding: 'utf8', env: cleanEnv() })
  }

  function expectCommitted(checkout: string, result: ReturnType<typeof commitFrom>) {
    // On failure, show what the hook printed rather than a bare status.
    expect({ status: result.status, stderr: result.status === 0 ? '' : result.stderr }).toEqual({ status: 0, stderr: '' })
    expect(git(checkout, 'log', '-1', '--format=%s')).toBe('staged change')
    expect(git(checkout, 'show', 'HEAD:README.md')).toBe('staged')
    // The index the commit used is the checkout's own, intact: nothing staged, nothing missing.
    expect(git(checkout, 'status', '--porcelain')).toBe('')
    expect(git(checkout, 'ls-files').split('\n').sort()).toEqual(['.saasfoundry/validation.commit.json', 'README.md', 'check.mjs', 'package.json'])
    // The temporary snapshot worktree is removed and unregistered.
    expect(git(main, 'worktree', 'list', '--porcelain')).not.toContain('sf-impact-staged-')
  }

  it('validates and commits from the main checkout', () => {
    expectCommitted(main, commitFrom(main))
  })

  it('validates and commits from a subdirectory, where git exports GIT_PREFIX', () => {
    mkdirSync(path.join(main, 'nested'))
    expectCommitted(main, commitFrom(main, path.join(main, 'nested')))
  })

  it('validates and commits from a linked worktree, where git exports GIT_DIR and an absolute GIT_INDEX_FILE', () => {
    const linked = path.join(fixture, 'linked')
    git(main, 'worktree', 'add', '-q', linked)
    expectCommitted(linked, commitFrom(linked))
  })

  it('still refuses the commit when the staged content fails, from a linked worktree', () => {
    const linked = path.join(fixture, 'linked')
    git(main, 'worktree', 'add', '-q', linked)
    writeFileSync(path.join(linked, 'README.md'), 'bad\n')
    git(linked, 'add', 'README.md')
    const result = spawnSync('git', ['commit', '-m', 'bad change'], { cwd: linked, encoding: 'utf8', env: cleanEnv() })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('npm exited with status 4')
    expect(git(linked, 'log', '-1', '--format=%s')).toBe('base')
    expect(readFileSync(path.join(linked, 'README.md'), 'utf8')).toBe('bad\n')
    expect(git(main, 'worktree', 'list', '--porcelain')).not.toContain('sf-impact-staged-')
  })
})

/**
 * An npm-workspaces layout as `npm install` leaves it: a root `node_modules` holding the hoisted
 * dependencies and a relative link to each workspace, and a workspace with its own nested
 * `node_modules` for the version it pins. The fixture builds that layout by hand, so the test
 * needs no registry.
 */
describe('staged impact validation in an npm-workspaces repository (#1027)', () => {
  let fixture: string
  let main: string

  function write(file: string, content: string) {
    mkdirSync(path.dirname(path.join(main, file)), { recursive: true })
    writeFileSync(path.join(main, file), content)
  }

  // Run in the snapshot: each import must resolve the way it does in the checkout, but against
  // the snapshot's own workspace sources.
  const WEB_CHECK = `const { realpathSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const root = realpathSync(path.resolve(__dirname, '../..'))
const fail = (code, message) => { console.error(message); process.exit(code) }
// The workspace's own pin, not the hoisted root version.
if (require('tool').version !== 'nested') fail(5, 'tool resolved ' + require('tool').version)
// A dependency only the root holds still resolves from the workspace.
if (require('root-only').version !== 'root') fail(6, 'root-only did not resolve')
// The workspace link reaches the snapshot's copy of the package, not the checkout's.
const shared = realpathSync(require.resolve('@fx/shared'))
if (!shared.startsWith(root + path.sep)) fail(7, 'shared resolved outside the snapshot: ' + shared)
if (require('@fx/shared').source !== 'staged') fail(8, 'shared is not the staged source')
writeFileSync(path.join(root, 'checked'), '')
`

  beforeEach(() => {
    fixture = realpathSync(mkdtempSync(path.join(tmpdir(), 'sf-workspaces-')))
    main = path.join(fixture, 'main')
    mkdirSync(main)
    git(main, 'init', '-q')
    git(main, 'config', 'user.email', 'tests@example.com')
    git(main, 'config', 'user.name', 'Tests')
    write('package.json', JSON.stringify({ private: true, workspaces: ['apps/*', 'packages/*'], scripts: { check: 'node apps/web/check.cjs' } }))
    write('.gitignore', 'node_modules/\nchecked\n')
    write('.saasfoundry/validation.commit.json', validationConfig('check'))
    write('apps/web/package.json', JSON.stringify({ name: '@fx/web', private: true }))
    write('apps/web/check.cjs', WEB_CHECK)
    write('packages/shared/package.json', JSON.stringify({ name: '@fx/shared', main: 'index.js' }))
    write('packages/shared/index.js', "exports.source = 'committed'\n")
    write('README.md', 'base\n')
    git(main, 'add', '.')
    git(main, 'commit', '-qm', 'base')

    write('node_modules/tool/index.js', "exports.version = 'root'\n")
    write('node_modules/root-only/index.js', "exports.version = 'root'\n")
    write('node_modules/.bin/.keep', '')
    mkdirSync(path.join(main, 'node_modules/@fx'))
    symlinkSync('../../packages/shared', path.join(main, 'node_modules/@fx/shared'))
    symlinkSync('../../apps/web', path.join(main, 'node_modules/@fx/web'))
    write('apps/web/node_modules/tool/index.js', "exports.version = 'nested'\n")
  })

  afterEach(() => rmSync(fixture, { recursive: true, force: true }))

  function validateStaged() {
    return spawnSync(process.execPath, [RUNNER, '--staged', '--config', '.saasfoundry/validation.commit.json'], { cwd: main, encoding: 'utf8', env: cleanEnv() })
  }

  it('resolves nested workspace dependencies and workspace links inside the snapshot', () => {
    write('packages/shared/index.js', "exports.source = 'staged'\n")
    git(main, 'add', 'packages/shared/index.js')
    // An unstaged edit the snapshot must not see.
    write('packages/shared/index.js', "exports.source = 'unstaged'\n")

    const result = validateStaged()
    expect({ status: result.status, stderr: result.status === 0 ? '' : result.stderr }).toEqual({ status: 0, stderr: '' })
    // The check ran in the snapshot, and nothing it wrote landed in the checkout.
    expect(existsSync(path.join(main, 'checked'))).toBe(false)
    expect(git(main, 'worktree', 'list', '--porcelain')).not.toContain('sf-impact-staged-')
  })

  it('leaves the checkout dependencies and sources intact after cleanup', () => {
    write('packages/shared/index.js', "exports.source = 'staged'\n")
    git(main, 'add', 'packages/shared/index.js')
    expect(validateStaged().status).toBe(0)
    expect(readFileSync(path.join(main, 'node_modules/tool/index.js'), 'utf8')).toContain('root')
    expect(readFileSync(path.join(main, 'apps/web/node_modules/tool/index.js'), 'utf8')).toContain('nested')
    expect(readlinkSync(path.join(main, 'node_modules/@fx/shared'))).toBe('../../packages/shared')
    expect(readFileSync(path.join(main, 'packages/shared/index.js'), 'utf8')).toContain('staged')
  })

  it('still fails when the staged workspace source is wrong', () => {
    // Nothing staged changes the shared source: the snapshot keeps 'committed', so the check refuses it.
    write('README.md', 'staged\n')
    git(main, 'add', 'README.md')
    const result = validateStaged()
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('npm exited with status 8')
  })
})
