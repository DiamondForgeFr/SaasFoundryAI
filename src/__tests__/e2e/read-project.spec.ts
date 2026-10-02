import { spawnSync } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

import { version } from '../../../package.json'

const CLI_ROOT = resolve(__dirname, '../../..')
const WRAPPER = join(CLI_ROOT, 'scaffolds/skills-templates/tool-saasfoundry/scripts/read-project.sh')

// #866 — the unit specs fed the script a bare-array catalogue while the real
// `sf modules list --json` prints `{ cliVersion, modules }`, so the wrapper
// failed on every project. This drives it against the compiled CLI instead.
describe('tool-saasfoundry read-project.sh through the compiled CLI', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sf-read-project-e2e-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('reports the catalogue the CLI actually prints', async () => {
    await writeFile(join(tempDir, '.saasfoundry.json'), JSON.stringify({ projectName: 'external', structure: 'cli', version, modules: { harness: { version: 1, managed: true } } }))

    const run = spawnSync('/bin/bash', [WRAPPER], {
      cwd: tempDir,
      encoding: 'utf8',
      env: { ...process.env, SF_CLI: `${process.execPath} ${join(CLI_ROOT, 'bin/sf.js')}`, SF_SKILL_NO_WARN: '1' }
    })

    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
    const report = JSON.parse(run.stdout) as { modules: { available: string[] }; project: { capabilities: { collaborationHarness: string } | null } }
    expect(report.modules.available).toEqual(expect.arrayContaining(['email', 'storage']))
    expect(report.project.capabilities?.collaborationHarness).toBe('managed')
  })
})
