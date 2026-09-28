import { readFile, writeFile } from 'fs/promises'

import { fileExists } from '../utils'

import { MANIFEST_FILENAME, resolveManifestPath, SkillScope } from './paths'

export interface SkillManifest {
  cliVersion: string
  installedAt: string
  scope: SkillScope
}

export { MANIFEST_FILENAME }

export async function readManifest(installDir: string): Promise<SkillManifest | null> {
  const manifestPath = resolveManifestPath(installDir)
  if (!(await fileExists(manifestPath))) return null
  try {
    const raw = await readFile(manifestPath, 'utf8')
    const parsed = JSON.parse(raw)
    if (typeof parsed?.cliVersion !== 'string' || typeof parsed?.installedAt !== 'string' || (parsed?.scope !== 'user' && parsed?.scope !== 'project')) {
      return null
    }
    return parsed as SkillManifest
  } catch {
    return null
  }
}

export async function writeManifest(installDir: string, manifest: SkillManifest): Promise<void> {
  const manifestPath = resolveManifestPath(installDir)
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
}

export function buildManifest(cliVersion: string, scope: SkillScope, installedAt: Date = new Date()): SkillManifest {
  return {
    cliVersion,
    installedAt: installedAt.toISOString(),
    scope
  }
}
