import { readFileSync } from 'fs'
import path from 'path'

// Drift guard for tool skills whose in-repo dogfooding copy must stay
// byte-identical with the scaffolded template shipped to new projects.
// If a developer fixes a bug in one copy and forgets the other, new SaaSFoundry
// users inherit the old broken version — that's exactly the kind of silent
// regression that sparked the #135 refactor, so we fail loudly at commit time.
const PAIRS = [
  {
    name: 'sf-tool-github-projects CLI',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-tool-github-projects/github-projects-cli.sh'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/tools/github-projects/github-projects-cli.sh')
  },
  {
    name: 'sf-tool-github-projects SKILL.md',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-tool-github-projects/SKILL.md'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/tools/github-projects/SKILL.md')
  },
  {
    name: 'sf-workflow CLI',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-workflow/workflow-cli.sh'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/workflow/workflow-cli.sh')
  },
  // Note: sf-workflow/SKILL.md intentionally NOT in this drift set.
  // The scaffolded copy carries `{{WORKFLOW_NAME}}` / `{{TOOL}}` / `{{STATUSES_LIST}}`
  // placeholders that `workflow-skill.installer.ts` substitutes at project creation —
  // byte-identity would break those substitutions. Status files (`statuses/*.md`) have
  // no placeholders so they stay byte-identical.
  {
    name: 'sf-workflow statuses/1-backlog.md',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-workflow/statuses/1-backlog.md'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/workflow/statuses/1-backlog.md')
  },
  {
    name: 'sf-workflow statuses/2-ready.md',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-workflow/statuses/2-ready.md'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/workflow/statuses/2-ready.md')
  },
  {
    name: 'sf-workflow statuses/3-in-progress.md',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-workflow/statuses/3-in-progress.md'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/workflow/statuses/3-in-progress.md')
  },
  {
    name: 'sf-workflow statuses/3a-ai-drafting.md',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-workflow/statuses/3a-ai-drafting.md'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/workflow/statuses/3a-ai-drafting.md')
  },
  {
    name: 'sf-workflow statuses/3b-human-review.md',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-workflow/statuses/3b-human-review.md'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/workflow/statuses/3b-human-review.md')
  },
  {
    name: 'sf-workflow statuses/3c-spawning.md',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-workflow/statuses/3c-spawning.md'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/workflow/statuses/3c-spawning.md')
  },
  {
    name: 'sf-workflow statuses/4-ai-testing.md',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-workflow/statuses/4-ai-testing.md'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/workflow/statuses/4-ai-testing.md')
  },
  {
    name: 'sf-workflow statuses/5-human-testing.md',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-workflow/statuses/5-human-testing.md'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/workflow/statuses/5-human-testing.md')
  },
  {
    name: 'sf-workflow statuses/6-in-review.md',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-workflow/statuses/6-in-review.md'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/workflow/statuses/6-in-review.md')
  },
  {
    name: 'sf-workflow statuses/7-done.md',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-workflow/statuses/7-done.md'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/workflow/statuses/7-done.md')
  },
  {
    name: 'sf-srs SKILL.md',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-srs/SKILL.md'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/sf-srs/SKILL.md')
  },
  {
    name: 'sf-srs srs-cli.sh',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-srs/scripts/srs-cli.sh'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/sf-srs/scripts/srs-cli.sh')
  },
  {
    name: 'sf-srs templates/pages/README.md',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-srs/templates/pages/README.md'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/sf-srs/templates/pages/README.md')
  },
  {
    name: 'sf-srs templates/tickets/README.md',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-srs/templates/tickets/README.md'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/sf-srs/templates/tickets/README.md')
  },
  {
    name: 'sf-srs templates/examples/example-epic.spec.json',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-srs/templates/examples/example-epic.spec.json'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/sf-srs/templates/examples/example-epic.spec.json')
  },
  {
    name: 'sf-srs templates/examples/example-epic.md',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-srs/templates/examples/example-epic.md'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/sf-srs/templates/examples/example-epic.md')
  },
  {
    name: 'sf-srs templates/tickets/examples/epic.md',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-srs/templates/tickets/examples/epic.md'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/sf-srs/templates/tickets/examples/epic.md')
  },
  {
    name: 'sf-srs templates/tickets/examples/story.md',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-srs/templates/tickets/examples/story.md'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/sf-srs/templates/tickets/examples/story.md')
  },
  {
    name: 'sf-srs templates/tickets/examples/task.md',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-srs/templates/tickets/examples/task.md'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/sf-srs/templates/tickets/examples/task.md')
  },
  {
    name: 'sf-srs templates/tickets/examples/issue.md',
    inRepo: path.resolve(__dirname, '../../../../.claude/skills/sf-srs/templates/tickets/examples/issue.md'),
    scaffolded: path.resolve(__dirname, '../../../../scaffolds/skills-templates/sf-srs/templates/tickets/examples/issue.md')
  }
]

describe('tool-skill drift guard', () => {
  for (const pair of PAIRS) {
    it(`${pair.name} — in-repo dogfood copy matches scaffolded template byte-for-byte`, () => {
      const a = readFileSync(pair.inRepo, 'utf8')
      const b = readFileSync(pair.scaffolded, 'utf8')
      if (a !== b) {
        throw new Error(
          [
            `${pair.name} is out of sync.`,
            `  In-repo:    ${pair.inRepo}`,
            `  Scaffolded: ${pair.scaffolded}`,
            '',
            'Run the sync step so new projects inherit the same behaviour:',
            `  cp "${pair.inRepo}" "${pair.scaffolded}"`
          ].join('\n')
        )
      }
      expect(a).toBe(b)
    })
  }
})
