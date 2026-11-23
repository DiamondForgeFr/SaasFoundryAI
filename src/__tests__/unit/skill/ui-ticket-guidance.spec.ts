import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { planAgentInstructions, withGeneratedRegion } from '../../../harness/agent-instructions'
import { installWorkflowSkill } from '../../../installers/workflow-skill.installer'
import type { WorkflowConfig } from '../../../types'

const REPO_ROOT = path.resolve(__dirname, '../../../..')

const SKILL_COPIES = [
  ['template', path.join(REPO_ROOT, 'scaffolds/skills-templates/workflow')],
  ['dogfood copy', path.join(REPO_ROOT, '.claude/skills/sf-workflow')]
] as const

const flat = (text: string): string => text.replace(/\s+/g, ' ')

const HEADING = '### Working a `ui` ticket'

/** The UI-ticket section of the workflow skill, from its heading to the next `##` section. */
function uiSection(skillDir: string): string {
  const skill = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')
  const start = skill.indexOf(HEADING)
  if (start < 0) throw new Error(`${skillDir}/SKILL.md has no "${HEADING}" section`)
  const end = skill.indexOf('\n## ', start)
  return skill.slice(start, end < 0 ? undefined : end)
}

/** The numbered items of the section, each one flattened to a single line. */
function items(section: string): string[] {
  return section
    .split(/\n(?=\d+\. \*\*)/)
    .slice(1)
    .map(flat)
}

