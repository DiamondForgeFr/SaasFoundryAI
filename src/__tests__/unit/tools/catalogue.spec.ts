import { TOOL_CATALOGUE, TOOL_CATEGORIES, SINGLE_SELECT_CATEGORIES, findTool, toolsByCategory } from '../../../tools/catalogue'

describe('tools catalogue', () => {
  it('exposes the three entry-point categories', () => {
    expect([...TOOL_CATEGORIES]).toEqual(['tracker', 'docs', 'design'])
  })

  it('marks tracker and docs as single-select, design as multi', () => {
    expect(SINGLE_SELECT_CATEGORIES.has('tracker')).toBe(true)
    expect(SINGLE_SELECT_CATEGORIES.has('docs')).toBe(true)
    expect(SINGLE_SELECT_CATEGORIES.has('design')).toBe(false)
  })

  it('keeps every catalogue entry inside a known category', () => {
    for (const tool of TOOL_CATALOGUE) {
      expect(TOOL_CATEGORIES).toContain(tool.category)
    }
  })

  it('lists tracker tools matching the WorkflowConfig union', () => {
    expect(toolsByCategory('tracker').map((t) => t.name)).toEqual(['github-projects', 'jira', 'notion', 'linear'])
  })

  it('lists docs backends including the local (no-remote) option', () => {
    expect(toolsByCategory('docs').map((t) => t.name)).toEqual(['notion', 'confluence', 'local-markdown'])
  })

  it('resolves Notion distinctly per category (name is not globally unique)', () => {
    expect(findTool('tracker', 'notion')?.displayName).toBe('Notion')
    expect(findTool('docs', 'notion')?.displayName).toBe('Notion')
    expect(findTool('tracker', 'notion')).not.toBe(findTool('docs', 'notion'))
  })

  it('returns undefined for an unknown (category, name) pair', () => {
    expect(findTool('design', 'github-projects')).toBeUndefined()
    expect(findTool('tracker', 'clickup')).toBeUndefined()
  })

  it('leaves github-projects and local-markdown without a credential bucket', () => {
    expect(findTool('tracker', 'github-projects')?.credentialTool).toBeUndefined()
    expect(findTool('docs', 'local-markdown')?.credentialTool).toBeUndefined()
  })

  it('shares the atlassian bucket between Jira and Confluence', () => {
    expect(findTool('tracker', 'jira')?.credentialTool).toBe('atlassian')
    expect(findTool('docs', 'confluence')?.credentialTool).toBe('atlassian')
  })
})
