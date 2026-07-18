import { readFileSync } from 'fs'
import path from 'path'

import { DEFAULT_BRANCH_NAMING } from '../../../prompts/workflow.prompts'

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const CLI = path.resolve(REPO_ROOT, '.claude/skills/sf-workflow/workflow-cli.sh')
const TEMPLATE_CLI = path.resolve(REPO_ROOT, 'scaffolds/skills-templates/workflow/workflow-cli.sh')

// ─────────────────────────────────────────────────────────────────────────────
// Lock the generated branch-naming convention to the PR-resolution regex.
//
// THE BUG THIS GUARDS AGAINST: sf-workflow's get_open_pr_for_ticket() resolves a
// ticket's open PR via `^(feature|fix)/<ticket>(-|$)`, which REQUIRES the ticket
// number immediately after the prefix. If DEFAULT_BRANCH_NAMING ever drops the
// `{N}` ticket prefix (the historical `fix/{name}` form), a branch built from the
// convention never matches → the In-Review / Done PR guards mis-fire and users are
// forced to set SF_WORKFLOW_BYPASS_* on every ticket. This test ties both sides
// together so the regression cannot reappear silently from either edit.
// ─────────────────────────────────────────────────────────────────────────────

// Rebuild the JS equivalent of the shell regex straight from the CLI source, so a
// change to the regex shape (not just the convention) also trips this test.
function regexForTicket(cliPath: string, ticket: string): RegExp {
  const src = readFileSync(cliPath, 'utf8')
  // Matches: test("^(feature|fix)/" + $t + "(-|$)")
  const m = src.match(/test\("(\^\([^"]+\)\/)"\s*\+\s*\$t\s*\+\s*"(\([^"]+\))"\)/)
  if (!m) throw new Error(`Could not locate the PR-resolution regex in ${cliPath}`)
  return new RegExp(`${m[1]}${ticket}${m[2]}`)
}

// Render a branchNaming pattern into a concrete branch name with a fake ticket.
function renderBranch(pattern: string, ticket: string, slug: string): string {
  return pattern.replace(/\{(N|ticket|number|issue-number)\}/g, ticket).replace(/\{(description|name)\}/g, slug)
}

describe('branchNaming defaults stay in lock-step with the PR-resolution regex', () => {
  const FAKE_TICKET = '123'

  it.each([
    ['feature', DEFAULT_BRANCH_NAMING.feature],
    ['fix', DEFAULT_BRANCH_NAMING.fix]
  ])('a %s branch built from the convention matches ^(feature|fix)/<ticket>(-|$)', (_type, pattern) => {
    const regex = regexForTicket(CLI, FAKE_TICKET)
    const branch = renderBranch(pattern, FAKE_TICKET, 'do-the-thing')

    // The ticket prefix must actually be substituted (no leftover placeholder).
    expect(branch).not.toMatch(/\{.*\}/)
    // e.g. "fix/123-do-the-thing" / "feature/123-do-the-thing"
    expect(branch).toMatch(regex)
  })

  it.each([
    ['feature', DEFAULT_BRANCH_NAMING.feature],
    ['fix', DEFAULT_BRANCH_NAMING.fix]
  ])('a %s branch WITHOUT the ticket prefix does NOT match (the original bug)', (_type, pattern) => {
    const regex = regexForTicket(CLI, FAKE_TICKET)
    const prefix = pattern.split('/')[0] // "feature" | "fix"
    const noTicketBranch = `${prefix}/some-change`

    expect(noTicketBranch).not.toMatch(regex)
  })

  it('the template CLI and the installed CLI carry the same PR-resolution regex', () => {
    // The skill ships from scaffolds/skills-templates/workflow → regenerating it
    // must not silently re-introduce a divergent regex.
    expect(regexForTicket(TEMPLATE_CLI, FAKE_TICKET).source).toBe(regexForTicket(CLI, FAKE_TICKET).source)
  })

  it('both branchNaming defaults place the ticket immediately after the prefix', () => {
    for (const pattern of [DEFAULT_BRANCH_NAMING.feature, DEFAULT_BRANCH_NAMING.fix]) {
      // Structural assertion independent of the placeholder token name: the
      // segment right after "feature/" or "fix/" must be the ticket placeholder.
      expect(pattern).toMatch(/^(feature|fix)\/\{(N|ticket|number|issue-number)\}-/)
    }
  })
})
