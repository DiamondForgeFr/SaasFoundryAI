import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { chmod, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

const WRAPPER_SOURCE = path.resolve(__dirname, '../../../../.claude/skills/sf-srs/scripts/srs-cli.sh')
const BASH = '/bin/bash'

/**
 * Builds a sandbox shaped like a **generated project**, which is the layout the
 * resolver used to ignore entirely: the skill is installed under `.claude/`, and
 * the dispatch library only exists inside `node_modules/saasfoundryai-cli`.
 *
 * This is the shape our dogfood loop never exercises — we always run the wrapper
 * from the SaaSFoundryAI checkout, where `src/srs` resolves on the first
 * iteration — which is exactly why the bug survived unnoticed.
 */
async function buildGeneratedProject(options: { withLibrary: boolean }): Promise<{
  dir: string
  wrapper: string
  env: NodeJS.ProcessEnv
  sentinel: string
  nodePrefix: string
  cleanup: () => Promise<void>
}> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-srs-resolution-'))
  const skillScripts = path.join(dir, '.claude', 'skills', 'sf-srs', 'scripts')
  const binDir = path.join(dir, 'bin')
  await mkdir(skillScripts, { recursive: true })
  await mkdir(binDir, { recursive: true })

  const { readFile } = await import('node:fs/promises')
  const wrapper = path.join(skillScripts, 'srs-cli.sh')
  await writeFile(wrapper, await readFile(WRAPPER_SOURCE, 'utf8'))
  await chmod(wrapper, 0o755)

  await writeFile(path.join(dir, '.saasfoundry.json'), JSON.stringify({ tools: { srs: { backend: 'notion', rootPage: { id: 'root' } } } }))

  if (options.withLibrary) {
    const libBin = path.join(dir, 'node_modules', 'saasfoundryai-cli', 'dist', 'srs', 'bin')
    await mkdir(libBin, { recursive: true })
    await writeFile(path.join(libBin, 'eval-srs.js'), `console.log('DISPATCH REACHED: ' + process.argv.slice(2).join(' '))\n`)
  }

  // Shims that record their own invocation. The error path used to run commands
  // through unescaped backticks, so "printed the message" is not enough — the
  // test has to prove nothing was executed.
  const sentinel = path.join(dir, 'executed.txt')
  for (const name of ['npm', 'sf']) {
    const shim = path.join(binDir, name)
    await writeFile(shim, `#!/bin/bash\necho "${name} $*" >> "${sentinel}"\nexit 0\n`)
    await chmod(shim, 0o755)
  }

  // The node on PATH lives in a sandbox prefix, so the resolver's global fallbacks look here,
  // never at the developer's own global install (or CI's lack of one).
  const nodePrefix = path.join(dir, 'node-prefix')
  await mkdir(path.join(nodePrefix, 'bin'), { recursive: true })
  await symlink(process.execPath, path.join(nodePrefix, 'bin', 'node'))

  return {
    dir,
    wrapper,
    sentinel,
    nodePrefix,
    env: { ...process.env, PATH: `${binDir}:${path.join(nodePrefix, 'bin')}:/usr/bin:/bin`, NPM_CONFIG_PREFIX: '' },
    cleanup: () => rm(dir, { recursive: true, force: true })
  }
}

/**
 * Install a fake `saasfoundryai-cli` package the way `npm i -g` does: under
 * `<prefix>/lib/node_modules/<name>`, its commands relative symlinks in `<prefix>/bin`.
 */
async function installGlobally(prefix: string, options: { name?: string; commands?: string[] } = {}): Promise<void> {
  const pkg = path.join(prefix, 'lib', 'node_modules', 'saasfoundryai-cli')
  await mkdir(path.join(pkg, 'bin'), { recursive: true })
  await mkdir(path.join(pkg, 'dist', 'srs', 'bin'), { recursive: true })
  await writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: options.name ?? 'saasfoundryai-cli' }, null, 2))
  await writeFile(path.join(pkg, 'bin', 'sf.js'), "require('../dist/index.js')\n")
  await chmod(path.join(pkg, 'bin', 'sf.js'), 0o755) // npm makes a package's bin executable
  await writeFile(path.join(pkg, 'dist', 'srs', 'bin', 'eval-srs.js'), `console.log('GLOBAL DISPATCH REACHED: ' + process.argv.slice(2).join(' '))\n`)
  await mkdir(path.join(prefix, 'bin'), { recursive: true })
  for (const command of options.commands ?? []) await symlink('../lib/node_modules/saasfoundryai-cli/bin/sf.js', path.join(prefix, 'bin', command))
}

