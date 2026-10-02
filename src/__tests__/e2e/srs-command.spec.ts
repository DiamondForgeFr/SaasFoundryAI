import { spawnSync } from 'child_process'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

import { version } from '../../../package.json'

const CLI_ROOT = resolve(__dirname, '../../..')

describe('sf srs through the compiled CLI', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sf-srs-command-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const sf = (...args: string[]) => spawnSync(process.execPath, [join(CLI_ROOT, 'bin/sf.js'), ...args], { cwd: tempDir, encoding: 'utf8', env: { ...process.env, SF_SKILL_NO_WARN: '1' } })

  // #834 — the program's `--version` matched anywhere on the line: the spawn printed the CLI
  // version and exited 0, and an agent following the skill believed it had spawned.
  it('hands `spawn --version <v>` to the spawner instead of printing the CLI version', () => {
    const run = sf('srs', 'spawn', '--version', 'v0 — Bootstrap', '--milestone', 'v0.1.0', '--dry-run')

    expect(run.stdout.trim()).not.toBe(version)
    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain('--epic')
  })

  it.each(['--version', '-V'])('still prints the CLI version for `sf %s`', (flag) => {
    const run = sf(flag)

    expect(run.status).toBe(0)
    expect(run.stdout.split(' ')[0].trim()).toBe(version)
  })
})
