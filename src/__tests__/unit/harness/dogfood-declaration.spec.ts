import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import { resolve } from 'path'

import { planAgentInstructions } from '../../../harness/agent-instructions'
import { HARNESS_ALLOWED_COMMANDS, HARNESS_ASK_COMMANDS } from '../../../installers/harness.installer'

const ROOT = resolve(__dirname, '../../../..')
const CODEX_TIER_AGENTS = ['build', 'edit', 'fix', 'light', 'plan', 'terminal'].map((tier) => `.codex/agents/sf-${tier}.toml`)
const CLAUDE_TIER_AGENTS = ['build', 'edit', 'fix', 'light', 'plan', 'terminal'].map((tier) => `.claude/agents/sf-${tier}.md`)
const KIMI_TIER_AGENTS = ['build', 'edit', 'fix', 'light', 'plan', 'terminal'].map((tier) => `.kimi-code/agents/sf-${tier}.md`)

// The tests hash every baselined file of this repository, run git ls-files and project every skill: a loaded machine
// went past the former 20 s of the unit project (#1205). The bound is a hang guard, not what the tests check.
jest.setTimeout(90_000)

describe('SaaSFoundryAI shared harness dogfood declaration', () => {
  it('declares Claude Code, Codex and Kimi Code with reproducible tracked adapter baselines', async () => {
    const manifest = JSON.parse(await readFile(resolve(ROOT, '.saasfoundry.json'), 'utf8'))
    // We dogfood every provider we ship (FR-MAH-022): Kimi Code is declared in shared scope, so its tier agents are committed.
    expect(manifest.modules.harness.agents).toEqual(['claude-code', 'codex', 'kimi'])

    // AGENTS.md holds the project instructions since the harness v3 → v4 migration (#938)
    const agents = await readFile(resolve(ROOT, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('### Migration framework — NEVER bypass')
    expect(agents).toContain('<!-- saasfoundry:generated:start -->')
    expect(agents).toContain('Coding-agent identity and onboarding')
    expect(existsSync(resolve(ROOT, 'CLAUDE.md'))).toBe(false)
    expect(await readFile(resolve(ROOT, 'GEMINI.md'), 'utf8')).toContain('@AGENTS.md')

    const baselines = manifest.fileHashes as Record<string, string>
    expect(Object.keys(baselines)).toEqual(expect.arrayContaining(['GEMINI.md', '.claude/rules/claude-code.md', '.agents/skills/sf-workflow/workflow-cli.sh']))
    // A merged AGENTS.md (generated region) is never hash-tracked (#937)
    expect(baselines).not.toHaveProperty('AGENTS.md')
    // Only the generated tier agents (#929) carry a baseline under .codex/; the hooks file (#1035) is merged
    // into what the project has, like AGENTS.md, so it is shared and tracked without one. Its config stays private.
    expect(
      Object.keys(baselines)
        .filter((path) => path.startsWith('.codex/'))
        .sort()
    ).toEqual(CODEX_TIER_AGENTS)
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean)
    expect(tracked).toEqual(expect.arrayContaining(['AGENTS.md', 'GEMINI.md', '.agents/skills/sf-workflow/workflow-cli.sh']))
    expect(tracked.filter((path) => path.startsWith('.codex/')).sort()).toEqual([...CODEX_TIER_AGENTS, '.codex/hooks.json'].sort())
    // Kimi Code: only the six generated tier agents live under .kimi-code/, each with a baseline, and nothing of ~/.kimi-code is here
    expect(
      Object.keys(baselines)
        .filter((path) => path.startsWith('.kimi-code/'))
        .sort()
    ).toEqual(KIMI_TIER_AGENTS)
    expect(tracked.filter((path) => path.startsWith('.kimi-code/')).sort()).toEqual(KIMI_TIER_AGENTS)
    // The Claude Code and Codex tier agents are still the six each host has always had: declaring Kimi Code adds a folder, and changes neither
    expect(
      Object.keys(baselines)
        .filter((path) => path.startsWith('.claude/agents/'))
        .sort()
    ).toEqual(CLAUDE_TIER_AGENTS)
    expect(tracked.filter((path) => path.startsWith('.claude/agents/')).sort()).toEqual(CLAUDE_TIER_AGENTS)

    for (const [path, expected] of Object.entries(baselines)) {
      const content = await readFile(resolve(ROOT, path))
      expect(createHash('sha256').update(content).digest('hex')).toBe(expected)
    }
  })

  // The dogfood allowlist is what generated projects get (#947, #1026): a read-only command added to
  // the harness must be allowed here too, or this repository is the one that gets prompted.
  it('allows in its own .claude/settings.json every read-only command the harness allows elsewhere', async () => {
    const settings = JSON.parse(await readFile(resolve(ROOT, '.claude/settings.json'), 'utf8'))
    expect(settings.permissions.allow).toEqual(expect.arrayContaining([...HARNESS_ALLOWED_COMMANDS]))
    // The forms of an allowed command that write a route record ask first (Examine R6)
    expect(settings.permissions.ask).toEqual(expect.arrayContaining([...HARNESS_ASK_COMMANDS]))
  })

  // The developer works alone: this repository runs the Solo preset (#1242), which `sf workflow use solo` installs
  // without touching the release branch or the local CI statuses the project declares (#1233).
  it('declares the Solo workflow and keeps the release branch and the local CI statuses it had', async () => {
    const manifest = JSON.parse(await readFile(resolve(ROOT, '.saasfoundry.json'), 'utf8'))
    expect(manifest.workflow.template).toBe('SaaSFoundry Solo')
    expect(manifest.workflow.statuses.map((status: { name: string }) => status.name)).toEqual(['Backlog', 'In progress', 'AI testing', 'In review', 'Done'])
    expect(manifest.workflow.releaseBranch).toBe('master')
    expect(manifest.workflow.localCi.requiredStatuses).toHaveLength(11)
    // The workflow skill and its portable projection hold the Solo status documents, and none of the Team ones
    for (const dir of ['.claude/skills/sf-workflow/statuses', '.agents/skills/sf-workflow/statuses']) {
      const documents = (await readdir(resolve(ROOT, dir))).sort()
      expect({ dir, documents }).toEqual({
        dir,
        documents: ['1-backlog.md', '2-in-progress.md', '2a-ai-drafting.md', '2b-human-review.md', '2c-spawning.md', '3-ai-testing.md', '4-in-review.md', '5-done.md']
      })
    }
  })

  it('keeps the portable guarded CLIs byte-identical and executable', async () => {
    for (const relative of ['sf-workflow/workflow-cli.sh', 'sf-tool-github-projects/github-projects-cli.sh']) {
      const claudePath = resolve(ROOT, '.claude/skills', relative)
      const portablePath = resolve(ROOT, '.agents/skills', relative)
      expect(await readFile(portablePath)).toEqual(await readFile(claudePath))
      expect((await stat(portablePath)).mode & 0o111).not.toBe(0)
    }
  })

  it('commits exactly the skill copies the projector renders, so a refresh changes nothing (#984)', async () => {
    const manifest = JSON.parse(await readFile(resolve(ROOT, '.saasfoundry.json'), 'utf8'))
    const plan = await planAgentInstructions({ targetPath: ROOT, agents: manifest.modules.harness.agents, manifest })
    const projected = plan.files.filter((file) => file.path.startsWith('.agents/skills/'))
    expect(projected.map((file) => file.path)).toEqual(expect.arrayContaining(['.agents/skills/sf-srs/SKILL.md', '.agents/skills/sf-workflow/SKILL.md']))
    for (const file of projected) {
      // A failure here means a .claude/skills source changed: run `sf agents refresh --scope shared` and commit the result.
      expect({ path: file.path, content: (await readFile(resolve(ROOT, file.path))).toString('utf8') }).toEqual({ path: file.path, content: file.content.toString('utf8') })
    }
  })
})
