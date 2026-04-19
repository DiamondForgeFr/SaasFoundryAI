import { copy, pathExists } from 'fs-extra'
import { chmod, stat } from 'fs/promises'
import { join, resolve } from 'path'

import { skillsTemplatesPath } from '../types'

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
    } catch {
      // missing scripts are ignored — sibling SUBs may not have landed yet
    }
  }

  return target
}

export const SRS_SKILL_SOURCE_NAME = SRS_SKILL_NAME
