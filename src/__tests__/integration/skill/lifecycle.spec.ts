import { readFile, writeFile } from 'fs/promises'
import path from 'path'

import { performSkillInstall, skillIsInstalled } from '../../../skill/install'
import { readManifest } from '../../../skill/manifest'
import { resolvePreferencesPath, resolveSkillInstallDir } from '../../../skill/paths'
import { DEFAULT_PREFERENCES, readPreferences, writePreferences } from '../../../skill/preferences'
import { performFullUninstall, performSkillUninstall } from '../../../skill/uninstall'
import { checkSkillStatus } from '../../../skill/update'
import { fileExists } from '../../../utils'
import { createTempDir } from '../../helpers/temp-dir'

describe('skill lifecycle integration', () => {
  let originalHome: string | undefined
  let tempHome: string
  let cleanupHome: () => Promise<void>
  let tempProject: string
  let cleanupProject: () => Promise<void>

  beforeEach(async () => {
    originalHome = process.env.HOME
    const home = await createTempDir()
    tempHome = home.dir
    cleanupHome = home.cleanup
    process.env.HOME = tempHome

    const proj = await createTempDir()
    tempProject = proj.dir
    cleanupProject = proj.cleanup
  })

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    await cleanupHome()
    await cleanupProject()
  })

  it('installs the skill into the user scope and writes a matching manifest', async () => {
    const result = await performSkillInstall({ scope: 'user', cliVersion: '1.2.3' })
    const expectedDir = path.join(tempHome, '.claude', 'skills', 'tool-saasfoundry')
    expect(result.targetDir).toBe(expectedDir)
    expect(result.reinstalled).toBe(false)
    expect(await fileExists(path.join(expectedDir, 'SKILL.md'))).toBe(true)
    const manifest = await readManifest(expectedDir)
    expect(manifest?.cliVersion).toBe('1.2.3')
    expect(manifest?.scope).toBe('user')
  })

  it('installs the skill into a project-scoped directory when cwd is provided', async () => {
    const result = await performSkillInstall({ scope: 'project', cliVersion: '1.2.3', cwd: tempProject })
    const expectedDir = path.join(tempProject, '.claude', 'skills', 'tool-saasfoundry')
    expect(result.targetDir).toBe(expectedDir)
    expect(await fileExists(path.join(expectedDir, '.version'))).toBe(true)
    const manifest = await readManifest(expectedDir)
    expect(manifest?.scope).toBe('project')
  })

  it('reinstall carries forward the previous version into the result', async () => {
    await performSkillInstall({ scope: 'user', cliVersion: '1.0.0' })
    const second = await performSkillInstall({ scope: 'user', cliVersion: '2.0.0' })
    expect(second.reinstalled).toBe(true)
    expect(second.previousVersion).toBe('1.0.0')
    const manifest = await readManifest(second.targetDir)
    expect(manifest?.cliVersion).toBe('2.0.0')
  })

  it('checkSkillStatus detects fresh, current, and stale installs', async () => {
    const fresh = await checkSkillStatus('user', '1.0.0')
    expect(fresh.installed).toBe(false)
    expect(fresh.stale).toBe(false)

    await performSkillInstall({ scope: 'user', cliVersion: '1.0.0' })
    const current = await checkSkillStatus('user', '1.0.0')
    expect(current).toMatchObject({ installed: true, stale: false, installedVersion: '1.0.0', bundledVersion: '1.0.0' })

    const stale = await checkSkillStatus('user', '2.0.0')
    expect(stale).toMatchObject({ installed: true, stale: true, installedVersion: '1.0.0', bundledVersion: '2.0.0' })
  })

  it('uninstall removes the skill without touching preferences by default', async () => {
    await performSkillInstall({ scope: 'user', cliVersion: '1.0.0' })
    await writePreferences({ ...DEFAULT_PREFERENCES, skillPromptAnswered: true })
    expect(await skillIsInstalled('user')).toBe(true)

    const result = await performSkillUninstall('user', { purge: false })
    expect(result.removedSkill).toBe(true)
    expect(result.removedPreferences).toBe(false)
    expect(await fileExists(resolveSkillInstallDir('user'))).toBe(false)
    const prefs = await readPreferences()
    expect(prefs.skillPromptAnswered).toBe(true)
  })

  it('uninstall --purge also wipes ~/.saasfoundry/', async () => {
    await performSkillInstall({ scope: 'user', cliVersion: '1.0.0' })
    await writePreferences({ ...DEFAULT_PREFERENCES, skillPromptAnswered: true })
    const result = await performSkillUninstall('user', { purge: true })
    expect(result.removedSkill).toBe(true)
    expect(result.removedPreferences).toBe(true)
    expect(await fileExists(resolvePreferencesPath())).toBe(false)
  })

  it('uninstall is a no-op when nothing is installed', async () => {
    const result = await performSkillUninstall('user', { purge: false })
    expect(result.removedSkill).toBe(false)
    expect(result.removedPreferences).toBe(false)
  })

  it('performFullUninstall removes user + project skills + preferences in one pass', async () => {
    await performSkillInstall({ scope: 'user', cliVersion: '1.0.0' })
    await performSkillInstall({ scope: 'project', cliVersion: '1.0.0', cwd: tempProject })
    await writePreferences({ ...DEFAULT_PREFERENCES, skillPromptAnswered: true })

    const result = await performFullUninstall(tempProject)
    expect(result.userScope.removedSkill).toBe(true)
    expect(result.userScope.removedPreferences).toBe(true)
    expect(result.projectScope.removedSkill).toBe(true)
    expect(result.projectScope.removedPreferences).toBe(false)

    expect(await fileExists(resolveSkillInstallDir('user'))).toBe(false)
    expect(await fileExists(resolveSkillInstallDir('project', tempProject))).toBe(false)
    expect(await fileExists(resolvePreferencesPath())).toBe(false)
  })

  it('preferences survive a skill update', async () => {
    await performSkillInstall({ scope: 'user', cliVersion: '1.0.0' })
    await writePreferences({ ...DEFAULT_PREFERENCES, skillInstallOptIn: true, votingOptIn: 'never' })
    await performSkillInstall({ scope: 'user', cliVersion: '2.0.0' })
    const prefs = await readPreferences()
    expect(prefs.skillInstallOptIn).toBe(true)
    expect(prefs.votingOptIn).toBe('never')
  })

  it('manifest survives a corrupt rewrite → treated as missing', async () => {
    const { targetDir } = await performSkillInstall({ scope: 'user', cliVersion: '1.0.0' })
    await writeFile(path.join(targetDir, '.version'), 'broken', 'utf8')
    const status = await checkSkillStatus('user', '1.0.0')
    expect(status.installed).toBe(false)
  })

  it('skillIsInstalled returns true when a bundle directory exists even without manifest', async () => {
    await performSkillInstall({ scope: 'user', cliVersion: '1.0.0' })
    // Remove the manifest but leave the directory
    const manifestPath = path.join(resolveSkillInstallDir('user'), '.version')
    await writeFile(manifestPath, '', 'utf8')
    expect(await skillIsInstalled('user')).toBe(true)
  })

  it('user- and project-scope installs are independent', async () => {
    await performSkillInstall({ scope: 'user', cliVersion: '1.0.0' })
    await performSkillInstall({ scope: 'project', cliVersion: '2.0.0', cwd: tempProject })

    const userManifest = await readManifest(resolveSkillInstallDir('user'))
    const projectManifest = await readManifest(resolveSkillInstallDir('project', tempProject))
    expect(userManifest?.cliVersion).toBe('1.0.0')
    expect(projectManifest?.cliVersion).toBe('2.0.0')

    await performSkillUninstall('project', { purge: false, cwd: tempProject })
    expect(await skillIsInstalled('user')).toBe(true)
    expect(await skillIsInstalled('project', tempProject)).toBe(false)
  })

  it('copies the bundle SKILL.md verbatim on install', async () => {
    const { targetDir, sourceDir } = await performSkillInstall({ scope: 'user', cliVersion: '1.0.0' })
    const copied = await readFile(path.join(targetDir, 'SKILL.md'), 'utf8')
    const original = await readFile(path.join(sourceDir, 'SKILL.md'), 'utf8')
    expect(copied).toBe(original)
  })
})
