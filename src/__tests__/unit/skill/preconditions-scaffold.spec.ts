import { readFileSync } from 'fs'
import path from 'path'

import { GENERATED_INSTRUCTIONS, GENERATED_REGION_START } from '../../../harness/agent-instructions'

// Regression guard for #243: every AGENTS.md shipped by a SaaSFoundryAI scaffold
// (CLAUDE.md before #937) must carry the "Preconditions first" directive, and every scaffolded
// `.claude/` must ship a `settings.json` wiring a SessionStart hook that calls
// `sf status --claude-friendly`. If a new blueprint or overlay forgets either,
// generated projects will regress to re-asking scope questions already answered
// by the manifest.
const ROOT = path.resolve(__dirname, '../../../..')

const AGENTS_MD_SCAFFOLDS = [
  path.resolve(ROOT, 'scaffolds/blueprints/api/AGENTS.md'),
  path.resolve(ROOT, 'scaffolds/blueprints/web/AGENTS.md'),
  path.resolve(ROOT, 'scaffolds/overlays/monorepo/root/AGENTS.md'),
  path.resolve(ROOT, 'scaffolds/skills-templates/harness/AGENTS.md')
]

const SETTINGS_SCAFFOLDS = [
  path.resolve(ROOT, 'scaffolds/blueprints/api/.claude/settings.json'),
  path.resolve(ROOT, 'scaffolds/blueprints/web/.claude/settings.json'),
  path.resolve(ROOT, 'scaffolds/overlays/monorepo/root/.claude/settings.json')
]

describe('Preconditions first directive (scaffold mirrors)', () => {
  it.each(AGENTS_MD_SCAFFOLDS)('%s contains the Preconditions first section', (file) => {
    const content = readFileSync(file, 'utf8')
    expect(content).toMatch(/Preconditions first/)
    expect(content).toMatch(/\.saasfoundry\.json/)
    expect(content).toMatch(/sf status --agent-friendly/)
    expect(content).not.toMatch(/--claude-friendly/)
  })

  // The onboarding contract is generated into the root file's region (#937), so a
  // template cannot drift from it; the multirepo builders add the region to the app files.
  it('the root templates carry the generated region holding the coding-agent onboarding contract', () => {
    for (const file of AGENTS_MD_SCAFFOLDS.slice(2)) expect(readFileSync(file, 'utf8')).toContain(GENERATED_REGION_START)
    expect(GENERATED_INSTRUCTIONS).toMatch(/Coding-agent identity and onboarding/)
    expect(GENERATED_INSTRUCTIONS).toMatch(/sf agents list --json/)
    expect(GENERATED_INSTRUCTIONS).toMatch(/sf agents enable/)
    expect(GENERATED_INSTRUCTIONS).toMatch(/sf agents replace/)
  })

  // The repository's own instructions moved to AGENTS.md with the harness v3 → v4 migration (#938)
  it('repo-root AGENTS.md contains the Preconditions first section', () => {
    const content = readFileSync(path.resolve(ROOT, 'AGENTS.md'), 'utf8')
    expect(content).toMatch(/Preconditions first/)
    expect(content).toMatch(/\.saasfoundry\.json/)
    expect(content).toMatch(/sf status --agent-friendly/)
  })

  it('the generated region previews profile promotion instead of scaffolding over existing code', () => {
    expect(GENERATED_INSTRUCTIONS).toContain('sf status --agent-friendly --no-network')
    expect(GENERATED_INSTRUCTIONS).toContain('sf update --target-profile full --dry-run --json')
    expect(GENERATED_INSTRUCTIONS).toContain('Do not run\n`sf new --profile full` inside an existing repository')
  })
})

describe('SessionStart hook (scaffold mirrors)', () => {
  it.each(SETTINGS_SCAFFOLDS)('%s wires a SessionStart hook calling sf status', (file) => {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const sessionStart = parsed?.hooks?.SessionStart
    expect(Array.isArray(sessionStart)).toBe(true)
    expect(sessionStart.length).toBeGreaterThan(0)
    const commands: string[] = sessionStart.flatMap((entry: { hooks?: Array<{ type?: string; command?: string }> }) =>
      (entry.hooks ?? []).filter((h) => h.type === 'command').map((h) => h.command ?? '')
    )
    expect(commands.some((cmd: string) => cmd.includes('sf status') && cmd.includes('--claude-friendly'))).toBe(true)
  })

  it('repo-root .claude/settings.json wires a SessionStart hook calling sf status', () => {
    const parsed = JSON.parse(readFileSync(path.resolve(ROOT, '.claude/settings.json'), 'utf8'))
    const sessionStart = parsed?.hooks?.SessionStart
    expect(Array.isArray(sessionStart)).toBe(true)
    const commands: string[] = sessionStart.flatMap((entry: { hooks?: Array<{ type?: string; command?: string }> }) =>
      (entry.hooks ?? []).filter((h) => h.type === 'command').map((h) => h.command ?? '')
    )
    expect(commands.some((cmd: string) => cmd.includes('sf status') && cmd.includes('--claude-friendly'))).toBe(true)
  })
})
