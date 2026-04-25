import { renderIssueTicketBody } from '../../../../builders/srs/templates/tickets/issue.tpl'
import { IssueTicketBodySpec } from '../../../../builders/srs/types'

describe('renderIssueTicketBody', () => {
  const baseSpec: IssueTicketBodySpec = { title: 'Login returns 500 on empty password' }

  it('renders every mandatory section heading in order for a rich spec', () => {
    const body = renderIssueTicketBody({
      ...baseSpec,
      behaviorObserved: 'POST /auth/login with empty password returns 500',
      expectedBehavior: 'Should return 400 with a validation error',
      stepsToReproduce: ['POST /auth/login', 'Leave password empty', 'Observe 500'],
      environment: ['api@1.2.3', 'node 22.13.0'],
      impact: 'Users see a generic error and cannot recover.',
      severity: 'high',
      evidence: ['stack trace at AuthService.ts:42']
    })

    const headings = body.match(/^## .+$/gm) ?? []
    expect(headings).toEqual([
      '## Behavior observed',
      '## Expected Behavior',
      '## Steps to Reproduce / Trigger Conditions',
      '## Environment / Configuration',
      '## Impact / Severity',
      '## Evidence / Data'
    ])
  })

  it('emits the numbered list for Steps to Reproduce', () => {
    const body = renderIssueTicketBody({
      ...baseSpec,
      stepsToReproduce: ['Open login page', 'Submit empty form']
    })
    expect(body).toContain('1. Open login page')
    expect(body).toContain('2. Submit empty form')
  })

  it('renders severity before free-form impact text', () => {
    const body = renderIssueTicketBody({ ...baseSpec, severity: 'critical', impact: 'All tenants affected.' })
    expect(body).toMatch(/\*\*Severity:\*\* critical\n\nAll tenants affected\./)
  })

  it('renders severity alone when impact text is missing', () => {
    const body = renderIssueTicketBody({ ...baseSpec, severity: 'medium' })
    expect(body).toContain('**Severity:** medium')
  })

  it('renders impact text alone when severity is missing', () => {
    const body = renderIssueTicketBody({ ...baseSpec, impact: 'Blocks signup.' })
    expect(body).toContain('Blocks signup.')
    expect(body).not.toContain('**Severity:**')
  })

  it('falls back to placeholder text when optional sections are empty', () => {
    const body = renderIssueTicketBody(baseSpec)
    expect(body).toContain('_Describe the actual buggy behavior._')
    expect(body).toContain('_Describe what should happen instead._')
    expect(body).toContain('_List the steps or conditions that trigger the bug._')
    expect(body).toContain('_List relevant environment details (OS, browser, version, flags…)._')
    expect(body).toContain('_Describe who/what is affected and how severely._')
    expect(body).toContain('_Attach logs, screenshots, or stack traces here._')
  })
})
