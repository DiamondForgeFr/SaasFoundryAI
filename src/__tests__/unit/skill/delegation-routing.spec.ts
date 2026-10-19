import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { TASK_KINDS } from '../../../harness/routing-grid'

const REPO_ROOT = path.resolve(__dirname, '../../../..')

const SKILL_COPIES = [
  ['template', path.join(REPO_ROOT, 'scaffolds/skills-templates/workflow')],
  ['dogfood copy', path.join(REPO_ROOT, '.claude/skills/sf-workflow')]
] as const

const DELEGATING_DIRS = ['complexity', 'scripts', 'statuses', 'statuses-solo']

const flat = (text: string): string => text.replace(/\s+/g, ' ')

function files(skillDir: string): { file: string; content: string }[] {
  const found = [{ file: 'SKILL.md', content: readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8') }]
  for (const dir of DELEGATING_DIRS) {
    let names: string[]
    try {
      names = readdirSync(path.join(skillDir, dir))
    } catch {
      continue // statuses-solo ships with the template only
    }
    for (const name of names.filter((n) => /\.(md|yml|sh)$/.test(n))) found.push({ file: `${dir}/${name}`, content: readFileSync(path.join(skillDir, dir, name), 'utf8') })
  }
  return found
}

// Delegations name a task kind from the routing grid and resolve it with
// `sf agents route`, never a host agent type or a model (#931, FR-AEX-009).
describe.each(SKILL_COPIES)('workflow delegation routing — %s (#931)', (_label, skillDir) => {
  const all = files(skillDir)

  it('names only grid task kinds in sf agents route calls', () => {
    const kinds = all.flatMap(({ content }) => [...content.matchAll(/sf agents route --task ([\w<>-]+)/g)].map((m) => m[1]))
    expect(kinds.length).toBeGreaterThan(0)
    for (const kind of kinds) expect([...TASK_KINDS, '<kind>']).toContain(kind)
  })

  it('declares a grid task kind for every delegating profile step', () => {
    for (const level of ['bug', 'low', 'medium', 'complex']) {
      const profile = readFileSync(path.join(skillDir, 'complexity', `${level}.yml`), 'utf8')
      const declared = [...profile.matchAll(/^ {4}taskKind: ([\w-]+)/gm)].map((m) => m[1])
      expect(declared.length).toBeGreaterThan(0)
      for (const kind of declared) expect(TASK_KINDS).toContain(kind)
      expect(profile).not.toContain('agentTypes')
    }
  })

  it('no longer delegates to a host agent type', () => {
    for (const { file, content } of all) expect({ file, legacy: content.match(/\/task [\w-]+|explore-codebase|explore-docs|general-purpose/g) }).toEqual({ file, legacy: null })
  })

  it('states the decomposition rule', () => {
    const skill = all.find(({ file }) => file === 'SKILL.md')!.content
    expect(skill).toContain('## Delegation routing')
    expect(skill).toMatch(/\*\*file set\*\*[\s\S]*\*\*expected result\*\*[\s\S]*\*\*check\*\*/)
    expect(skill).toMatch(/never handed to a lower\s+tier/)
  })

  // The delivery of a whole ticket is sized to the work, not routed to one fixed tier (#1026): a
  // scoped bug or low task reaches the cheap edit tier, the others a tier that matches their size.
  it('sizes the delivery task kind to the complexity profile, always through the grid (#1026)', () => {
    const expected: Record<string, Record<string, string>> = {
      bug: { taskKind: 'bug-fix', scopedTaskKind: 'scoped-edit', scopedMaxFiles: '2' },
      low: { taskKind: 'scoped-edit' },
      medium: { taskKind: 'multi-file-feature' },
      complex: { taskKind: 'multi-file-feature' }
    }
    for (const [level, keys] of Object.entries(expected)) {
      const profile = readFileSync(path.join(skillDir, 'complexity', `${level}.yml`), 'utf8')
      const execute = profile.match(/^ {2}execute:\n((?: {4}.*\n)+)/m)
      expect({ level, execute: execute !== null }).toEqual({ level, execute: true })
      const declared = Object.fromEntries([...execute![1].matchAll(/^ {4}(\w+): ([\w-]+)/gm)].map((m) => [m[1], m[2]]))
      expect({ level, declared }).toEqual({ level, declared: keys })
      for (const kind of [declared.taskKind, declared.scopedTaskKind].filter(Boolean)) expect(TASK_KINDS).toContain(kind)
    }
  })

  it('gates the delegated delivery on the recorded consent and keeps one agent per ticket (#1026)', () => {
    // The template and the dogfood copy wrap lines at different widths: compare on flattened text.
    const skill = flat(all.find(({ file }) => file === 'SKILL.md')!.content)
    expect(skill).toContain('### Delegated ticket delivery')
    expect(skill).toContain('sf agents delegation status')
    expect(skill).toContain('`sf agents delegation allow` or `sf agents delegation decline`')
    expect(skill).toMatch(/`bug` with a change confined to two files or fewer\s*\|\s*`scoped-edit`/)
    expect(skill).toMatch(/any other `bug`\s*\|\s*`bug-fix`/)
    expect(skill).toMatch(/\| `low`\s*\|\s*`scoped-edit`/)
    expect(skill).toMatch(/`medium`, `complex`\s*\|\s*`multi-file-feature`, once decomposed/)
    expect(skill).toMatch(/never runs `ready-pr` on the Human Testing route/)
    expect(skill).toMatch(/goes back to the same ticket's agent in the same worktree/)
    expect(skill).toMatch(/ONE AGENT PER TICKET/)
    expect(skill).not.toMatch(/FINISH THE CURRENT TICKET BEFORE STARTING ANOTHER/)
  })

  it('has the status documents tell who builds the ticket and who takes feedback back (#1026)', () => {
    const doc = (name: string) => {
      const content = all.find(({ file }) => file === name)?.content
      return content === undefined ? undefined : flat(content)
    }
    for (const name of ['statuses/3-in-progress.md', 'statuses/4-ai-testing.md', 'statuses/5-human-testing.md', 'statuses-solo/2-in-progress.md', 'statuses-solo/3-ai-testing.md']) {
      const content = doc(name)
      if (content === undefined) continue // statuses-solo ships with the template only
      expect({ name, delegated: /Delegated ticket delivery/.test(content) }).toEqual({ name, delegated: true })
    }
    expect(doc('statuses/3-in-progress.md')).toContain('sf agents delegation status')
    expect(doc('statuses/4-ai-testing.md')).toMatch(/never merges/)
    expect(doc('statuses/5-human-testing.md')).toMatch(/hands the defect to the ticket's own agent/)
    expect(doc('statuses/5-human-testing.md')).toMatch(/AI work the validation leaves/)
  })
})
