import { readFileSync } from 'fs'
import path from 'path'

const TEMPLATE = path.resolve(__dirname, '../../../../scaffolds/skills-templates/workflow')
const read = (file: string) => readFileSync(path.join(TEMPLATE, file), 'utf-8')

/** The lines of a status file that mention a given command. */
const linesWith = (content: string, needle: string) => content.split('\n').filter((line) => line.includes(needle))

// ─────────────────────────────────────────────────────────────────────────────
// #915 — who takes a pull request out of draft. The PR is a draft from AI
// Testing on. With a Human Testing step, the developer marks it ready: that
// click is the approval. Without one (Solo, `nature:internal`), the agent runs
// `ready-pr` at the end of AI Testing. The status files used to tell the agent
// to promote the PR after Human Testing, and the Solo route to open a ready PR
// only after AI Testing.
// ─────────────────────────────────────────────────────────────────────────────
describe('who takes a pull request out of draft (#915)', () => {
  it('states the rule and both routes in the skill', () => {
    const skill = read('SKILL.md')
    expect(skill).toContain('**as a draft, at the latest during AI Testing**')
    expect(skill).toMatch(/\*\*With Human Testing\*\*.*\*\*The developer\*\*, with the \*\*Ready for review\*\* button/)
    expect(skill).toMatch(/\*\*Without Human Testing\*\*.*\*\*You\*\*: `workflow-cli\.sh ready-pr <ticket>`/)
    expect(skill).not.toContain('may create a ready PR directly')
  })

  it('never tells the agent to run ready-pr during Human Testing', () => {
    const lines = linesWith(read('statuses/5-human-testing.md'), 'ready-pr')
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).toMatch(/never|do not|yourself/i)
    expect(read('statuses/5-human-testing.md')).toContain('next_status: In Review (the developer marks the draft PR ready)')
  })

  it('keeps the draft on the Human Testing route and promotes it on the internal route, at the end of AI Testing', () => {
    const aiTesting = read('statuses/4-ai-testing.md')
    expect(aiTesting).toContain('Open the draft PR if it is not open yet (`create-pr <ticket> --draft`)')
    expect(aiTesting).toMatch(/`nature:user-facing`.*keep the PR a draft.*Do not mark it ready/)
    expect(aiTesting).toMatch(/`nature:internal`.*`workflow-cli\.sh ready-pr <ticket>`, then → \*\*In Review\*\*/)
  })

  it('has the Solo agent open a draft during AI Testing and mark it ready itself', () => {
    const aiTesting = read('statuses-solo/3-ai-testing.md')
    expect(aiTesting).toContain('`create-pr <ticket> --draft`')
    expect(aiTesting).toContain('default: take the draft out of draft with `workflow-cli.sh ready-pr <ticket>`, then move to **In Review**')
    expect(aiTesting).not.toContain('create the PR and move')
    expect(read('statuses-solo/4-in-review.md')).not.toContain('Create a ready PR')
  })

  it('no longer lets internal tickets skip the draft', () => {
    for (const file of ['statuses/4-ai-testing.md', 'statuses/6-in-review.md']) {
      expect(read(file)).not.toMatch(/create a ready PR directly|open a ready PR|may use `create-pr <ticket>` directly/)
    }
  })
})