describe('srs-cli.sh entrypoint resolution', () => {
  it('runs the library shipped under node_modules in a generated project', async () => {
    const sandbox = await buildGeneratedProject({ withLibrary: true })
    try {
      const { stdout } = await execFileP(BASH, [sandbox.wrapper, 'eval', '--path', '.'], { cwd: sandbox.dir, env: sandbox.env })
      expect(stdout).toContain('DISPATCH REACHED')
      expect(stdout).toContain('--path .')
    } finally {
      await sandbox.cleanup()
    }
  })

  it('resolves from a subdirectory, since a monorepo puts node_modules above the working directory', async () => {
    const sandbox = await buildGeneratedProject({ withLibrary: true })
    try {
      const nested = path.join(sandbox.dir, 'apps', 'api')
      await mkdir(nested, { recursive: true })
      const { stdout } = await execFileP(BASH, [sandbox.wrapper, 'eval'], { cwd: nested, env: sandbox.env })
      expect(stdout).toContain('DISPATCH REACHED')
    } finally {
      await sandbox.cleanup()
    }
  })

  // #835 — `npm i -g saasfoundryai-cli` is the install the README recommends, and the walk
  // up from the script and the working directory never reaches the global npm root.
  describe('with the CLI installed globally', () => {
    it.each(['saasfoundryai', 'sf'])('runs the package behind `%s` on PATH', async (command) => {
      const sandbox = await buildGeneratedProject({ withLibrary: false })
      try {
        const prefix = path.join(sandbox.dir, 'global')
        await installGlobally(prefix, { commands: [command] })
        const env = { ...sandbox.env, PATH: `${path.join(prefix, 'bin')}:${sandbox.env.PATH}` }

        const { stdout } = await execFileP(BASH, [sandbox.wrapper, 'eval', '--path', '.'], { cwd: sandbox.dir, env })

        expect(stdout).toContain('GLOBAL DISPATCH REACHED: --path .')
        expect(existsSync(sandbox.sentinel)).toBe(false)
      } finally {
        await sandbox.cleanup()
      }
    })

    it("finds npm's global folder next to the node on PATH, without any command", async () => {
      const sandbox = await buildGeneratedProject({ withLibrary: false })
      try {
        await installGlobally(sandbox.nodePrefix)

        const { stdout } = await execFileP(BASH, [sandbox.wrapper, 'eval'], { cwd: sandbox.dir, env: sandbox.env })

        expect(stdout).toContain('GLOBAL DISPATCH REACHED')
      } finally {
        await sandbox.cleanup()
      }
    })

    it('prefers the project-local library over the global one', async () => {
      const sandbox = await buildGeneratedProject({ withLibrary: true })
      try {
        await installGlobally(sandbox.nodePrefix)

        const { stdout } = await execFileP(BASH, [sandbox.wrapper, 'eval'], { cwd: sandbox.dir, env: sandbox.env })

        expect(stdout).toContain('DISPATCH REACHED')
        expect(stdout).not.toContain('GLOBAL')
      } finally {
        await sandbox.cleanup()
      }
    })

    // Salesforce's CLI is also called `sf`: a command of that name is not trusted blindly
    it('ignores an `sf` on PATH that is another package', async () => {
      const sandbox = await buildGeneratedProject({ withLibrary: false })
      try {
        const prefix = path.join(sandbox.dir, 'salesforce')
        await installGlobally(prefix, { name: '@salesforce/cli', commands: ['sf'] })
        const env = { ...sandbox.env, PATH: `${path.join(prefix, 'bin')}:${sandbox.env.PATH}` }

        await expect(execFileP(BASH, [sandbox.wrapper, 'eval'], { cwd: sandbox.dir, env })).rejects.toMatchObject({
          stderr: expect.stringContaining('could not locate the SRS dispatch library')
        })
      } finally {
        await sandbox.cleanup()
      }
    })
  })

  describe('when the library is nowhere to be found', () => {
    it('names every path it searched', async () => {
      const sandbox = await buildGeneratedProject({ withLibrary: false })
      try {
        await expect(execFileP(BASH, [sandbox.wrapper, 'eval'], { cwd: sandbox.dir, env: sandbox.env })).rejects.toMatchObject({
          stderr: expect.stringMatching(/node_modules\/saasfoundryai-cli\/dist\/srs\/bin\/eval-srs\.js[\s\S]*a global install[\s\S]*npm i -g saasfoundryai-cli/)
        })
      } finally {
        await sandbox.cleanup()
      }
    })

    // Regression: the message used backticks inside a double-quoted string, so
    // the failure path executed `npm run build` and `sf skill install sf-srs`
    // instead of printing them. A failure path must never run anything.
    it('executes nothing', async () => {
      const sandbox = await buildGeneratedProject({ withLibrary: false })
      try {
        await execFileP(BASH, [sandbox.wrapper, 'eval'], { cwd: sandbox.dir, env: sandbox.env }).catch(() => undefined)
        expect(existsSync(sandbox.sentinel)).toBe(false)
      } finally {
        await sandbox.cleanup()
      }
    })
  })
})
