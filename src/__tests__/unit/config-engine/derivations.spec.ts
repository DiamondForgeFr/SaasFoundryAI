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

  it('exposes the tools-first selections (tracker/docs/design)', () => {
    const derived = computeDerivations({
      toolSelections: { tracker: { name: 'github-projects' }, docs: { name: 'notion' }, design: [{ name: 'figma' }, { name: 'miro' }] }
    })
    expect(derived.selectedTracker).toBe('github-projects')
    expect(derived.selectedDocs).toBe('notion')
    expect(derived.selectedDesign).toEqual(['figma', 'miro'])
  })

  it('defaults design selections to an empty list and tracker/docs to undefined', () => {
    const derived = computeDerivations({})
    expect(derived.selectedTracker).toBeUndefined()
    expect(derived.selectedDocs).toBeUndefined()
    expect(derived.selectedDesign).toEqual([])
  })

  it('suggests design skills (figma/miro) from the tools-first selection', () => {
    expect(computeDerivations({ toolSelections: { design: [{ name: 'figma' }] } }).suggestedSkills).toEqual(['figma'])
  })

  it('merges workflow-tool and design skill suggestions without duplicates', () => {
    const derived = computeDerivations({ workflow: workflowWith('jira'), toolSelections: { design: [{ name: 'figma' }, { name: 'miro' }] } })
    expect(derived.suggestedSkills).toEqual(['atlassian', 'figma', 'miro'])
  })
})
