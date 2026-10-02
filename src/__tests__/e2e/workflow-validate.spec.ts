import { spawnSync } from 'child_process'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

import { workflowConfigFromPreset } from '../../prompts/workflow.prompts'
import type { SaaSFoundryManifest } from '../../types'
import { writeManifest } from '../../utils'

const CLI_ROOT = resolve(__dirname, '../../..')

// #824 — validate looked for a `skills-optional/sf-tool-workflow-validator` skill that no
// version ships, then told a freshly generated project it came from an older release
describe('sf workflow validate through the compiled CLI', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sf-workflow-validate-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const validate = () => spawnSync(process.execPath, [join(CLI_ROOT, 'bin/sf.js'), 'workflow', 'validate'], { cwd: tempDir, encoding: 'utf8', env: { ...process.env, SF_SKILL_NO_WARN: '1' } })

  const harnessManifest = (projectUrl?: string): SaaSFoundryManifest => {
    const { workflow, aiRules } = workflowConfigFromPreset('solo', 'github-projects')
    return { version: '1.0.0', generatedAt: new Date().toISOString(), structure: 'cli', projectName: 'external', workflow: { ...workflow, projectUrl }, aiRules }
  }

  it('validates a fresh solo workflow without claiming a missing validator skill', async () => {
    await writeManifest(tempDir, harnessManifest('https://github.com/users/octo/projects/1'))

    const run = validate()

    expect(run.status).toBe(0)
    expect(run.stdout).toContain('Workflow configuration is valid')
    expect(run.stdout).toContain('the remote board is not queried')
    expect(run.stdout).not.toMatch(/validator skill|newer versions/)
  })

  it('fails on a workflow without a board and names the remediation', async () => {
    await writeManifest(tempDir, harnessManifest())

    const run = validate()

    expect(run.status).toBe(1)
    expect(run.stdout).toContain('No github-projects board attached (workflow.projectUrl is empty)')
    expect(run.stdout).toContain('Attach the board')
  })
})
