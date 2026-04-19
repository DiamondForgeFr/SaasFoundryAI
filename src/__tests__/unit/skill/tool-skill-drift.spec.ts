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
