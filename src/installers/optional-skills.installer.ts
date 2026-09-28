import { copy, pathExists } from 'fs-extra'
import { mkdir } from 'fs/promises'
import { join } from 'path'

import { skillsTemplatesPath } from '../types'

interface InstallOptionalSkillsParams {
  targetPath: string
  selectedSkills: string[]
}

export async function installOptionalSkills({ targetPath, selectedSkills }: InstallOptionalSkillsParams) {
  if (selectedSkills.length === 0) {
    return
  }

  const optionalTemplatesPath = join(skillsTemplatesPath, 'optional')
  const toolsTemplatesPath = join(skillsTemplatesPath, 'tools')
  const targetSkillsPath = join(targetPath, '.claude', 'skills')

  await mkdir(targetSkillsPath, { recursive: true })

  for (const skill of selectedSkills) {
    const canonicalPath = join(toolsTemplatesPath, skill)
    const legacyPath = join(optionalTemplatesPath, `sf-tool-${skill}`)
    const skillTemplatePath = (await pathExists(canonicalPath)) ? canonicalPath : legacyPath
    const skillTargetPath = join(targetSkillsPath, `sf-tool-${skill}`)
    await copy(skillTemplatePath, skillTargetPath)
  }
}
