import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'

import { normalizeSkill } from '../../../harness/agent-instructions'

const ROOT = resolve(__dirname, '../../../..')

/** Every SKILL.md a project receives, from the templates and this repository's own copies. */
function skillFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return skillFiles(path)
    return entry === 'SKILL.md' ? [path] : []
  })
}

const files = [...skillFiles(join(ROOT, 'scaffolds/skills-templates')), ...skillFiles(join(ROOT, '.claude/skills'))].map((path) => relative(ROOT, path))

// #829 — three skills had no frontmatter, so Claude Code listed them by their title and the
// `.agents` projection gave them a generic description: their trigger keywords reached no agent
describe('skill frontmatter', () => {
  it('finds the deposited skills', () => {
    expect(files).toEqual(expect.arrayContaining(['scaffolds/skills-templates/sf-srs/SKILL.md', 'scaffolds/skills-templates/workflow/SKILL.md', '.claude/skills/sf-workflow/SKILL.md']))
  })

  it.each(files)('%s declares a name and a description the agent projection keeps', (file) => {
    const content = readFileSync(join(ROOT, file), 'utf8')
    const warnings: string[] = []

    const projected = normalizeSkill(content, 'sf-skill', file, warnings)

    expect(content.startsWith('---\n')).toBe(true)
    expect(content).toMatch(/^---\n(?:[\s\S]*\n)?name: \S+\n/)
    expect(warnings.filter((warning) => /generated discovery metadata|malformed frontmatter/.test(warning))).toEqual([])
    const description = JSON.parse(/^description: (.*)$/m.exec(projected ?? '')?.[1] ?? '""') as string
    expect(description.length).toBeGreaterThan(40)
    expect(description.length).toBeLessThanOrEqual(1024)
  })
})