// FR-WORKFLOW-08 (#1306): the way every coding agent works a `ui` ticket is one text, in the workflow skill
// and its checklist, and it names capabilities, never the tool of one host.
describe.each(SKILL_COPIES)('UI ticket guidance of the workflow skill — %s (#1306)', (_label, skillDir) => {
  const section = uiSection(skillDir)
  const steps = items(section)

  it('sits right after the UI mockup gate and before the ticket hierarchy', () => {
    const skill = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')
    expect(skill.indexOf('## 🖼️ UI mockup gate')).toBeGreaterThan(-1)
    expect(skill.indexOf(HEADING)).toBeGreaterThan(skill.indexOf('## 🖼️ UI mockup gate'))
    expect(skill.indexOf(HEADING)).toBeLessThan(skill.indexOf('## 🧩 Ticket Hierarchy'))
    expect(steps).toHaveLength(6)
  })

  it('has the agent load the design and UX skills its host offers and work as a UI/UX professional', () => {
    expect(steps[0]).toContain('**Work as a UI/UX professional.**')
    expect(steps[0]).toContain('load the design and UX skills your host offers')
    expect(steps[0]).toContain("the project's own design tokens and components")
    // A host with none is not blocked: the checklist is the floor
    expect(steps[0]).toContain('A host that offers none works from the checklist')
  })

  it('points to the UI checklist that ships next to SKILL.md, with its five parts', () => {
    expect(steps[1]).toContain('[ui-checklist.md](ui-checklist.md)')
    expect(steps[1]).toContain('hierarchy; spacing and design tokens; states (empty, loading, error, disabled); accessibility (contrast, keyboard, focus, labels); copy')
    expect(existsSync(path.join(skillDir, 'ui-checklist.md'))).toBe(true)
  })

  it('makes one self-contained HTML file the mockup floor, kept with the ticket evidence and recorded by its path', () => {
    expect(steps[2]).toContain('one self-contained HTML file')
    expect(steps[2]).toContain('inline CSS, no build step')
    expect(steps[2]).toContain('opens in any browser')
    expect(steps[2]).toContain("Keep it with the ticket's evidence")
    expect(steps[2]).toContain('`record-ui-validation --mockup`')
    // A richer surface is an addition, never a replacement
    expect(steps[2]).toContain('may be added next to it, never in its place')
  })

  it('shows the mockup before the visual implementation while spec, model, data and tests may start', () => {
    expect(steps[3]).toContain('**Show the mockup before the visual implementation.**')
    expect(steps[3]).toContain("Spec, model, data and tests may start meanwhile; only the visual part (components, pages, styles) waits for the developer's OK")
  })

  it("leaves where a mockup is shown and the design tokens to the project's own AGENTS.md, outside the generated region", () => {
    expect(steps[3]).toContain("are stated in the project's own `AGENTS.md`, outside the generated region")
    // Without such a statement the agent still has a way to show it
    expect(steps[3]).toContain('give the developer the path of the file to open in a browser')
  })

  it('skips the mockup when the developer supplies the visuals', () => {
    expect(steps[4]).toContain('**When the developer supplies the visuals**')
    expect(steps[4]).toContain('`record-ui-validation <ticket> --supplied "<what the developer supplied>"`')
    expect(steps[4]).toContain('make no mockup')
  })

  it("has a delegated agent hold the visual part until the session relays the developer's OK", () => {
    expect(steps[5]).toContain('**A delegated agent holds the visual part.**')
    expect(steps[5]).toContain('Only the session talks to the developer')
    expect(steps[5]).toContain('relays the OK to the same agent, in the same worktree')
    expect(steps[5]).toContain('builds the visual part from the validated mockup')
    expect(steps[5]).toContain('An agent never records an approval the developer did not give')
  })

  // AC-3: no step requires a host-specific tool. Claude artifacts and Figma appear only as the optional extra of the mockup step.
  it('requires no host-specific tool: a Claude artifact or a Figma frame is only an optional extra', () => {
    for (const [index, step] of steps.entries()) {
      if (index !== 2) expect({ index, host: step.match(/artifact|figma/i) }).toEqual({ index, host: null })
    }
    expect(steps[2]).toMatch(/A richer surface the host offers \(a Claude artifact, a Figma frame\) may be added/)
    expect(flat(section)).toContain('it names capabilities, never the tool of one host')
    expect(section).not.toMatch(/mcp__|frontend-design|design:|claude-in-chrome|playwright|\bSkill tool\b|\bTask tool\b|\/(?:design|frontend)[:-]/i)
  })

  it('carries the hold-the-visual-part clause in the brief of a ui ticket (AC-2)', () => {
    const skill = flat(readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'))
    const brief = skill.slice(skill.indexOf('**Brief the agent**'), skill.indexOf("**The agent's line.**"))
    expect(brief).toContain('For a ticket marked `ui` the brief carries one more clause')
    expect(brief).toContain("**hold the visual part until the session relays the developer's OK, and follow the validated mockup**")
    expect(brief).toContain('"Working a `ui` ticket" in the UI mockup gate above')
    // The mockup may already be validated when the ticket is delegated: then there is nothing to hold
    expect(brief).toContain('When the developer has already approved the mockup, the brief names it instead and there is nothing to hold')
  })

  it('points the In progress status document at the section', () => {
    const solo = ['statuses-solo/2-in-progress.md', 'statuses/2-in-progress.md', 'statuses/3-in-progress.md'].map((file) => path.join(skillDir, file)).filter(existsSync)
    expect(solo.length).toBeGreaterThan(0)
    for (const file of solo) {
      const doc = flat(readFileSync(file, 'utf8'))
      expect({ file: path.basename(file), ui: doc.includes('**A `ui` ticket**') }).toEqual({ file: path.basename(file), ui: true })
      expect(doc).toContain('SKILL.md → "Working a `ui` ticket"')
      expect(doc).toContain('The brief of a delegated agent carries that hold')
    }
  })

  describe('the UI checklist', () => {
    const checklist = readFileSync(path.join(skillDir, 'ui-checklist.md'), 'utf8')
    const part = (heading: string): string => {
      const start = checklist.indexOf(`## ${heading}\n`)
      if (start < 0) throw new Error(`ui-checklist.md has no "${heading}" part`)
      const end = checklist.indexOf('\n## ', start + 1)
      return flat(checklist.slice(start, end < 0 ? undefined : end))
    }

    it('covers hierarchy, spacing and design tokens, states, accessibility and copy', () => {
      const headings = [...checklist.matchAll(/^## (.+)$/gm)].map((match) => match[1])
      expect(headings.slice(0, 5)).toEqual(['Hierarchy', 'Spacing and design tokens', 'States', 'Accessibility', 'Copy'])
    })

    it('draws the empty, loading, error and disabled states', () => {
      const states = part('States')
      for (const state of ['**Empty**', '**Loading**', '**Error**', '**Disabled**']) expect(states).toContain(state)
    })

    it('checks contrast, keyboard, focus and labels', () => {
      const accessibility = part('Accessibility')
      for (const check of ['**Contrast**', '**Keyboard**', '**Focus**', '**Labels**']) expect(accessibility).toContain(check)
      expect(accessibility).toContain('4.5:1')
    })

    it("takes colours and spacing from the project's design tokens", () => {
      const tokens = part('Spacing and design tokens')
      expect(tokens).toContain("the project's design tokens")
      expect(tokens).toContain("the project's `AGENTS.md` says where they live")
    })

    it('describes the mockup file as one HTML file with inline CSS and no network request', () => {
      const file = part('The mockup file')
      expect(file).toContain('One HTML file with its CSS inline, no build step and no request to the network')
      expect(file).toContain('it opens in any browser from its path')
    })

    it('names no tool of one host', () => {
      expect(checklist).not.toMatch(/mcp__|frontend-design|claude-in-chrome|playwright|\bSkill tool\b|\bFigma\b|\bartifact\b/i)
    })
  })
})

describe('UI ticket guidance reaches the shared agent copies and the generated projects (#1306)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sf-ui-guidance-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const WORKFLOWS: [string, WorkflowConfig][] = [
    [
      'Team',
      {
        tool: 'github-projects',
        template: 'SaaSFoundry AI Workflow',
        workingBranch: 'develop',
        statuses: [
          { name: 'Backlog', color: 'GRAY' },
          { name: 'Ready', color: 'YELLOW' },
          { name: 'In Progress', color: 'BLUE' },
          { name: 'AI Testing', color: 'PURPLE' },
          { name: 'Human Testing', color: 'ORANGE' },
          { name: 'In Review', color: 'PINK' },
          { name: 'Done', color: 'GREEN' }
        ]
      }
    ],
    [
      'Solo',
      {
        tool: 'github-projects',
        template: 'SaaSFoundry Solo',
        workingBranch: 'main',
        statuses: [
          { name: 'Backlog', color: 'GRAY' },
          { name: 'In Progress', color: 'BLUE' },
          { name: 'AI Testing', color: 'PURPLE' },
          { name: 'In Review', color: 'PINK' },
          { name: 'Done', color: 'GREEN' }
        ]
      }
    ]
  ]

  it.each(WORKFLOWS)('deposits the checklist and the section in a project that installs the %s workflow skill', async (_preset, workflow) => {
    await installWorkflowSkill({ targetPath: dir, workflow })
    const skillDir = path.join(dir, '.claude', 'skills', 'sf-workflow')

    const checklist = await readFile(path.join(skillDir, 'ui-checklist.md'), 'utf8')
    expect(checklist).toBe(readFileSync(path.join(REPO_ROOT, 'scaffolds/skills-templates/workflow/ui-checklist.md'), 'utf8'))
    const skill = await readFile(path.join(skillDir, 'SKILL.md'), 'utf8')
    expect(skill).toContain(HEADING)
    expect(skill).not.toMatch(/\{\{[A-Z_]+\}\}/)
    // The link of the section resolves next to SKILL.md
    expect(existsSync(path.join(skillDir, 'ui-checklist.md'))).toBe(true)
  })

  it('projects the checklist and the section into .agents/skills/sf-workflow for the hosts that read the shared copies', async () => {
    const [, solo] = WORKFLOWS[1]
    await installWorkflowSkill({ targetPath: dir, workflow: solo })
    await writeFile(path.join(dir, 'AGENTS.md'), withGeneratedRegion('# Project\n'))
    await mkdir(path.join(dir, '.git'), { recursive: true })

    const plan = await planAgentInstructions({ targetPath: dir, agents: ['codex', 'kimi'] })

    const projected = new Map(plan.files.map((file) => [file.path, file.content.toString('utf8')]))
    expect(projected.get('.agents/skills/sf-workflow/ui-checklist.md')).toBe(readFileSync(path.join(REPO_ROOT, '.claude/skills/sf-workflow/ui-checklist.md'), 'utf8'))
    const skill = projected.get('.agents/skills/sf-workflow/SKILL.md')
    expect(skill).toContain(HEADING)
    expect(flat(skill ?? '')).toContain("**hold the visual part until the session relays the developer's OK, and follow the validated mockup**")
  })

  it('keeps the committed .agents copy of this repository in step with the dogfood skill', () => {
    expect(readFileSync(path.join(REPO_ROOT, '.agents/skills/sf-workflow/ui-checklist.md'), 'utf8')).toBe(readFileSync(path.join(REPO_ROOT, '.claude/skills/sf-workflow/ui-checklist.md'), 'utf8'))
    const shared = readFileSync(path.join(REPO_ROOT, '.agents/skills/sf-workflow/SKILL.md'), 'utf8')
    expect(shared).toContain(HEADING)
    expect(flat(shared)).toContain("**hold the visual part until the session relays the developer's OK, and follow the validated mockup**")
  })
})
