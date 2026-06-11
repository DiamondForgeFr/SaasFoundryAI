import { collectAdvancedSkillsCredentials, promptAdvancedSkills } from '../../prompts/skills.prompts'
import { StepDefinition } from '../types'

/**
 * Advanced-skills selection + credential collection, moved verbatim from
 * `src/prompts/project.prompts.ts`. The workflow tool driving the
 * pre-selection comes from the session derivations (rule `workflow-tool`)
 * instead of an ad-hoc local variable.
 */
export const skillsStep: StepDefinition = {
  id: 'skills',
  title: 'Advanced skills',
  effects: ['May open credential pages (Atlassian, Notion, Figma) in the default browser (interactive mode)'],
  collect: async ({ prefill, nonInteractive, derived }) => {
    const advancedSkills = await promptAdvancedSkills(derived.workflowTool, { prefill, nonInteractive })
    const skillsCredentials = await collectAdvancedSkillsCredentials(advancedSkills, { prefill, nonInteractive })

    return {
      advancedSkills,
      ...skillsCredentials
    }
  },
  decisions: (collected) => [{ stepId: 'skills', name: 'advancedSkills', value: collected.advancedSkills }]
}
