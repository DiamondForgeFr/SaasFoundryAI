import { homedir } from 'os'
import path from 'path'

export type SkillScope = 'user' | 'project'

export const SKILL_NAME = 'tool-saasfoundry'

export const MANIFEST_FILENAME = '.version'

export const PREFERENCES_DIR = '.saasfoundry'
export const PREFERENCES_FILENAME = 'preferences.json'

/**
 * Resolve the directory where the skill bundle lives inside an installed CLI
 * (i.e. the source from which `sf skill install` copies).
 *
 * We read from the repo-level `scaffolds/skills-templates/tool-saasfoundry/`.
 * When installed via npm the same path exists under the package root because
 * `scaffolds` is declared in `package.json#files`.
 */
export function resolveBundleSourceDir(): string {
  return path.join(__dirname, '..', '..', 'scaffolds', 'skills-templates', SKILL_NAME)
}

/**
 * Resolve the destination where a skill install should land, given a scope.
 *
 * - `user`    → `~/.claude/skills/tool-saasfoundry/`
 * - `project` → `<cwd>/.claude/skills/tool-saasfoundry/`
 */
export function resolveSkillInstallDir(scope: SkillScope, cwd: string = process.cwd()): string {
  const base = scope === 'user' ? homedir() : cwd
  return path.join(base, '.claude', 'skills', SKILL_NAME)
}

/**
 * Resolve the path to the skill's `.version` manifest inside an installed bundle.
 */
export function resolveManifestPath(installDir: string): string {
  return path.join(installDir, MANIFEST_FILENAME)
}

/**
 * Resolve the absolute path to the user-level preferences file
 * (`~/.saasfoundry/preferences.json`).
 */
export function resolvePreferencesPath(): string {
  return path.join(homedir(), PREFERENCES_DIR, PREFERENCES_FILENAME)
}
