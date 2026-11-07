import { readFileSync } from 'fs'
import path from 'path'

// Pin the heavy-validation rule of AI Testing (#1155): a MoltenTerm pipeline counts only when
// `.molten/project.json` declares at least one job in `ci.jobs` and `molten ci status` answers.
// A file holding only a project name and icon used to send agents to `molten ci run`, which had
// nothing to run, instead of the npm suite. Pinned in the team and solo templates, the dogfood
// copy, the .agents projection and this repository's AGENTS.md.

const REPO_ROOT = path.resolve(__dirname, '../../../..')

function read(relative: string): string {
  // The templates wrap long lines: compare on collapsed whitespace.
  return readFileSync(path.resolve(REPO_ROOT, relative), 'utf8').replace(/\s+/g, ' ')
}

describe('the AI Testing rule counts a Molten pipeline only when it declares a job', () => {
  it.each([
    ['team template', 'scaffolds/skills-templates/workflow/statuses/4-ai-testing.md'],
    ['solo template', 'scaffolds/skills-templates/workflow/statuses-solo/3-ai-testing.md'],
    ['dogfood copy', '.claude/skills/sf-workflow/statuses/4-ai-testing.md'],
    ['agents projection', '.agents/skills/sf-workflow/statuses/4-ai-testing.md']
  ])('the AI Testing status (%s)', (_label, file) => {
    const text = read(file)
    expect(text).toContain('A Molten pipeline counts only when `.molten/project.json` declares at least one job in `ci.jobs` and `molten ci status` answers')
    expect(text).toContain('A file with no job in `ci.jobs` declares no pipeline')
    expect(text).toContain('`local-ci: npm suite`')
    expect(text).not.toContain('When `.molten/project.json` exists and')
  })

  it("this repository's AGENTS.md", () => {
    const text = read('AGENTS.md')
    expect(text).toContain('when `.molten/project.json` declares at least one job in `ci.jobs` and `molten ci status` answers')
    expect(text).not.toContain('when `.molten/project.json` exists and')
  })
})
