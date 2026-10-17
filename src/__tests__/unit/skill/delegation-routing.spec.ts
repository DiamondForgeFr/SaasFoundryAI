import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { TASK_KINDS } from '../../../harness/routing-grid'

const REPO_ROOT = path.resolve(__dirname, '../../../..')

const SKILL_COPIES = [
  ['template', path.join(REPO_ROOT, 'scaffolds/skills-templates/workflow')],
  ['dogfood copy', path.join(REPO_ROOT, '.claude/skills/sf-workflow')]
] as const

const DELEGATING_DIRS = ['complexity', 'scripts', 'statuses', 'statuses-solo']

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
    for (const level of ['medium', 'complex']) {
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
})
