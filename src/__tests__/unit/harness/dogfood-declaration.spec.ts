import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { readFile, stat } from 'fs/promises'
import { resolve } from 'path'

import { planAgentInstructions } from '../../../harness/agent-instructions'

const ROOT = resolve(__dirname, '../../../..')

describe('SaaSFoundryAI shared harness dogfood declaration', () => {
  it('declares Claude Code and Codex with reproducible tracked adapter baselines', async () => {
    const manifest = JSON.parse(await readFile(resolve(ROOT, '.saasfoundry.json'), 'utf8'))
    expect(manifest.modules.harness.agents).toEqual(['claude-code', 'codex'])

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
    expect(Object.keys(baselines).some((path) => path.startsWith('.codex/'))).toBe(false)
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean)
    expect(tracked).toEqual(expect.arrayContaining(['AGENTS.md', 'GEMINI.md', '.agents/skills/sf-workflow/workflow-cli.sh']))
    expect(tracked.some((path) => path.startsWith('.codex/'))).toBe(false)

    for (const [path, expected] of Object.entries(baselines)) {
      const content = await readFile(resolve(ROOT, path))
      expect(createHash('sha256').update(content).digest('hex')).toBe(expected)
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
