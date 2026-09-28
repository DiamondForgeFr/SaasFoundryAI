import { mkdir, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { collectStatus } from '../../../status/collect'

async function makeSkill(skillsRoot: string, name: string) {
  await mkdir(join(skillsRoot, name), { recursive: true })
  await writeFile(join(skillsRoot, name, 'SKILL.md'), `---\nname: ${name}\n---\n`)
}

describe('collectStatus.installedSkills', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-skills-status-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  it('returns an empty list when there is no .claude/skills directory', async () => {
    const report = await collectStatus(tempDir, { checkNetwork: false })
    expect(report.installedSkills).toEqual([])
  })

  it('lists skills at the project root for monorepo manifests', async () => {
    await writeFile(
      join(tempDir, '.saasfoundry.json'),
      JSON.stringify({
        version: '1.0.0-beta',
        generatedAt: '2026-04-30T00:00:00Z',
        structure: 'monorepo',
        projectName: 'demo'
      })
    )
    const skillsRoot = join(tempDir, '.claude', 'skills')
    await makeSkill(skillsRoot, 'sf-git-commit')
    await makeSkill(skillsRoot, 'sf-integration-rules')
    // Directory without SKILL.md should be ignored
    await mkdir(join(skillsRoot, 'sf-not-a-skill'), { recursive: true })

    const report = await collectStatus(tempDir, { checkNetwork: false })
    expect(report.installedSkills).toEqual(['sf-git-commit', 'sf-integration-rules'])
  })

  it('aggregates skills from each app for multirepo manifests', async () => {
    await writeFile(
      join(tempDir, '.saasfoundry.json'),
      JSON.stringify({
        version: '1.0.0-beta',
        generatedAt: '2026-04-30T00:00:00Z',
        structure: 'multirepo',
        projectName: 'demo'
      })
    )
    await makeSkill(join(tempDir, 'apps', 'api', '.claude', 'skills'), 'sf-git-commit')
    await makeSkill(join(tempDir, 'apps', 'api', '.claude', 'skills'), 'sf-integration-rules')
    await makeSkill(join(tempDir, 'apps', 'web', '.claude', 'skills'), 'sf-integration-rules')

    const report = await collectStatus(tempDir, { checkNetwork: false })
    expect(report.installedSkills).toEqual(['sf-git-commit', 'sf-integration-rules'])
  })

  it('follows symlinks so contributors can dogfood a scaffold-templated skill in-place', async () => {
    await writeFile(
      join(tempDir, '.saasfoundry.json'),
      JSON.stringify({
        version: '1.0.0-beta',
        generatedAt: '2026-04-30T00:00:00Z',
        structure: 'monorepo',
        projectName: 'demo'
      })
    )
    const sourceDir = join(tempDir, 'scaffolds', 'tool-saasfoundry')
    await makeSkill(join(tempDir, 'scaffolds'), 'tool-saasfoundry')
    const skillsRoot = join(tempDir, '.claude', 'skills')
    await mkdir(skillsRoot, { recursive: true })
    await symlink(sourceDir, join(skillsRoot, 'tool-saasfoundry'))

    const report = await collectStatus(tempDir, { checkNetwork: false })
    expect(report.installedSkills).toEqual(['tool-saasfoundry'])
  })
})
