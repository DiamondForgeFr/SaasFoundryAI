import { readFileSync } from 'fs'
import path from 'path'

// Pin the headings that tools use to find the AI Testing comments (#1017):
// the test plan comment starts with `## Test plan` and the report comment with
// `## Test report`. Titles chosen freely ("AI Testing report") go unnoticed by
// those tools, so the wording is pinned in the scaffolded templates (team and
// solo), in the in-repo dogfood copies and in the .agents projection.

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const TEST_PLAN = '`## Test plan`'
const TEST_REPORT = '`## Test report`'

function read(relative: string): string {
  return readFileSync(path.resolve(REPO_ROOT, relative), 'utf8')
}

const TEMPLATE_TEAM = 'scaffolds/skills-templates/workflow/statuses/4-ai-testing.md'
const TEMPLATE_SOLO = 'scaffolds/skills-templates/workflow/statuses-solo/3-ai-testing.md'
const DOGFOOD_TEAM = '.claude/skills/sf-workflow/statuses/4-ai-testing.md'
const AGENTS_TEAM = '.agents/skills/sf-workflow/statuses/4-ai-testing.md'

describe('AI Testing comment headings are pinned', () => {
  it.each([
    ['team template', TEMPLATE_TEAM],
    ['solo template', TEMPLATE_SOLO],
    ['dogfood copy', DOGFOOD_TEAM],
    ['agents projection', AGENTS_TEAM]
  ])('the AI Testing status (%s) names both headings', (_label, file) => {
    const text = read(file)
    expect(text).toContain(TEST_PLAN)
    expect(text).toContain(TEST_REPORT)
  })

  it.each([
    ['team Human Testing', 'scaffolds/skills-templates/workflow/statuses/5-human-testing.md'],
    ['team In Review', 'scaffolds/skills-templates/workflow/statuses/6-in-review.md'],
    ['solo In Review', 'scaffolds/skills-templates/workflow/statuses-solo/4-in-review.md'],
    ['workflow SKILL template', 'scaffolds/skills-templates/workflow/SKILL.md'],
    ['dogfood workflow SKILL', '.claude/skills/sf-workflow/SKILL.md']
  ])('every status that refers to the report (%s) names the same heading', (_label, file) => {
    expect(read(file)).toContain(TEST_REPORT)
  })

  it('the report skeleton is prescribed in the team and solo AI Testing templates', () => {
    for (const file of [TEMPLATE_TEAM, TEMPLATE_SOLO]) {
      expect(read(file)).toContain('## Test report\n\n**Commit:**')
    }
  })

  it('the in-repo and .agents copies of the AI Testing status match the template byte-for-byte', () => {
    expect(read(DOGFOOD_TEAM)).toBe(read(TEMPLATE_TEAM))
    expect(read(AGENTS_TEAM)).toBe(read(DOGFOOD_TEAM))
  })
})
