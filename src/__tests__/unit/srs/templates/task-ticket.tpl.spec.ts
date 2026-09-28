import { renderTaskTicketBody } from '../../../../builders/srs/templates/tickets/task.tpl'
import { TaskTicketBodySpec } from '../../../../builders/srs/types'

describe('renderTaskTicketBody', () => {
  const baseSpec: TaskTicketBodySpec = { title: 'Migrate auth middleware' }

  it('renders every mandatory section heading in order for a rich spec', () => {
    const body = renderTaskTicketBody({
      ...baseSpec,
      objective: 'Replace legacy middleware with the JWT one',
      context: 'Legacy middleware flagged by legal for insecure session storage.',
      scopeIncluded: ['Swap middleware wiring'],
      scopeExcluded: ['Token rotation policy'],
      completionCriteria: [
        { id: 'CC-01', text: 'All routes still authenticate' },
        { id: 'CC-02', text: 'Legacy middleware removed from DI module' }
      ],
      parentEpicUrl: 'https://notion.so/epic',
      parentStoryUrl: 'https://notion.so/story',
      specLinks: [{ label: 'ADR-14', url: 'https://notion.so/adr-14' }],
      dependencies: ['Service auth v2'],
      constraints: ['Zero downtime']
    })

    const headings = body.match(/^## .+$/gm) ?? []
    expect(headings).toEqual(['## Objective', '## Context', '## Scope', '## Completion Criteria', '## Specifications', '## Dependencies', '## Constraints'])
  })

  it('emits the completion-criteria table with CC-NN rows', () => {
    const body = renderTaskTicketBody({
      ...baseSpec,
      completionCriteria: [
        { id: 'CC-01', text: 'Endpoints respond 200' },
        { id: 'CC-02', text: 'No TODOs left in module' }
      ]
    })

    expect(body).toContain('| CC | Criterion |')
    expect(body).toContain('| CC-01 | Endpoints respond 200 |')
    expect(body).toContain('| CC-02 | No TODOs left in module |')
  })

  it('falls back to a generated Objective when none is provided', () => {
    const body = renderTaskTicketBody(baseSpec)
    expect(body).toMatch(/## Objective\n\nDeliver Migrate auth middleware\./)
  })

  it('falls back to placeholder text when optional sections are empty', () => {
    const body = renderTaskTicketBody(baseSpec)
    expect(body).toContain('_Describe the technical motivation or pre-existing state this Task changes._')
    expect(body).toContain('_List what is in scope._')
    expect(body).toContain('_List what is out of scope._')
    expect(body).toContain('_No completion criteria yet._')
    expect(body).toContain('_Link the SRS pages or external specs this Task implements._')
    expect(body).toContain('_List upstream tickets or services this Task depends on._')
    expect(body).toContain('_List technical or business constraints._')
  })

  it('includes parent Epic/Story links in the Specifications section when provided', () => {
    const body = renderTaskTicketBody({
      ...baseSpec,
      parentEpicUrl: 'https://notion.so/epic',
      parentStoryUrl: 'https://notion.so/story'
    })
    expect(body).toContain('- Parent Epic spec: [https://notion.so/epic](https://notion.so/epic)')
    expect(body).toContain('- Parent Story spec: [https://notion.so/story](https://notion.so/story)')
  })

  it('renders external spec links with labels', () => {
    const body = renderTaskTicketBody({
      ...baseSpec,
      specLinks: [{ label: 'ADR-14', url: 'https://notion.so/adr-14' }]
    })
    expect(body).toContain('- ADR-14: [https://notion.so/adr-14](https://notion.so/adr-14)')
  })
})
