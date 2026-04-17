import path from 'path'

import { resolveBundleSourceDir, resolveManifestPath, resolvePreferencesPath, resolveSkillInstallDir, SKILL_NAME } from '../../../skill/paths'

describe('skill/paths', () => {
  it('resolves the bundle source dir under scaffolds/skills-templates/tool-saasfoundry', () => {
    const source = resolveBundleSourceDir()
    expect(source.endsWith(path.join('scaffolds', 'skills-templates', SKILL_NAME))).toBe(true)
  })

  it('resolves user-scope install to ~/.claude/skills/tool-saasfoundry', () => {
    const dir = resolveSkillInstallDir('user')
    expect(dir.endsWith(path.join('.claude', 'skills', SKILL_NAME))).toBe(true)
    expect(dir.startsWith(path.sep)).toBe(true)
  })

  it('resolves project-scope install relative to cwd argument', () => {
    const fakeCwd = path.join(path.sep, 'tmp', 'some-project')
    const dir = resolveSkillInstallDir('project', fakeCwd)
    expect(dir).toBe(path.join(fakeCwd, '.claude', 'skills', SKILL_NAME))
  })

  it('resolves the manifest path inside an install directory', () => {
    const installDir = path.join(path.sep, 'tmp', 'fake', '.claude', 'skills', SKILL_NAME)
    const manifest = resolveManifestPath(installDir)
    expect(manifest).toBe(path.join(installDir, '.version'))
  })

  it('resolves preferences path to ~/.saasfoundry/preferences.json', () => {
    const prefs = resolvePreferencesPath()
    expect(prefs.endsWith(path.join('.saasfoundry', 'preferences.json'))).toBe(true)
  })
})
