import { execFile } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const REPO_ROOT = path.resolve(__dirname, '../../../..')

// The template ships double-quoted profiles; the formatted dogfood copies use
// single quotes. Both must read the same values (#961).
const SKILL_COPIES = [
  ['template', path.join(REPO_ROOT, 'scaffolds/skills-templates/workflow')],
  ['dogfood copy', path.join(REPO_ROOT, '.claude/skills/sf-workflow')]
] as const

async function script(skillDir: string, name: string, args: string[], cwd?: string): Promise<string> {
  const { stdout } = await exec('/bin/bash', [path.join(skillDir, 'scripts', name), ...args], { cwd })
  return stdout
}

describe.each(SKILL_COPIES)('workflow profile readers — %s (#961)', (_label, skillDir) => {
  it('analyze.sh and plan.sh skip the bug profile instead of reading the next block', async () => {
    const analyze = await script(skillDir, 'analyze.sh', ['1', 'bug'])
    const plan = await script(skillDir, 'plan.sh', ['1', 'bug'])
    expect(analyze).toContain('Analysis SKIPPED')
    expect(plan).toContain('Planning SKIPPED')
    expect(analyze + plan).not.toContain('Unknown complexity')
  })

  it.each([
    ['low', 'minimal', '0', 'minimal', 'false'],
    ['medium', 'standard', '3', 'detailed', 'true'],
    ['complex', 'deep', '7', 'comprehensive', 'true']
  ])('reads one value per key for %s, without quotes', async (level, analyzeDepth, agents, planDepth, approval) => {
    const analyze = await script(skillDir, 'analyze.sh', ['1', level])
    const plan = await script(skillDir, 'plan.sh', ['1', level])
    expect(analyze).toContain(`Depth: ${analyzeDepth}\nAgents: ${agents}\n`)
    expect(plan).toContain(`Depth: ${planDepth}\nApproval required: ${approval}\n`)
  })

  it('detect-complexity.sh prints the profile description without its quotes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sf-detect-cplx-'))
    try {
      const toolDir = path.join(dir, '.claude/skills/sf-tool-github-projects')
      await mkdir(toolDir, { recursive: true })
      await writeFile(path.join(dir, '.saasfoundry.json'), JSON.stringify({ workflow: { tool: 'github-projects' } }))
      const tool = path.join(toolDir, 'github-projects-cli.sh')
      writeFileSync(tool, "#!/bin/bash\nprintf 'Title: Fix a typo\\nDescription:\\nA small bug in a label.\\n'\n")
      chmodSync(tool, 0o755)

      const out = await script(skillDir, 'detect-complexity.sh', ['1'], dir)
      const meaning = out.split('\n').find((line) => line.includes('What this means:'))
      expect(meaning).toBeDefined()
      expect(meaning).toMatch(/What this means:\S* \w/)
      expect(meaning).not.toMatch(/["']/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
