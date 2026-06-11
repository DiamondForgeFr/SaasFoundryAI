import { computeDerivations, derivationRules } from '../../../config-engine/derivations'
import { WorkflowConfig } from '../../../types'

const workflowWith = (tool: WorkflowConfig['tool']): WorkflowConfig => ({ tool })

describe('derivationRules', () => {
  it('every rule has a unique id and a description', () => {
    const ids = derivationRules.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const rule of derivationRules) {
      expect(rule.description.length).toBeGreaterThan(0)
    }
  })
})

describe('computeDerivations', () => {
  it("defaults workflowTool to 'none' when no workflow was configured", () => {
    expect(computeDerivations({})).toMatchObject({ workflowTool: 'none', suggestedSkills: [] })
  })

  it('exposes the configured workflow tool', () => {
    expect(computeDerivations({ workflow: workflowWith('github-projects') }).workflowTool).toBe('github-projects')
  })

  it('suggests the atlassian skill for a jira workflow', () => {
    expect(computeDerivations({ workflow: workflowWith('jira') }).suggestedSkills).toEqual(['atlassian'])
  })

  it('suggests the notion skill for a notion workflow', () => {
    expect(computeDerivations({ workflow: workflowWith('notion') }).suggestedSkills).toEqual(['notion'])
  })

  it('suggests nothing for github-projects or linear workflows', () => {
    expect(computeDerivations({ workflow: workflowWith('github-projects') }).suggestedSkills).toEqual([])
    expect(computeDerivations({ workflow: workflowWith('linear') }).suggestedSkills).toEqual([])
  })
})
