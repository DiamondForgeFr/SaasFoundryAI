import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * #1317 — git runs a hook with the PATH of the process that commits. A GUI client or a coding
 * agent's non-login shell often has the machine's default Node first (22, with npm 10), while a
 * generated project pins Node 24 in .nvmrc and requires npm >= 11: every commit failed with an
 * EBADDEVENGINES that named neither the Node in use nor the one .nvmrc asks for. The hooks now
 * source project-node.sh first, which puts the nvm-installed Node of .nvmrc first on PATH, or says
 * what to do when nvm has none. These specs run the real hooks the way husky does (`sh -e`).
 */
const ROOT = path.resolve(__dirname, '../../../..')
const HOOK_DIRS = ['scaffolds/overlays/monorepo/root/.husky', 'scaffolds/overlays/multirepo/api/.husky', 'scaffolds/overlays/multirepo/web/.husky', '.husky']
const HOOKS = ['pre-commit', 'commit-msg', 'pre-push', 'prepare-commit-msg']

const HAS_DASH = spawnSync('dash', ['-c', 'exit 0']).status === 0
const SHELLS = HAS_DASH ? ['sh', 'dash'] : ['sh']

/** The suite can run inside a git hook that exports `GIT_*` or an nvm shell: the fixtures inherit neither. */
function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_') && !name.startsWith('NVM_')))
}

/** A bin folder whose node prints `version` and whose npx says which Node it belongs to. */
function nodeBin(dir: string, version: string): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'node'), `#!/bin/sh\necho v${version}\n`)
  writeFileSync(path.join(dir, 'npx'), `#!/bin/sh\necho "npx of node ${version}: $*"\n`)
  chmodSync(path.join(dir, 'node'), 0o755)
  chmodSync(path.join(dir, 'npx'), 0o755)
  return dir
}

