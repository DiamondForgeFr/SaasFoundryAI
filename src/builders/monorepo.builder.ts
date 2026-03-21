import { copy } from 'fs-extra'
import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { exec } from 'shelljs'

import { CreateMonorepoRootParams, overlaysPath } from '../types'
import { getNvmPrefix, validateProjectName } from '../utils'

export async function createMonorepoRoot({ projectName, projectDescription, monorepoUrl, mainBranch }: CreateMonorepoRootParams) {
  validateProjectName(projectName)

  // Copy monorepo root overlay to project root (current directory)
  await copy(resolve(overlaysPath, 'monorepo/root'), '.', { overwrite: true })

  // Update root package.json
  const packageJsonPath = 'package.json'
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  packageJson.name = projectName
  packageJson.description = projectDescription
  packageJson.repository.url = monorepoUrl || 'https://github.com/agachet/saasfoundry.git'
  packageJson.keywords = [projectName, 'saasfoundry', 'monorepo', 'turborepo']
  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

  // Install all dependencies at root (npm workspaces hoists everything)
  const nvm = getNvmPrefix()
  await exec(`${nvm}npm install > /dev/null 2>&1`)

  // Generate Prisma client from the API workspace
  await exec(`${nvm}cd apps/api && npx prisma generate > /dev/null 2>&1`)

  // Initialize Git repository at root level
  await exec(`git init > /dev/null 2>&1`)
  await exec(`git checkout -b ${mainBranch} > /dev/null 2>&1`)
  if (monorepoUrl) await exec(`git remote add origin ${monorepoUrl} > /dev/null 2>&1`)
  await exec(`git add . > /dev/null 2>&1`)
  await exec(`git commit -m "Initial commit" > /dev/null 2>&1`)

  return true
}
