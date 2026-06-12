import { readdir } from 'fs/promises'
import { resolve } from 'path'

import { WORKFLOW_PRESETS } from '../../../prompts/workflow.prompts'
import { skillsTemplatesPath } from '../../../types'

const slug = (name: string) => name.toLowerCase().replace(/\s+/g, '-')

describe('WORKFLOW_PRESETS', () => {
  it('exposes the team and solo presets', () => {
    expect(Object.keys(WORKFLOW_PRESETS).sort()).toEqual(['saasfoundry', 'solo'])
  })

  it('solo is the 5-status reduced sequence', () => {
    expect(WORKFLOW_PRESETS.solo.statuses.map((s) => s.name)).toEqual(['Backlog', 'In Progress', 'AI Testing', 'In Review', 'Done'])
  })

  it('solo shares every primitive with the team preset (DS-3: in-place upgradability)', () => {
    // Same issue types — upgrading solo→team must never invalidate existing tickets
    expect(WORKFLOW_PRESETS.solo.issueTypes).toEqual(WORKFLOW_PRESETS.saasfoundry.issueTypes)

    // Solo statuses are a strict subset of the team statuses (by name)
    const teamNames = WORKFLOW_PRESETS.saasfoundry.statuses.map((s) => s.name)
    for (const status of WORKFLOW_PRESETS.solo.statuses) {
      expect(teamNames).toContain(status.name)
    }
  })

  it('every status of both presets carries a description for AI context', () => {
    for (const preset of Object.values(WORKFLOW_PRESETS)) {
      for (const status of preset.statuses) {
        expect(status.description.length).toBeGreaterThan(20)
      }
    }
  })

  it.each([
    ['saasfoundry', 'statuses'],
    ['solo', 'statuses-solo']
  ] as const)('%s preset has one template doc per status in %s/', async (presetKey, dir) => {
    const files = await readdir(resolve(skillsTemplatesPath, 'workflow', dir))
    for (const [index, status] of WORKFLOW_PRESETS[presetKey].statuses.entries()) {
      expect(files).toContain(`${index + 1}-${slug(status.name)}.md`)
    }
  })

  it('both status template dirs carry the SRS drafting phase docs', async () => {
    const team = await readdir(resolve(skillsTemplatesPath, 'workflow', 'statuses'))
    const solo = await readdir(resolve(skillsTemplatesPath, 'workflow', 'statuses-solo'))
    expect(team.filter((f) => /-(ai-drafting|human-review|spawning)\.md$/.test(f))).toHaveLength(3)
    expect(solo.filter((f) => /-(ai-drafting|human-review|spawning)\.md$/.test(f))).toHaveLength(3)
  })
})