describe('every hook selects the project Node before it runs node, npm or npx (#1317)', () => {
  it('the helper is the same in the generated hooks and in this repository', () => {
    const copies = HOOK_DIRS.map((dir) => readFileSync(path.join(ROOT, dir, 'project-node.sh'), 'utf8'))
    expect(new Set(copies).size).toBe(1)
  })

  it.each(HOOK_DIRS.flatMap((dir) => HOOKS.map((hook) => [dir, hook] as const)))('%s/%s', (dir, hook) => {
    const lines = readFileSync(path.join(ROOT, dir, hook), 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
    const sourced = lines.findIndex((line) => line.trim() === '. "$sf_project_node"')
    const firstNodeCall = lines.findIndex((line) => /(^|[\s(])(node|npm|npx)\s/.test(line))
    expect(sourced).toBeGreaterThanOrEqual(0)
    expect(firstNodeCall).toBeGreaterThan(sourced)
  })
})

describe.each(SHELLS.flatMap((shell) => HOOK_DIRS.map((dir) => [shell, dir] as const)))('%s -e %s/commit-msg (#1317)', (shell, hookDir) => {
  let fixture: string
  let repo: string
  let nvmDir: string
  let pathWith: (bin: string) => string

  function commitMsg(env: NodeJS.ProcessEnv): SpawnSyncReturns<string> {
    return spawnSync(shell, ['-e', path.join(ROOT, hookDir, 'commit-msg'), 'MSG'], { cwd: repo, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
  }

  beforeEach(() => {
    fixture = realpathSync(mkdtempSync(path.join(tmpdir(), 'sf-husky-node-')))
    repo = path.join(fixture, 'repo')
    nvmDir = path.join(fixture, 'nvm')
    mkdirSync(repo)
    writeFileSync(path.join(repo, '.nvmrc'), '24.19.0\n')
    pathWith = (bin) => `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin`
  })

  afterEach(() => rmSync(fixture, { recursive: true, force: true }))

  it('runs under the nvm Node .nvmrc names when the shell has an older one first on PATH', () => {
    const old = nodeBin(path.join(fixture, 'old'), '22.15.0')
    nodeBin(path.join(nvmDir, 'versions/node/v24.19.0/bin'), '24.19.0')
    const run = commitMsg({ ...cleanEnv(), HOME: fixture, NVM_DIR: nvmDir, PATH: pathWith(old) })
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('npx of node 24.19.0: --no -- commitlint --edit MSG\n')
  })

  it('takes the most recent installed version of that major when the exact one is missing', () => {
    const old = nodeBin(path.join(fixture, 'old'), '22.15.0')
    nodeBin(path.join(nvmDir, 'versions/node/v24.9.0/bin'), '24.9.0')
    nodeBin(path.join(nvmDir, 'versions/node/v24.20.1/bin'), '24.20.1')
    nodeBin(path.join(nvmDir, 'versions/node/v25.0.0/bin'), '25.0.0')
    const run = commitMsg({ ...cleanEnv(), HOME: fixture, NVM_DIR: nvmDir, PATH: pathWith(old) })
    expect(run.stderr).toBe('')
    expect(run.stdout).toBe('npx of node 24.20.1: --no -- commitlint --edit MSG\n')
  })

  it('finds nvm under $HOME/.nvm when NVM_DIR is not exported', () => {
    const old = nodeBin(path.join(fixture, 'old'), '22.15.0')
    nodeBin(path.join(fixture, '.nvm/versions/node/v24.19.0/bin'), '24.19.0')
    const run = commitMsg({ ...cleanEnv(), HOME: fixture, PATH: pathWith(old) })
    expect(run.stdout).toBe('npx of node 24.19.0: --no -- commitlint --edit MSG\n')
  })

  it('names the Node in use, the one .nvmrc asks for and the remediation when nvm has none', () => {
    const old = nodeBin(path.join(fixture, 'old'), '22.15.0')
    const run = commitMsg({ ...cleanEnv(), HOME: fixture, NVM_DIR: nvmDir, PATH: pathWith(old) })
    expect(run.stderr).toBe(
      `husky - this hook runs under Node 22.15.0 (${path.join(old, 'node')}) but .nvmrc asks for 24.19.0, and nvm has no Node 24 installed: run \`nvm install\` in ${repo}, or put Node 24.19.0 first on PATH, then retry.\n`
    )
    // npm, not the hook, decides whether that Node is acceptable: the command still runs.
    expect(run.stdout).toBe('npx of node 22.15.0: --no -- commitlint --edit MSG\n')
  })

  it('keeps a Node of the same or a newer major', () => {
    nodeBin(path.join(nvmDir, 'versions/node/v24.19.0/bin'), '24.19.0')
    for (const version of ['24.1.0', '25.2.0']) {
      const current = nodeBin(path.join(fixture, version), version)
      const run = commitMsg({ ...cleanEnv(), HOME: fixture, NVM_DIR: nvmDir, PATH: pathWith(current) })
      expect(run.stderr).toBe('')
      expect(run.stdout).toBe(`npx of node ${version}: --no -- commitlint --edit MSG\n`)
    }
  })

  it.each([
    ['no .nvmrc', null],
    ['an nvm alias', 'lts/*\n'],
    ['an empty .nvmrc', '\n']
  ])('keeps the PATH with %s', (_label, content) => {
    if (content === null) rmSync(path.join(repo, '.nvmrc'))
    else writeFileSync(path.join(repo, '.nvmrc'), content)
    const old = nodeBin(path.join(fixture, 'old'), '22.15.0')
    nodeBin(path.join(nvmDir, 'versions/node/v24.19.0/bin'), '24.19.0')
    const run = commitMsg({ ...cleanEnv(), HOME: fixture, NVM_DIR: nvmDir, PATH: pathWith(old) })
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('npx of node 22.15.0: --no -- commitlint --edit MSG\n')
  })

  it('accepts a v-prefixed .nvmrc', () => {
    writeFileSync(path.join(repo, '.nvmrc'), 'v24.19.0\n')
    const old = nodeBin(path.join(fixture, 'old'), '22.15.0')
    nodeBin(path.join(nvmDir, 'versions/node/v24.19.0/bin'), '24.19.0')
    const run = commitMsg({ ...cleanEnv(), HOME: fixture, NVM_DIR: nvmDir, PATH: pathWith(old) })
    expect(run.stdout).toBe('npx of node 24.19.0: --no -- commitlint --edit MSG\n')
  })
})
