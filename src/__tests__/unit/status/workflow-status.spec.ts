import { mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { workflowConfigFromPreset } from '../../../prompts/workflow.prompts'
import { collectStatus } from '../../../status/collect'
import { renderAgentFriendly, renderClaudeFriendly, renderHuman, renderJson, workflowStatusNames, workflowSummary } from '../../../status/render'
import type { WorkflowConfig } from '../../../types'

const AT = '2026-11-17T08:00:00.000Z'
const TEAM_LINE = 'github-projects (SaaSFoundry AI Workflow: Backlog → Ready → In Progress → AI Testing → Human Testing → In Review → Done)'
const SOLO_LINE = 'github-projects (SaaSFoundry Solo: Backlog → In Progress → AI Testing → In Review → Done)'

// #1249 — the workflow: line said only the tool, so a session could not tell whether Human testing exists
describe('the workflow in sf status (#1249)', () => {
  describe('workflowSummary', () => {
    it('names the tool, the preset and its statuses in order for the Team and the Solo presets', () => {
      expect(workflowSummary(workflowConfigFromPreset('saasfoundry', 'github-projects').workflow)).toBe(TEAM_LINE)
      expect(workflowSummary(workflowConfigFromPreset('solo', 'github-projects').workflow)).toBe(SOLO_LINE)
    })

    it('keeps the status names as the manifest spells them', () => {
      const workflow: WorkflowConfig = {
        tool: 'github-projects',
        template: 'SaaSFoundry Solo',
        statuses: ['Backlog', 'In progress', 'AI testing', 'In review', 'Done'].map((name) => ({ name }))
      }
      expect(workflowSummary(workflow)).toBe('github-projects (SaaSFoundry Solo: Backlog → In progress → AI testing → In review → Done)')
    })

    it('says what it has when the preset or the statuses are missing', () => {
      expect(workflowSummary({ tool: 'github-projects', statuses: [{ name: 'Todo' }, { name: 'Done' }] })).toBe('github-projects (Todo → Done)')
      expect(workflowSummary({ tool: 'jira', template: 'Custom' })).toBe('jira (Custom)')
      expect(workflowSummary({ tool: 'linear' })).toBe('linear')
    })

    it('reads none without a workflow tool', () => {
      expect(workflowSummary(undefined)).toBe('none')
      expect(workflowSummary({ tool: 'none', template: 'SaaSFoundry Solo' })).toBe('none')
    })
  })

  describe('workflowStatusNames', () => {
    it('skips entries without a name rather than printing them', () => {
      const statuses = [{ name: 'Backlog' }, {}, null, 'Done', { name: '' }] as unknown as WorkflowConfig['statuses']
      expect(workflowStatusNames({ tool: 'github-projects', statuses })).toEqual(['Backlog', 'Done'])
    })

    it('returns no name for a statuses value that is not a list', () => {
      const statuses = { backlog: 'Backlog' } as unknown as WorkflowConfig['statuses']
      expect(workflowStatusNames({ tool: 'github-projects', statuses })).toEqual([])
      expect(workflowStatusNames(undefined)).toEqual([])
    })
  })

  describe.each([
    ['Team', 'saasfoundry' as const, TEAM_LINE, 'SaaSFoundry AI Workflow', ['Backlog', 'Ready', 'In Progress', 'AI Testing', 'Human Testing', 'In Review', 'Done']],
    ['Solo', 'solo' as const, SOLO_LINE, 'SaaSFoundry Solo', ['Backlog', 'In Progress', 'AI Testing', 'In Review', 'Done']]
  ])('the status of a %s project', (_label, preset, line, name, statuses) => {
    let root: string
    const render = async (renderer: typeof renderAgentFriendly) => renderer({ report: await collectStatus(root, { checkNetwork: false }), preconditions: [] })

    beforeEach(async () => {
      root = await realpath(await mkdtemp(join(tmpdir(), 'sf-status-workflow-')))
      const { workflow } = workflowConfigFromPreset(preset, 'github-projects')
      const manifest = { version: '1.0.0', projectName: 'status-demo', structure: 'cli', generatedAt: AT, workflow }
      await writeFile(join(root, '.saasfoundry.json'), JSON.stringify(manifest, null, 2) + '\n')
    })
    afterEach(async () => rm(root, { recursive: true, force: true }))

    it('names the tool and the preset on the workflow line of the agent-friendly and claude-friendly reports', async () => {
      expect(await render(renderAgentFriendly)).toContain(`- workflow: ${line}\n`)
      expect(await render(renderClaudeFriendly)).toContain(`- workflow: ${line}\n`)
    })

    it('shows the same line in the human report', async () => {
      // The human output is coloured: match across the colour codes rather than on the exact text.
      expect(await render(renderHuman)).toMatch(new RegExp(`Workflow:.* ${line.replace(/[()]/g, '\\$&')}`))
    })

    it('keeps the workflow field of --json as the tool and adds the preset beside it', async () => {
      const manifest = JSON.parse(await render(renderJson)).manifest
      expect(manifest.workflow).toBe('github-projects')
      expect(manifest.workflowPreset).toEqual({ name, statuses })
    })
  })

  it('has workflow: none and a null preset on a project without a workflow', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'sf-status-workflow-')))
    try {
      await writeFile(join(root, '.saasfoundry.json'), JSON.stringify({ version: '1.0.0', projectName: 'status-demo', structure: 'cli', generatedAt: AT }) + '\n')
      const report = await collectStatus(root, { checkNetwork: false })
      expect(renderAgentFriendly({ report, preconditions: [] })).toContain('- workflow: none\n')
      const manifest = JSON.parse(renderJson({ report, preconditions: [] })).manifest
      expect(manifest.workflow).toBeNull()
      expect(manifest.workflowPreset).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
