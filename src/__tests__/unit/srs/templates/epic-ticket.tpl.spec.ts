import { renderEpicTicketBody, renderEpicTicketTitle } from '../../../../builders/srs/templates/tickets/epic.tpl'
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
    expect(headings).toEqual(['## Goal', '## Business Value', '## Dates', '## Scope', '## Specifications', '## Dependencies', '## Constraints', '## Assumptions', '## Definition of Done'])
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

  it('appends version suffix to the Goal line when version is provided', () => {
    const body = renderEpicTicketBody({ ...baseSpec, version: 2 })
    expect(body).toMatch(/## Goal\n\nUser authentication - v2/)
  })

  it('accepts string versions for release names like "1.0"', () => {
    const body = renderEpicTicketBody({ ...baseSpec, version: '1.0' })
    expect(body).toMatch(/## Goal\n\nUser authentication - v1\.0/)
  })

  it('leaves the Goal line unchanged when version is omitted (backward compat)', () => {
    const body = renderEpicTicketBody(baseSpec)
    expect(body).toContain('## Goal\n\nUser authentication\n\n')
    expect(body).not.toMatch(/User authentication - v/)
  })

  it('renders a Dates section with placeholders when start/end are absent', () => {
    const body = renderEpicTicketBody(baseSpec)
    expect(body).toContain('## Dates')
    expect(body).toContain('**Start:** _Set on the board (custom field: Start date)._')
    expect(body).toContain('**End:** _Set on the board (custom field: End date)._')
  })

  it('renders the provided Start/End dates when supplied', () => {
    const body = renderEpicTicketBody({ ...baseSpec, startDate: '2026-05-01', endDate: '2026-06-15' })
    expect(body).toContain('**Start:** 2026-05-01')
    expect(body).toContain('**End:** 2026-06-15')
  })
})

describe('renderEpicTicketTitle', () => {
  const baseSpec: EpicTicketBodySpec = {
    epic: { title: 'User authentication', parentPageId: 'page-epic', urs: [], frs: [] }
  }

  it('returns the epic title unchanged when version is omitted', () => {
    expect(renderEpicTicketTitle(baseSpec)).toBe('User authentication')
  })

  it('appends - v{version} when version is a number', () => {
    expect(renderEpicTicketTitle({ ...baseSpec, version: 3 })).toBe('User authentication - v3')
  })

  it('appends - v{version} when version is a string', () => {
    expect(renderEpicTicketTitle({ ...baseSpec, version: '2.1' })).toBe('User authentication - v2.1')
  })

  it('ignores empty-string version (treats as absent)', () => {
    expect(renderEpicTicketTitle({ ...baseSpec, version: '' })).toBe('User authentication')
  })
})
