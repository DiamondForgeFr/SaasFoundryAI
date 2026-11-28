import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { installHarness } from '../../../installers/harness.installer'
import { WORKFLOW_PRESETS, workflowConfigFromPreset } from '../../../prompts/workflow.prompts'

const SKILL_DIR = '.claude/skills/sf-workflow'

/** Prettier rewraps lines: compare on single spaces. */
const flat = (text: string): string => text.replace(/\s+/g, ' ')

/** The text of the `**Nature guard**` bullet of the installed SKILL.md, up to the next bullet. */
function natureGuardBullet(skill: string): string {
  const match = /- \*\*Nature guard\*\*:? (.*?)(?= - \*\*|$)/.exec(flat(skill))
  if (!match) throw new Error('The installed SKILL.md has no "Nature guard" bullet')
  return match[1]
}

/** The `## Nature axis` section of the installed SKILL.md, up to the next heading. */
function natureAxisSection(skill: string): string {
  const match = /## Nature axis(.*?)(?= ## |$)/.exec(flat(skill))
  if (!match) throw new Error('The installed SKILL.md has no "Nature axis" section')
  return match[1]
}

// The Team rule: from AI Testing, In Review needs `nature:internal` unless the ticket goes through Human Testing.
const TEAM_RULE = /refuses `→ In Review` from AI Testing when the workflow declares a Human Testing status and the ticket is not `nature:internal`/
// The Solo rule: a workflow without Human Testing asks for no `nature:*` label on that move.
const SOLO_GUARD_RULE = /a workflow without that status \(Solo\) asks for no label/
const SOLO_AXIS_RULE = /declares no Human Testing status \(Solo\).*`AI Testing → In Review` needs no label/
// The pre-#1354 wording, stated with no preset condition: what a Solo project must never receive again.
const UNCONDITIONAL_TEAM_RULE = /requires `nature:internal`/

async function install(preset: keyof typeof WORKFLOW_PRESETS): Promise<{ dir: string; skill: string; statuses: Map<string, string> }> {
  const dir = await mkdtemp(path.join(tmpdir(), `sf-nature-wording-${preset}-`))
  const { workflow } = workflowConfigFromPreset(preset, 'github-projects')
  await installHarness({ targetPath: dir, projectName: 'acme', version: '0.0.0-test', workflow })
  const skill = await readFile(path.join(dir, SKILL_DIR, 'SKILL.md'), 'utf8')
  const statuses = new Map<string, string>()
  for (const name of await readdir(path.join(dir, SKILL_DIR, 'statuses'))) statuses.set(name, await readFile(path.join(dir, SKILL_DIR, 'statuses', name), 'utf8'))
  return { dir, skill, statuses }
}

// #1341: Solo projects received the Team wording of the nature guard ("`→ In Review` from AI Testing requires
// `nature:internal`"), a label the Solo guard never asks for. Each preset must state its own rule, in the files the
// installer really deposits.
describe('the nature guard wording a generated project receives (#1341)', () => {
  const dirs: string[] = []
  let warnSpy: jest.SpyInstance
  beforeAll(() => {
    // The instruction install warns about what it cannot verify on a host: not what this test reads.
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterAll(async () => {
    warnSpy.mockRestore()
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  })

  describe('SaaSFoundry Solo', () => {
    let installed: Awaited<ReturnType<typeof install>>
    beforeAll(async () => {
      installed = await install('solo')
      dirs.push(installed.dir)
    })

    it('states in SKILL.md that AI Testing → In Review needs no nature label', () => {
      expect(natureGuardBullet(installed.skill)).toMatch(SOLO_GUARD_RULE)
      expect(natureAxisSection(installed.skill)).toMatch(SOLO_AXIS_RULE)
    })

    it('never states the nature:internal requirement without its Human Testing condition', () => {
      expect(flat(installed.skill)).not.toMatch(UNCONDITIONAL_TEAM_RULE)
      // Where SKILL.md names the requirement, it is tied to a workflow that declares Human Testing.
      expect(natureGuardBullet(installed.skill)).toMatch(TEAM_RULE)
    })

    it('ships status documents that carry no Team-only route', () => {
      expect([...installed.statuses.keys()].filter((name) => /human-testing|ready/.test(name))).toEqual([])
      for (const [name, text] of installed.statuses) {
        expect({ name, internal: /nature:internal|nature:user-facing/.test(text) }).toEqual({ name, internal: false })
        expect({ name, humanTesting: /→\s*\**Human Testing/i.test(text) }).toEqual({ name, humanTesting: false })
      }
    })

    it('sends a ticket from AI Testing to In Review by default', () => {
      const aiTesting = installed.statuses.get('3-ai-testing.md') ?? ''
      expect(aiTesting).toMatch(/^next_status: In Review /m)
    })
  })

  describe('SaaSFoundry Team', () => {
    let installed: Awaited<ReturnType<typeof install>>
    beforeAll(async () => {
      installed = await install('saasfoundry')
      dirs.push(installed.dir)
    })

    it('states in SKILL.md that AI Testing → In Review needs nature:internal unless the ticket goes through Human Testing', () => {
      expect(natureGuardBullet(installed.skill)).toMatch(TEAM_RULE)
      expect(natureAxisSection(installed.skill)).toMatch(/`nature:user-facing` \(the default when a ticket has no `nature:\*` label\): `AI Testing → Human Testing → In Review → Done`/)
      expect(natureAxisSection(installed.skill)).toMatch(/`nature:internal` \([^)]*\): `AI Testing → In Review → Done`/)
    })

    it('routes the AI Testing document through Human Testing by default and to In Review for nature:internal', () => {
      const aiTesting = installed.statuses.get('4-ai-testing.md') ?? ''
      expect(aiTesting).toMatch(/^next_status: Human Testing \(default[^|]*\| In Review \(nature:internal/m)
      expect(installed.statuses.has('5-human-testing.md')).toBe(true)
    })
  })
})
