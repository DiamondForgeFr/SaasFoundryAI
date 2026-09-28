import { renderStoryTicketBody } from '../../../../builders/srs/templates/tickets/story.tpl'
import { StoryTicketBodySpec } from '../../../../builders/srs/types'

describe('renderStoryTicketBody', () => {
  const baseSpec: StoryTicketBodySpec = {
    fr: { id: 'FR-1', title: 'Login endpoint', description: 'POST /auth/login' }
  }

  it('renders every mandatory section heading in order for a rich spec', () => {
    const body = renderStoryTicketBody({
      ...baseSpec,
      frPageUrl: 'https://notion.so/fr-1',
      mainSpecUrl: 'https://notion.so/epic',
      urRefs: [{ id: 'UR-1', narrative: 'sign in with email' }],
      frRefs: [{ id: 'FR-1', title: 'Login endpoint' }],
      acceptanceCriteria: [
        { id: 'AC-01', text: 'returns 200 with valid creds', sourceFr: 'FR-1' },
        { id: 'AC-02', text: 'returns 401 with invalid creds', sourceFr: 'FR-1' }
      ],
      dsRefs: [{ id: 'DS-1', title: 'Login form' }],
      dependencies: ['Service auth v2'],
      constraints: ['GDPR']
    })

    const headings = body.match(/^## .+$/gm) ?? []
    expect(headings).toEqual([
      '## Objective',
      '## Context (User Requirements)',
      '## Scope (Functional Requirements)',
      '## Acceptance Criteria',
      '## Specifications',
      '## Dependencies',
      '## Constraints',
      '## Design References'
    ])
  })

  it('emits the AC table with AC-NN and Source FR columns', () => {
    const body = renderStoryTicketBody({
      ...baseSpec,
      acceptanceCriteria: [
        { id: 'AC-01', text: 'returns 200', sourceFr: 'FR-1' },
        { id: 'AC-02', text: 'returns 401' }
      ]
    })

    expect(body).toContain('| AC | Criterion | Source FR |')
    expect(body).toContain('| AC-01 | returns 200 | FR-1 |')
    expect(body).toContain('| AC-02 | returns 401 | — |')
  })

  it('defaults the Scope FR list to the current FR when frRefs is absent', () => {
    const body = renderStoryTicketBody(baseSpec)
    expect(body).toContain('- **FR-1**')
  })

  it('uses the FR description for Objective when provided', () => {
    const body = renderStoryTicketBody(baseSpec)
    expect(body).toMatch(/## Objective\n\nPOST \/auth\/login/)
  })

  it('falls back to placeholder text when optional sections are empty', () => {
    const body = renderStoryTicketBody(baseSpec)
    expect(body).toContain('_No UR references yet._')
    expect(body).toContain('_No acceptance criteria yet._')
    expect(body).toContain('_No design references yet._')
    expect(body).toContain('_Link the FR SRS page here once the spec is published._')
  })
})
