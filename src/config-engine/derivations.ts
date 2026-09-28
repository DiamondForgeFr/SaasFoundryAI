import { ConfigState, DerivedContext } from './types'

/**
 * A derivation rule turns earlier answers into context for downstream steps.
 * This is the canonical home of every "X was chosen, therefore Y is
 * pre-filled/suggested" mapping — renderers and steps consume the result
 * instead of re-implementing the logic.
 */
export interface DerivationRule {
  id: string
  description: string
  apply: (state: ConfigState) => Partial<DerivedContext>
}

export const derivationRules: DerivationRule[] = [
  {
    id: 'workflow-tool',
    description: "Expose the selected workflow tool to downstream steps ('none' when the workflow step was skipped or declined)",
    apply: (state) => ({ workflowTool: state.workflow?.tool ?? 'none' })
  },
  {
    id: 'selected-tools',
    description: 'Expose the tools-first selections (tracker/docs/design) so downstream steps drive off them instead of re-asking which tool',
    apply: (state) => ({
      selectedTracker: state.toolSelections?.tracker?.name,
      selectedDocs: state.toolSelections?.docs?.name,
      selectedDesign: (state.toolSelections?.design ?? []).map((d) => d.name)
    })
  },
  {
    id: 'suggested-skills',
    description: 'Pre-select advanced skills from the chosen workflow tool (jira → atlassian, notion → notion) and the design tools selected in the tools-first step (figma, miro)',
    apply: (state) => {
      const skills = new Set<string>()
      const tool = state.workflow?.tool
      if (tool === 'jira') skills.add('atlassian')
      if (tool === 'notion') skills.add('notion')
      for (const design of state.toolSelections?.design ?? []) {
        if (design.name === 'figma') skills.add('figma')
        if (design.name === 'miro') skills.add('miro')
      }
      return { suggestedSkills: [...skills] }
    }
  }
]

/** Run every rule against the accumulated state, later rules win on key conflicts. */
export function computeDerivations(state: ConfigState): DerivedContext {
  return derivationRules.reduce<DerivedContext>((acc, rule) => ({ ...acc, ...rule.apply(state) }), {})
}
