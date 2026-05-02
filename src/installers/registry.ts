import { analyticsInstallerMeta } from './analytics.installer'
import { coreSkillsInstallerMeta } from './core-skills.installer'
import { emailInstallerMeta } from './email.installer'
import { skillsInstallerMeta } from './skills.installer'
import { srsSkillInstallerMeta } from './srs-skill.installer'
import { storageInstallerMeta } from './storage.installer'
import { toolSkillInstallerMeta } from './tool-skill.installer'
import { workflowSkillInstallerMeta } from './workflow-skill.installer'
import type { ModuleInstaller } from '../migrations/module/types'

/**
 * Single source of truth for all module installers the dispatcher (#386)
 * needs to know about. Each entry pairs a module's `name` with the
 * `currentVersion` a fresh install stamps onto `manifest.modules.<name>.version`
 * and the ordered `migrations` chain replayed against modules already installed
 * at an older version.
 *
 * Modules ship empty `migrations: []` until the first breaking change to their
 * on-disk shape; at that point the installer file gains a `migrations/` folder
 * with `001-<name>.ts`, the registry call below picks it up automatically, and
 * `currentVersion` bumps in lockstep.
 */
export const moduleInstallers: ModuleInstaller[] = [
  emailInstallerMeta,
  storageInstallerMeta,
  analyticsInstallerMeta,
  srsSkillInstallerMeta,
  skillsInstallerMeta,
  coreSkillsInstallerMeta,
  toolSkillInstallerMeta,
  workflowSkillInstallerMeta
]

export function getModuleInstaller(name: string): ModuleInstaller | undefined {
  return moduleInstallers.find((installer) => installer.name === name)
}
