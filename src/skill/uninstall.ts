import { remove } from 'fs-extra'
import path from 'path'

import { fileExists } from '../utils'

import { resolvePreferencesPath, resolveSkillInstallDir, SkillScope } from './paths'

export interface UninstallResult {
  removedSkill: boolean
  removedPreferences: boolean
  skillDir: string
  preferencesPath: string
}

/**
 * Remove the skill install at the given scope. Optionally wipe preferences too.
 * Never touches generated projects or CLI itself.
 */
export async function performSkillUninstall(scope: SkillScope, options: { purge: boolean; cwd?: string }): Promise<UninstallResult> {
  const skillDir = resolveSkillInstallDir(scope, options.cwd)
  const preferencesPath = resolvePreferencesPath()

  let removedSkill = false
  if (await fileExists(skillDir)) {
    await remove(skillDir)
    removedSkill = true
  }

  let removedPreferences = false
  if (options.purge) {
    const prefsDir = path.dirname(preferencesPath)
    if (await fileExists(prefsDir)) {
      await remove(prefsDir)
      removedPreferences = true
    }
  }

  return { removedSkill, removedPreferences, skillDir, preferencesPath }
}

/**
 * Full cleanup: remove skill (both scopes where applicable) + preferences.
 * The caller is responsible for prompting confirmation in interactive mode.
 */
export async function performFullUninstall(cwd?: string): Promise<{ userScope: UninstallResult; projectScope: UninstallResult }> {
  const userScope = await performSkillUninstall('user', { purge: true, cwd })
  const projectScope = await performSkillUninstall('project', { purge: false, cwd })
  return { userScope, projectScope }
}
