import { readManifest } from './manifest'
import { resolveSkillInstallDir, SkillScope } from './paths'

export interface StaleCheck {
  installed: boolean
  stale: boolean
  installedVersion: string | null
  bundledVersion: string
  targetDir: string
}

/**
 * Compare the installed skill's manifest against the bundled CLI version.
 * Returns installed=false when no manifest exists (i.e. no install in this scope).
 * Returns stale=true when the installed cliVersion differs from the bundled one.
 */
export async function checkSkillStatus(scope: SkillScope, bundledVersion: string, cwd?: string): Promise<StaleCheck> {
  const targetDir = resolveSkillInstallDir(scope, cwd)
  const manifest = await readManifest(targetDir)
  if (!manifest) {
    return { installed: false, stale: false, installedVersion: null, bundledVersion, targetDir }
  }
  return {
    installed: true,
    stale: manifest.cliVersion !== bundledVersion,
    installedVersion: manifest.cliVersion,
    bundledVersion,
    targetDir
  }
}
