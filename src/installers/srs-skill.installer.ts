import { copy, pathExists } from 'fs-extra'
import { chmod, stat } from 'fs/promises'
import { join, resolve } from 'path'

import type { ModuleInstaller } from '../migrations/module/types'
import { skillsTemplatesPath } from '../types'

export const srsSkillInstallerMeta: ModuleInstaller = {
  name: 'srs-skill',
  currentVersion: 1,
  migrations: []
}

interface InstallSrsSkillParams {
  targetPath: string
  onExisting?: (message: string) => void
}

const SRS_SKILL_NAME = 'sf-srs'
const EXECUTABLE_SCRIPTS = ['scripts/srs-cli.sh']

export async function installSrsSkill({ targetPath, onExisting }: InstallSrsSkillParams): Promise<string> {
  const source = resolve(skillsTemplatesPath, SRS_SKILL_NAME)
  const target = join(targetPath, '.claude', 'skills', SRS_SKILL_NAME)

  if (await pathExists(target)) {
    const msg = `SRS skill already present at ${target} — refreshing scaffold files (user-added files are preserved).`
    if (onExisting) onExisting(msg)
    else console.warn(msg)
  }

  await copy(source, target, { overwrite: true })

  for (const relativePath of EXECUTABLE_SCRIPTS) {
    const scriptPath = join(target, relativePath)
    try {
      const st = await stat(scriptPath)
      if (st.isFile()) {
        await chmod(scriptPath, 0o755)
      }
    } catch (error) {
      // A script missing from the bundle is expected; any other failure leaves the CLI unusable, so say so (#433)
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      console.warn(`Could not make ${scriptPath} executable (${(error as Error).message}). Run: chmod +x ${scriptPath}`)
    }
  }

  return target
}

export const SRS_SKILL_SOURCE_NAME = SRS_SKILL_NAME
