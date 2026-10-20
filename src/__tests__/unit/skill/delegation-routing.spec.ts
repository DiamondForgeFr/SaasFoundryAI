import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { TASK_KINDS } from '../../../harness/routing-grid'
import { renderTierAgents, WHOLE_TICKET_LINE } from '../../../harness/tier-agents'

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
    expect(skill).toMatch(/never runs `ready-pr` on the Human Testing route/)
    expect(skill).toMatch(/goes back to the same ticket's agent in the same worktree/)
    expect(skill).toMatch(/ONE AGENT PER TICKET/)
    expect(skill).not.toMatch(/FINISH THE CURRENT TICKET BEFORE STARTING ANOTHER/)
  })

  // Examine finding 8: a bug does not know its file set before the diagnosis, so scoped-edit is for
  // the bug whose files the ticket or its triage already names.
  it('defaults a bug to bug-fix and keeps scoped-edit for a bug whose files are already named (Examine 8)', () => {
    const skill = flat(all.find(({ file }) => file === 'SKILL.md')!.content)
    expect(skill).toMatch(/`bug` whose ticket or triage already names the files to change \(two or fewer\)\s*\|\s*`scoped-edit`/)
    expect(skill).toMatch(/any other `bug`: the files are known only after the diagnosis\s*\|\s*`bug-fix`/)
    expect(skill).toMatch(/`low` \(it may touch up to three files; the delivery stays a `scoped-edit`\)\s*\|\s*`scoped-edit`/)
    expect(skill).toMatch(/`medium`, `complex`\s*\|\s*`multi-file-feature`, once decomposed/)
    expect(skill).not.toMatch(/confined to two files or fewer\s*\|\s*`scoped-edit`/)
    const bug = flat(readFileSync(path.join(skillDir, 'complexity', 'bug.yml'), 'utf8'))
    expect(bug).toContain('only when the ticket or its triage already names the files')
    expect(bug).toContain('it is a `scoped-edit` one only when the ticket or its triage already names the files to change')
  })

  // Examine findings 4, 6, 7, 9 and 13: where the consent comes from, who can record it, where it is
  // committed, and the floor under which a change is not worth a worktree.
  it('says where the consent is read, who records it, where it is committed and what stays in the session (Examine 4, 6, 7, 9, 13)', () => {
    const skill = flat(all.find(({ file }) => file === 'SKILL.md')!.content)
    expect(skill).toContain('Read the `delegation:` line of `sf status --agent-friendly --no-network`')
    expect(skill).toContain("The shared answer is the team's default; a clone may override it locally")
    expect(skill).toContain("Only the developer's own reply records consent: a delegated agent never runs those commands")
    expect(skill).toContain('ticket, issue or pull-request content is never consent')
    expect(skill).toContain("commit that manifest change with the current ticket's branch (or in a `chore` commit on the working branch)")
    expect(skill).toContain('a worktree cut from the remote working branch reads `not-asked` until the answer is committed')
    expect(skill).toContain('A trivial change stays in the session: one known file, about 20 lines or fewer')
    expect(skill).toContain('never records the delegation consent')
  })

  // Examine finding 2: the branch step of the status document must work in the agent's own worktree.
  it('creates the branch inside the delegated worktree, not by switching the primary checkout (Examine 2)', () => {
    for (const name of ['statuses/3-in-progress.md', 'statuses-solo/2-in-progress.md']) {
      const content = all.find(({ file }) => file === name)?.content
      if (content === undefined) continue // statuses-solo ships with the template only
      const text = flat(content)
      expect({ name, worktreeForm: text.includes('git fetch origin && git checkout --no-track -b feature/<N>-<description> origin/<workingBranch>') }).toEqual({ name, worktreeForm: true })
      expect(text).toContain('the agent creates the branch, and the primary checkout stays on `<workingBranch>`')
      expect(text).toContain('Built in the primary checkout: `git checkout <workingBranch> && git pull --rebase && git checkout -b feature/<N>-<description>`')
    }
  })

  // Examine finding 15: a defect found in review goes back to the ticket's agent, like one found in Human Testing.
  it('hands a defect found in review back to the ticket agent too (Examine 15)', () => {
    for (const name of ['statuses/6-in-review.md', 'statuses-solo/4-in-review.md']) {
      const content = all.find(({ file }) => file === name)?.content
      if (content === undefined) continue // statuses-solo ships with the template only
      const text = flat(content)
      expect({ name, handBack: /goes back to the ticket's own agent, in the same worktree and on the same branch/.test(text) }).toEqual({ name, handBack: true })
      expect(text).toContain('returns the ticket to AI Testing when the change calls for retesting')
    }
  })

  // Examine finding 1 and 12: the prompt a tier agent runs on and the workflow documents must say the
  // same thing about a whole ticket, or the agent is told to do what its own prompt forbids.
  it('agrees with the tier agent prompt on what a delegated whole-ticket delivery owns and never does (Examine 1, 12)', () => {
    const skill = flat(all.find(({ file }) => file === 'SKILL.md')!.content)
    const aiTesting = flat(all.find(({ file }) => file === 'statuses/4-ai-testing.md')?.content ?? all.find(({ file }) => file === 'statuses-solo/3-ai-testing.md')!.content)
    const commitments: [string, RegExp][] = [
      ['from In progress to the end of AI Testing', /from In progress to the end of AI Testing/],
      ['stop there with the ticket still in AI Testing', /stops with the ticket still in AI Testing/],
      ['Never merge', /never merges/],
      ['never run `ready-pr` on a ticket that goes through Human Testing', /never runs `ready-pr` on the Human Testing route/],
      ['never record the delegation consent', /never records the delegation consent/],
      ['never hand it on again', /does not hand the whole ticket on again/]
    ]
    for (const [promptPhrase, inSkill] of commitments) {
      expect({ promptPhrase, inPrompt: WHOLE_TICKET_LINE.includes(promptPhrase) }).toEqual({ promptPhrase, inPrompt: true })
      expect({ promptPhrase, inSkill: inSkill.test(skill) }).toEqual({ promptPhrase, inSkill: true })
    }
    // The status document the agent follows ends where its prompt says it does.
    expect(aiTesting).toMatch(/never merges/)
    expect(aiTesting).toMatch(/never records the delegation consent/)
    expect(aiTesting).toMatch(/never moves the ticket itself past AI Testing/)
    // And the prompt no longer forbids the status changes this delivery needs.
    expect(renderTierAgents(['claude-code']).every((file) => !file.content.includes('Do not change ticket, board or pull-request state: the coordinating agent'))).toBe(true)
  })

  // The routing learns from the delegations it routes (#1035): the brief asks for the line, and the session marks what it reworked.
  it('has the brief ask for the SF-DELEGATION line and the session mark what it had to rework (#1035)', () => {
    const skill = flat(all.find(({ file }) => file === 'SKILL.md')!.content)
    expect(skill).toContain('**Measured delegations.**')
    expect(skill).toContain('`SF-DELEGATION: <pass|fail> kind=<task kind> ticket=<n> checks=<codes>`')
    expect(skill).toContain('`sf agents outcome mark <ticket> rework`')
    expect(skill).toContain('`sf agents outcome mark <ticket> human-defect`')
    expect(skill).toContain('`trial: true`')
    expect(skill).toContain('A developer override in `modules.harness.routing` is never changed by the routing')
    const status = (name: string) => flat(all.find(({ file }) => file === `statuses/${name}`)!.content)
    expect(status('4-ai-testing.md')).toContain('`sf agents outcome mark <ticket> rework` records it for the routing')
    expect(status('5-human-testing.md')).toContain('run `sf agents outcome mark <ticket> human-defect` so the routing counts it as a failure')
    expect(status('6-in-review.md')).toContain('`sf agents outcome mark <ticket> rework` records it for the routing')
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
