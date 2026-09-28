import { copy, remove } from 'fs-extra'

import { fileExists } from '../utils'

import { buildManifest, readManifest, writeManifest } from './manifest'
import { resolveBundleSourceDir, resolveSkillInstallDir, SkillScope } from './paths'

export interface InstallOptions {
  scope: SkillScope
  cliVersion: string
  cwd?: string
}

export interface InstallResult {
  targetDir: string
  sourceDir: string
  previousVersion: string | null
  reinstalled: boolean
}

export async function skillIsInstalled(scope: SkillScope, cwd?: string): Promise<boolean> {
  const dir = resolveSkillInstallDir(scope, cwd)
  return fileExists(dir)
}

export async function performSkillInstall({ scope, cliVersion, cwd }: InstallOptions): Promise<InstallResult> {
  const sourceDir = resolveBundleSourceDir()
  if (!(await fileExists(sourceDir))) {
    throw new Error(`Skill bundle source not found at ${sourceDir}. Ensure the CLI package ships scaffolds/skills-templates/tool-saasfoundry/.`)
  }

  const targetDir = resolveSkillInstallDir(scope, cwd)
  const existed = await fileExists(targetDir)
  const existingManifest = existed ? await readManifest(targetDir) : null

  if (existed) await remove(targetDir)
  await copy(sourceDir, targetDir)
  await writeManifest(targetDir, buildManifest(cliVersion, scope))

  return {
    targetDir,
    sourceDir,
    previousVersion: existingManifest?.cliVersion ?? null,
    reinstalled: existed
  }
}

export function isRunningViaNpx(): boolean {
  const userAgent = process.env.npm_config_user_agent ?? ''
  return userAgent.includes('npx')
}
