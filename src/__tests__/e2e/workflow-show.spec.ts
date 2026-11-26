import { spawnSync } from '../helpers/bounded-child'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

import { workflowConfigFromPreset, WORKFLOW_PRESETS } from '../../prompts/workflow.prompts'
import { writeManifest } from '../../utils'
import type { WorkflowConfig } from '../../types'

const CLI_ROOT = resolve(__dirname, '../../..')
// Drop the colour codes so the assertions read the text a terminal shows.
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')

// #1249 — sf workflow show printed `0: [object Object]` for each status
describe('sf workflow show through the compiled CLI', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sf-workflow-show-'))
  })
  afterEach(async () => rm(tempDir, { recursive: true, force: true }))

  const withWorkflow = (workflow: WorkflowConfig) => writeManifest(tempDir, { version: '1.0.0', generatedAt: new Date().toISOString(), structure: 'cli', projectName: 'external', workflow })
  const sf = (...args: string[]) =>
    spawnSync(process.execPath, [join(CLI_ROOT, 'bin/sf.js'), ...args], { cwd: tempDir, encoding: 'utf8', env: { ...process.env, SF_SKILL_NO_WARN: '1', NO_COLOR: '1' } })
  /** The lines under the "Workflow Statuses" heading, up to the blank line that ends them. */
  const statusLines = (stdout: string) =>
    plain(stdout)
      .split('Workflow Statuses')[1]
      .trim()
      .split('\n')
      .map((entry) => entry.trim())

  it.each([
    ['Team', 'saasfoundry' as const],
    ['Solo', 'solo' as const]
  ])('lists the statuses of the %s preset by name, in order', async (_label, preset) => {
    await withWorkflow(workflowConfigFromPreset(preset, 'github-projects').workflow)
    const run = sf('workflow', 'show')

    expect(run.status).toBe(0)
    expect(run.stdout).not.toContain('[object Object]')
    expect(plain(run.stdout)).toContain(`Template: ${WORKFLOW_PRESETS[preset].name}`)
    expect(plain(run.stdout)).toContain('Working branch:')
    expect(statusLines(run.stdout)).toEqual(WORKFLOW_PRESETS[preset].statuses.map((status, index) => `${index + 1}. ${status.name}`))
  })

  it('keeps the spelling of the manifest', async () => {
    const { workflow } = workflowConfigFromPreset('solo', 'github-projects')
    await withWorkflow({ ...workflow, statuses: ['Backlog', 'In progress', 'AI testing', 'In review', 'Done'].map((name) => ({ name })) })

    expect(statusLines(sf('workflow', 'show').stdout)).toEqual(['1. Backlog', '2. In progress', '3. AI testing', '4. In review', '5. Done'])
  })

  it('says no status is recorded instead of printing nothing', async () => {
    await withWorkflow({ tool: 'github-projects', workingBranch: 'develop', prTargetBranch: 'develop' })

    expect(statusLines(sf('workflow', 'show').stdout)).toEqual(['(none recorded)'])
  })

  it('prints the same workflow line in sf status --agent-friendly', async () => {
    await withWorkflow(workflowConfigFromPreset('solo', 'github-projects').workflow)
    const run = sf('status', '--agent-friendly', '--no-network')

    expect(run.status).toBe(0)
    expect(run.stdout).toContain('- workflow: github-projects (SaaSFoundry Solo: Backlog → In Progress → AI Testing → In Review → Done)\n')
  })
})
