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
    id: 'workflow-tool-to-skills',
    description: 'Pre-select the advanced skill matching the chosen workflow tool (jira → atlassian, notion → notion)',
    apply: (state) => {
      const tool = state.workflow?.tool
      if (tool === 'jira') return { suggestedSkills: ['atlassian'] }
      if (tool === 'notion') return { suggestedSkills: ['notion'] }
      return { suggestedSkills: [] }
    }
  }
]

/** Run every rule against the accumulated state, later rules win on key conflicts. */
export function computeDerivations(state: ConfigState): DerivedContext {
  return derivationRules.reduce<DerivedContext>((acc, rule) => ({ ...acc, ...rule.apply(state) }), {})
}
