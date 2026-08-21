import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

const WRAPPER_SOURCE = path.resolve(__dirname, '../../../../.claude/skills/sf-srs/scripts/srs-cli.sh')
const BASH = '/bin/bash'

jest.setTimeout(30_000)

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

  return {
    dir,
    wrapper,
    sentinel,
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
    cleanup: () => rm(dir, { recursive: true, force: true })
  }
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

  describe('when the library is nowhere to be found', () => {
    it('names every path it searched', async () => {
      const sandbox = await buildGeneratedProject({ withLibrary: false })
      try {
        await expect(execFileP(BASH, [sandbox.wrapper, 'eval'], { cwd: sandbox.dir, env: sandbox.env })).rejects.toMatchObject({
          stderr: expect.stringContaining('node_modules/saasfoundryai-cli/dist/srs/bin/eval-srs.js')
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
