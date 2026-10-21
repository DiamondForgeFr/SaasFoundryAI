import { execFile } from 'child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileP = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const CLI = path.resolve(REPO_ROOT, '.claude/skills/sf-workflow/workflow-cli.sh')
const BASH = '/bin/bash'

// #1067 (Examine finding 19): `update-status` tells the delegation ledger of the clone that a ticket changed status, so
// the routing report can time a ticket from its first In progress to its first Human testing. It is best effort: it
// runs the CLI the project resolves in the background, never blocks, and never fails a transition that succeeded.

interface Sandbox {
  dir: string
  env: NodeJS.ProcessEnv
  /** The calls the fake CLIs recorded; the command runs in the background, so wait for the calls expected (or, none expected, long enough to see none). */
  calls: (expected?: number) => Promise<string[]>
  install: (relative: string, script: string) => Promise<void>
  cleanup: () => Promise<void>
}

async function sandbox(options: { toolExitCode?: number } = {}): Promise<Sandbox> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-wfcli-status-event-'))
  const toolDir = path.join(dir, '.claude/skills/sf-tool-github-projects')
  await mkdir(toolDir, { recursive: true })
  await writeFile(path.join(dir, '.saasfoundry.json'), JSON.stringify({ workflow: { tool: 'github-projects', projectUrl: 'https://github.com/orgs/FakeOrg/projects/42', workingBranch: 'develop' } }))
  const toolExit = options.toolExitCode ?? 0
  const toolPath = path.join(toolDir, 'github-projects-cli.sh')
  writeFileSync(
    toolPath,
    `#!/bin/bash
case "$1" in
  get-labels) printf '%s\\n' "complexity: low" ;;
  update-status)
    if [ "${toolExit}" -ne 0 ]; then echo "fake-tool-cli: simulated update failure" >&2; exit ${toolExit}; fi
    echo "✓ Ticket #$2 → $3"
    ;;
  *) exit 0 ;;
esac
`
  )
  chmodSync(toolPath, 0o755)
  const log = path.join(dir, 'calls.log')
  const read = async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean)
  return {
    dir,
    // A PATH with the system tools only: a developer machine's own saasfoundryai or sf must not leak in.
    env: { ...process.env, PWD: dir, PATH: '/usr/bin:/bin:/usr/local/bin' },
    calls: async (expected = 0) => {
      const deadline = Date.now() + (expected ? 8000 : 700)
      while (Date.now() < deadline) {
        if (expected && (await read()).length >= expected) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      return read()
    },
    install: async (relative, script) => {
      const target = path.join(dir, relative)
      await mkdir(path.dirname(target), { recursive: true })
      writeFileSync(target, `#!/bin/sh\n${script}\n`)
      chmodSync(target, 0o755)
    },
    cleanup: () => rm(dir, { recursive: true, force: true })
  }
}

const recorder = (dir: string): string => `printf '%s\\n' "$0 $*" >> "${path.join(dir, 'calls.log')}"`
const transition = (box: Sandbox, extra: NodeJS.ProcessEnv = {}) => execFileP(BASH, [CLI, 'update-status', '1067', 'In progress'], { env: { ...box.env, ...extra }, cwd: box.dir })

describe('workflow-cli update-status tells the ledger of the clone (#1067)', () => {
  it('runs the status-event command of the project CLI with the ticket and the new status, in the background', async () => {
    const box = await sandbox()
    try {
      await box.install('node_modules/.bin/saasfoundryai', recorder(box.dir))
      const { stdout } = await transition(box)
      expect(stdout).toContain('✓ Ticket #1067 → In progress')
      expect(await box.calls(1)).toEqual(['./node_modules/.bin/saasfoundryai agents outcome status-event 1067 In progress'])
    } finally {
      await box.cleanup()
    }
  })

  it('never waits for it: a CLI that takes seconds does not delay the transition', async () => {
    const box = await sandbox()
    try {
      await box.install('node_modules/.bin/saasfoundryai', `${recorder(box.dir)}\nsleep 6`)
      const started = Date.now()
      await transition(box)
      expect(Date.now() - started).toBeLessThan(5000)
    } finally {
      await box.cleanup()
    }
  })

  it('does not fail a transition that succeeded when the CLI fails, or when the project has none', async () => {
    const box = await sandbox()
    try {
      const none = await transition(box)
      expect(none.stdout).toContain('✓ Ticket #1067 → In progress')
      expect(await box.calls()).toEqual([])
      await box.install('node_modules/.bin/saasfoundryai', `${recorder(box.dir)}\necho "error: unknown command" >&2\nexit 1`)
      const failing = await transition(box)
      expect(failing.stdout).toContain('✓ Ticket #1067 → In progress')
      expect(failing.stderr).not.toContain('unknown command')
    } finally {
      await box.cleanup()
    }
  })

  it('records nothing when the board refused the transition', async () => {
    const box = await sandbox({ toolExitCode: 1 })
    try {
      await box.install('node_modules/.bin/saasfoundryai', recorder(box.dir))
      await expect(transition(box)).rejects.toBeDefined()
      expect(await box.calls()).toEqual([])
    } finally {
      await box.cleanup()
    }
  })

  it('uses the sf of the project when it carries no saasfoundryai, and the build of this repository when the project is SaaSFoundry itself', async () => {
    const box = await sandbox()
    try {
      await box.install('node_modules/.bin/sf', recorder(box.dir))
      await transition(box)
      expect((await box.calls(1))[0]).toContain('node_modules/.bin/sf agents outcome status-event')
      await rm(path.join(box.dir, 'node_modules'), { recursive: true })
      await rm(path.join(box.dir, 'calls.log'))
      await writeFile(path.join(box.dir, 'package.json'), '{\n  "name": "saasfoundryai-cli"\n}\n')
      await mkdir(path.join(box.dir, 'bin'), { recursive: true })
      await writeFile(path.join(box.dir, 'bin/sf.js'), `require('fs').appendFileSync(${JSON.stringify(path.join(box.dir, 'calls.log'))}, 'sf.js ' + process.argv.slice(2).join(' ') + '\\n')\n`)
      await transition(box, { PATH: `${path.dirname(process.execPath)}:${box.env.PATH}` })
      expect(await box.calls(1)).toEqual(['sf.js agents outcome status-event 1067 In progress'])
    } finally {
      await box.cleanup()
    }
  })

  it('never runs a bare sf, which may be another CLI', async () => {
    const box = await sandbox()
    try {
      await box.install('bin/sf', recorder(box.dir))
      await transition(box, { PATH: `${path.join(box.dir, 'bin')}:${box.env.PATH}` })
      expect(await box.calls()).toEqual([])
    } finally {
      await box.cleanup()
    }
  })

  it('is the same script in the live skill, the agents mirror and the scaffolded template', () => {
    const live = readFileSync(CLI, 'utf8')
    expect(live).toContain('record_status_event')
    expect(readFileSync(path.resolve(REPO_ROOT, 'scaffolds/skills-templates/workflow/workflow-cli.sh'), 'utf8')).toBe(live)
    expect(readFileSync(path.resolve(REPO_ROOT, '.agents/skills/sf-workflow/workflow-cli.sh'), 'utf8')).toBe(live)
  })
})
