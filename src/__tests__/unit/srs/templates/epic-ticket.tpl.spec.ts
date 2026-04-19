import { renderEpicTicketBody } from '../../../../builders/srs/templates/tickets/epic.tpl'
import { EpicTicketBodySpec } from '../../../../builders/srs/types'

describe('renderEpicTicketBody', () => {
  const baseSpec: EpicTicketBodySpec = {
    epic: {
      title: 'User authentication',
      parentPageId: 'page-epic',
      businessValue: 'Users can sign in securely.',
      urs: [{ id: 'UR-1', narrative: 'sign in with email' }],
      frs: [{ id: 'FR-1', title: 'Login endpoint' }]
    }
  }

  it('renders every mandatory section heading in order for a rich spec', () => {
    const body = renderEpicTicketBody({
      ...baseSpec,
      epicPageUrl: 'https://notion.so/epic',
      frPages: [{ frId: 'FR-1', frTitle: 'Login endpoint', pageUrl: 'https://notion.so/fr-1' }],
      scopeIncluded: ['Email + password'],
      scopeExcluded: ['SSO'],
      dependencies: ['Service auth v2'],
      constraints: ['GDPR'],
      assumptions: ['Single tenant'],
      definitionOfDone: ['All FR stories merged']
    })

    const headings = body.match(/^## .+$/gm) ?? []
    expect(headings).toEqual(['## Goal', '## Business Value', '## Scope', '## Specifications', '## Dependencies', '## Constraints', '## Assumptions', '## Definition of Done'])
  })

  it('embeds the FR table row linking to the Notion FR page when provided', () => {
    const body = renderEpicTicketBody({
      ...baseSpec,
      epicPageUrl: 'https://notion.so/epic',
      frPages: [{ frId: 'FR-1', frTitle: 'Login endpoint', pageUrl: 'https://notion.so/fr-1' }]
    })

    expect(body).toContain('Main spec: [Epic SRS page](https://notion.so/epic)')
    expect(body).toContain('| FR-1 | Login endpoint | [Login endpoint](https://notion.so/fr-1) |')
  })

  it('falls back to placeholders when optional sections are empty', () => {
    const body = renderEpicTicketBody(baseSpec)

    expect(body).toContain('_Link the Epic SRS page here once the spec is published._')
    expect(body).toContain('_No FR pages linked yet._')
    expect(body).toContain('_List what is in scope._')
    expect(body).toContain('_List upstream tickets or services this Epic depends on._')
    expect(body).toContain('_List the exit criteria for this Epic._')
  })

  it('uses the epic title as the Goal body line', () => {
    const body = renderEpicTicketBody(baseSpec)
    expect(body).toMatch(/## Goal\n\nUser authentication/)
  })
})
