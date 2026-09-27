import { readFileSync } from 'fs'
import path from 'path'

import { DEFAULT_BRANCH_NAMING } from '../../../prompts/workflow.prompts'

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const CLI = path.resolve(REPO_ROOT, '.claude/skills/sf-workflow/workflow-cli.sh')
const TEMPLATE_CLI = path.resolve(REPO_ROOT, 'scaffolds/skills-templates/workflow/workflow-cli.sh')

// ─────────────────────────────────────────────────────────────────────────────
// Lock the generated branch-naming convention to the manifest-driven PR
// resolver. The historical resolver hard-coded the feature/fix prefix and could
// stop matching a custom convention even though the manifest declared it valid.
// The CLI now derives anchored expressions from branchNaming for ordinary
// delivery and release PRs.
// ─────────────────────────────────────────────────────────────────────────────

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&')
}

function regexFromPattern(pattern: string, ticket: string): RegExp {
  const source = pattern
    .split(/(\{(?:N|ticket|number|issue-number)\}|\{(?:description|name)\}|\{version\})/)
    .map((part) => {
      if (/^\{(?:N|ticket|number|issue-number)\}$/.test(part)) return escapeRegex(ticket)
      if (/^\{(?:description|name|version)\}$/.test(part)) return '.+'
      return escapeRegex(part)
    })
    .join('')
  return new RegExp('^' + source + '$')
}

// Render a branchNaming pattern into a concrete branch name with a fake ticket.
function renderBranch(pattern: string, ticket: string, slug: string): string {
  return pattern.replace(/\{(N|ticket|number|issue-number)\}/g, ticket).replace(/\{(description|name)\}/g, slug)
}

describe('branchNaming defaults stay in lock-step with the manifest-driven PR resolver', () => {
  const FAKE_TICKET = '123'

  it.each([
    ['feature', DEFAULT_BRANCH_NAMING.feature],
    ['fix', DEFAULT_BRANCH_NAMING.fix]
  ])('a %s branch built from the convention matches its anchored manifest pattern', (_type, pattern) => {
    const regex = regexFromPattern(pattern, FAKE_TICKET)
    const branch = renderBranch(pattern, FAKE_TICKET, 'do-the-thing')

    // The ticket prefix must actually be substituted (no leftover placeholder).
    expect(branch).not.toMatch(/\{.*\}/)
    // e.g. "fix/123-do-the-thing" / "feature/123-do-the-thing"
    expect(branch).toMatch(regex)
  })

  it.each([
    ['feature', DEFAULT_BRANCH_NAMING.feature],
    ['fix', DEFAULT_BRANCH_NAMING.fix]
  ])('a %s branch without the ticket prefix does not match', (_type, pattern) => {
    const regex = regexFromPattern(pattern, FAKE_TICKET)
    const prefix = pattern.split('/')[0] // "feature" | "fix"
    const noTicketBranch = `${prefix}/some-change`

    expect(noTicketBranch).not.toMatch(regex)
  })

  it('the installed and template CLIs resolve feature, fix, and release patterns from the manifest', () => {
    for (const cliPath of [CLI, TEMPLATE_CLI]) {
      const source = readFileSync(cliPath, 'utf8')
      expect(source).toContain('workflow.branchNaming.feature')
      expect(source).toContain('workflow.branchNaming.fix')
      expect(source).toContain('workflow.branchNaming.release')
      expect(source).toContain('N|ticket|number|issue-number')
      expect(source).toContain('description|name')
      expect(source).toContain('split("{version}")')
    }
  })

  it('the release default matches RC branches and rejects feature branches', () => {
    const regex = regexFromPattern(DEFAULT_BRANCH_NAMING.release, FAKE_TICKET)
    expect('rc-1.0.0').toMatch(regex)
    expect('feature/123-release').not.toMatch(regex)
  })

  it.each([
    ['work/{ticket}-{name}', 'work/123-change'],
    ['repair/{description}-ticket-{issue-number}', 'repair/change-ticket-123'],
    ['feature/{number}', 'feature/123']
  ])('supports legacy and ticket-only branch conventions: %s', (pattern, branch) => {
    expect(branch).toMatch(regexFromPattern(pattern, FAKE_TICKET))
  })

  it('both delivery defaults place the ticket immediately after the prefix', () => {
    for (const pattern of [DEFAULT_BRANCH_NAMING.feature, DEFAULT_BRANCH_NAMING.fix]) {
      // Structural assertion independent of the placeholder token name: the
      // segment right after "feature/" or "fix/" must be the ticket placeholder.
      expect(pattern).toMatch(/^(feature|fix)\/\{(N|ticket|number|issue-number)\}-/)
    }
  })
})
