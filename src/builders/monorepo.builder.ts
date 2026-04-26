import { copy } from 'fs-extra'
import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { exec } from 'shelljs'

import { installToolSkill } from '../installers/tool-skill.installer'
import { installWorkflowSkill } from '../installers/workflow-skill.installer'
import { CreateMonorepoRootParams, overlaysPath } from '../types'
import { fileExists, getNvmPrefix, substitutePlaceholdersInFiles, validateProjectName } from '../utils'

export async function createMonorepoRoot({ projectName, projectDescription, monorepoUrl, mainBranch, workflow }: CreateMonorepoRootParams) {
  validateProjectName(projectName)

  // Copy monorepo root overlay to project root (current directory)
  await copy(resolve(overlaysPath, 'monorepo/root'), '.', { overwrite: true })

  // Substitute {{PROJECT_NAME}} in shared-* package files (scoped package names + docs)
  await substitutePlaceholdersInFiles(
    [
      'packages/shared-types/package.json',
      'packages/shared-types/README.md',
      'packages/shared-validation/package.json',
      'packages/shared-validation/README.md',
      'packages/shared-config/package.json',
      'packages/shared-config/README.md'
    ],
    { PROJECT_NAME: projectName }
  )

  const nvm = getNvmPrefix()

  // Update root package.json
  const packageJsonPath = 'package.json'
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  packageJson.name = projectName
  packageJson.description = projectDescription
  packageJson.repository.url = monorepoUrl || 'https://github.com/agachet/saasfoundry.git'
  packageJson.keywords = [projectName, 'saasfoundry', 'monorepo', 'turborepo']
  const npmVersion = exec(`${nvm}npm --version`, { silent: true }).stdout.trim()
  packageJson.packageManager = `npm@${npmVersion}`
  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

  // Update deployment workflow references with project-specific names
  const deployApiPath = '.github/workflows/deployment-api.yml'
  if (await fileExists(deployApiPath)) {
    let content = await readFile(deployApiPath, 'utf8')
    content = content.replace(/saasfoundry-network/g, `${projectName}-network`)
    content = content.replace(/saasfoundry-api/g, `${projectName}-api`)
    await writeFile(deployApiPath, content)
  }

  const deployWebPath = '.github/workflows/deployment-web.yml'
  if (await fileExists(deployWebPath)) {
    let content = await readFile(deployWebPath, 'utf8')
    content = content.replace(/saasfoundry-network/g, `${projectName}-network`)
    content = content.replace(/saasfoundry-web/g, `${projectName}-web`)
    content = content.replace(/saasfoundry-api/g, `${projectName}-api`)
    await writeFile(deployWebPath, content)
  }

  // Install all dependencies at root (npm workspaces hoists everything)
  await exec(`${nvm}npm install > /dev/null 2>&1`)

  // Generate Prisma client from the API workspace
  await exec(`${nvm}cd apps/api && npx prisma generate > /dev/null 2>&1`)

  // Install workflow skill at root (if workflow is configured)
  if (workflow && workflow.tool !== 'none') {
    await installWorkflowSkill({
      targetPath: '.',
      workflow,
      projectUrl: workflow.projectUrl
    })

    // Install tool-specific skill for the workflow
    await installToolSkill({
      targetPath: '.',
      tool: workflow.tool as 'github-projects' | 'jira' | 'notion' | 'linear'
    })
  }

  // Initialize Git repository at root level
  await exec(`git init > /dev/null 2>&1`)
  await exec(`git checkout -b ${mainBranch} > /dev/null 2>&1`)
  if (monorepoUrl) await exec(`git remote add origin ${monorepoUrl} > /dev/null 2>&1`)
  await exec(`git add . > /dev/null 2>&1`)
  await exec(`git commit -m "Initial commit" > /dev/null 2>&1`)

  return true
}
