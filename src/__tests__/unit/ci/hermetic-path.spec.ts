import { spawn } from 'child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { delimiter, join, relative, resolve } from 'path'

import { CLAUDE_CAPTURE_COMMAND } from '../../../harness/delegation-hooks'
import { HOST_CLI_NAMES, hermeticPath, nodeBinDir } from '../../helpers/hermetic-path'

const REPO_ROOT = resolve(__dirname, '../../../..')
const TESTS_ROOT = join(REPO_ROOT, 'src/__tests__')

// #1128: a CLI installed on the machine (`saasfoundryai` or `sf` 1.1.0 from npm, the Salesforce
// `sf`) answered the specs that resolve the CLI through PATH. The workflow-cli specs ran the
// developer's real CLI on every transition, the hook specs ran it on every capture, and the probe
// assertion failed. These guards fail as soon as a spec can reach one again.
describe('a hermetic PATH for the specs (#1128)', () => {
  const specs = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) return entry === 'fixtures' ? [] : specs(path)
      return entry.endsWith('.spec.ts') ? [path] : []
    })

  it('applies to every jest project through the shared setup', () => {
    const config = require(join(REPO_ROOT, 'jest.config.js')) as { projects: { displayName: string; setupFilesAfterEnv?: string[] }[] }
    for (const project of config.projects) expect({ project: project.displayName, setup: project.setupFilesAfterEnv }).toEqual({ project: project.displayName, setup: ['<rootDir>/jest.setup.ts'] })
    expect(readFileSync(join(REPO_ROOT, 'jest.setup.ts'), 'utf8')).toContain('process.env.PATH = hermeticPath(process.env.PATH)')
  })

  it('leaves no host CLI on the PATH a spec inherits, nor beside the node it runs', () => {
    const reachable = (process.env.PATH ?? '').split(delimiter).flatMap((dir) => HOST_CLI_NAMES.map((name) => join(dir, name)).filter((path) => existsSync(path)))
    expect(reachable).toEqual([])
    expect(HOST_CLI_NAMES.filter((name) => existsSync(join(nodeBinDir(), name)))).toEqual([])
    expect(existsSync(join(nodeBinDir(), 'node'))).toBe(true)
  })

  it('never puts the real directory of node on a spec PATH: nvm and npm install the global CLI there', () => {
    const offenders = specs(TESTS_ROOT)
      .filter((path) => /dirname\(process\.execPath\)/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(REPO_ROOT, path))
    expect(offenders).toEqual([])
  })

  describe('a hook spawned with the PATH a spec inherits', () => {
    let root: string
    beforeEach(async () => {
      root = await realpath(await mkdtemp(join(tmpdir(), 'sf-hermetic-guard-')))
    })
    afterEach(async () => rm(root, { recursive: true, force: true }))

    /** A machine where the global CLI sits next to node, the way `npm install -g` lays it out under nvm. */
    const hostBin = async () => {
      const bin = join(root, 'host-bin')
      await mkdir(bin)
      await writeFile(join(bin, 'node'), '')
      for (const name of HOST_CLI_NAMES) {
        await writeFile(join(bin, name), `#!/bin/sh\nprintf '%s\\n' "$0 $*" >> "${root}/calls.log"\nexit 0\n`)
        await chmod(join(bin, name), 0o755)
      }
      return bin
    }
    const capture = (path: string) =>
      new Promise<void>((done, fail) => {
        const project = join(root, 'project')
        const child = spawn('sh', ['-c', CLAUDE_CAPTURE_COMMAND], { cwd: root, env: { PATH: path, CLAUDE_PROJECT_DIR: project } })
        child.on('error', fail)
        child.on('close', () => done())
        child.stdin.end(JSON.stringify({ hook_event_name: 'SubagentStop', agent_type: 'sf-build' }))
      })
    const calls = async () => (await readFile(join(root, 'calls.log'), 'utf8').catch(() => '')).trim()

    it('reaches the global CLI when the PATH is the raw host one, which is what the guard catches', async () => {
      const bin = await hostBin()
      await mkdir(join(root, 'project'))
      await capture(`${bin}${delimiter}/usr/bin${delimiter}/bin`)
      expect(await calls()).toContain(`${bin}/saasfoundryai agents outcome capture`)
    })

    it('does not reach it once the PATH is made hermetic, and keeps node', async () => {
      const bin = await hostBin()
      await mkdir(join(root, 'project'))
      const path = hermeticPath(`${bin}${delimiter}/usr/bin${delimiter}/bin`)
      const mirror = path.split(delimiter)[0]
      expect(mirror).not.toBe(bin)
      expect(existsSync(join(mirror, 'node'))).toBe(true)
      await capture(path)
      expect(await calls()).toBe('')
      await rm(mirror, { recursive: true, force: true })
    })
  })
})
