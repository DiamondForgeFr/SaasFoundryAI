import { copy } from 'fs-extra'
import { readFile, rm, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { exec } from 'shelljs'
import glob from 'glob'

import { installAnalyticsModule } from '../installers/analytics.installer'
import { installToolSkill } from '../installers/tool-skill.installer'
import { installWorkflowSkill } from '../installers/workflow-skill.installer'
import { blueprintsPath, CreateWebAppParams, overlaysPath } from '../types'
import { fileExists, getNvmPrefix, substitutePlaceholdersInFiles, validateProjectName } from '../utils'

export async function createWebApp({ isMonorepo, projectName, projectDescription, frontendRepoUrl, mainBranch, s3Setup, includeAnalytics, workflow }: CreateWebAppParams) {
  validateProjectName(projectName)

  // Create the WEB app directory
  const webPath = isMonorepo ? 'apps/web' : `apps/${projectName}-web`

  await copy(resolve(blueprintsPath, 'web'), webPath)
  if (!isMonorepo) await copy(resolve(overlaysPath, 'multirepo/web'), webPath, { overwrite: true })
  else {
    await copy(resolve(overlaysPath, 'monorepo/web'), webPath, { overwrite: true })
    // Remove per-app CI workflows (monorepo uses root-level workflows)
    await rm(`${webPath}/.github`, { recursive: true, force: true })
    // Point ESLint custom rule to monorepo root shared file
    const eslintConfigPath = `${webPath}/eslint.config.mjs`
    let eslintConfig = await readFile(eslintConfigPath, 'utf8')
    eslintConfig = eslintConfig.replace(`'./eslint-rules/no-version-prefix.js'`, `'../../eslint-rules/no-version-prefix.mjs'`)
    await writeFile(eslintConfigPath, eslintConfig)
    // Substitute {{PROJECT_NAME}} in shared-* wiring (workspace deps + wiring proof imports)
    await substitutePlaceholdersInFiles([`${webPath}/package.json`, `${webPath}/src/shared-wiring.ts`, `${webPath}/src/index.css`], { PROJECT_NAME: projectName })

    // Substitute {{PROJECT_NAME}} across the whole monorepo src tree — api-client-aware hooks
    // import from `@<name>/api-client/...`, and overlay files outside hooks/ (e.g. the
    // query-provider wiring setUnauthorizedHandler) carry the placeholder too. No-op on
    // files without the placeholder.
    const monorepoSrcTsFiles = glob.sync(`${webPath}/src/**/*.{ts,tsx}`, { ignore: `${webPath}/node_modules/**` })
    if (monorepoSrcTsFiles.length > 0) await substitutePlaceholdersInFiles(monorepoSrcTsFiles, { PROJECT_NAME: projectName })

    // Drop the vendored shadcn copy + cn/useIsMobile — primitives now live in
    // @<projectName>/ui-primitives. Multirepo keeps the blueprint copies (no
    // overlay step deletes them there).
    await rm(`${webPath}/src/components/ui/shadcn`, { recursive: true, force: true })
    await rm(`${webPath}/src/utils/ui.ts`, { force: true })
    await rm(`${webPath}/src/hooks/ui/useIsMobile.ts`, { force: true })

    // Drop apps/web/components.json — the shadcn-CLI alias `ui` pointed to the
    // deleted local tree. In monorepo, primitives are owned by the workspace
    // package; future `npx shadcn add` runs belong in packages/ui-primitives/.
    await rm(`${webPath}/components.json`, { force: true })

    // Rewire all primitive imports across apps/web to the workspace package.
    // Covers `@/components/ui/shadcn/<name>` → `@<projectName>/ui-primitives/<name>`,
    // and `@/utils/ui` (cn) → `@<projectName>/ui-primitives` (barrel).
    const monorepoSrcFiles = glob.sync(`${webPath}/src/**/*.{ts,tsx}`, { ignore: `${webPath}/node_modules/**` })
    for (const filePath of monorepoSrcFiles) {
      let body = await readFile(filePath, 'utf8')
      const before = body
      body = body
        .replace(/from '@\/components\/ui\/shadcn\/([a-z-]+)'/g, `from '@${projectName}/ui-primitives/$1'`)
        .replace(/from '@\/utils\/ui'/g, `from '@${projectName}/ui-primitives'`)
        .replace(/from '@\/hooks\/ui\/useIsMobile'/g, `from '@${projectName}/ui-primitives'`)
      if (body !== before) await writeFile(filePath, body)
    }
  }

  // Update package.json
  const packageJsonPath = `${webPath}/package.json`
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  packageJson.name = `${projectName}-web`
  packageJson.description = projectDescription
  packageJson.repository.url = frontendRepoUrl || 'https://github.com/agachet/saasfoundry.git'
  packageJson.keywords = [projectName, 'saasfoundry', 'frontend', 'react', 'vite']
  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

  // For monorepo, npm install is handled by the monorepo root builder
  if (!isMonorepo) {
    const nvm = getNvmPrefix()
    await exec(`${nvm}npm install --prefix ${webPath} > /dev/null 2>&1`)
  }

  // Update Docker network name in docker-compose.yml
  const dockerComposePath = `${webPath}/docker-compose.yml`
  if (await fileExists(dockerComposePath)) {
    let dockerComposeContent = await readFile(dockerComposePath, 'utf8')
    dockerComposeContent = dockerComposeContent.replace(/saasfoundry-network/g, `${projectName}-network`).replace(/saasfoundry-web/g, `${projectName}-web`)
    await writeFile(dockerComposePath, dockerComposeContent)
  }

  // Update network name in GitHub Actions deployment.yml
  const deploymentYmlPath = `${webPath}/.github/workflows/deployment.yml`
  if (await fileExists(deploymentYmlPath)) {
    let deploymentYmlContent = await readFile(deploymentYmlPath, 'utf8')
    deploymentYmlContent = deploymentYmlContent.replace(/saasfoundry-network/g, `${projectName}-network`)
    await writeFile(deploymentYmlPath, deploymentYmlContent)
  }

  // Update storage enabled flag in .env
  if (s3Setup !== 'manual') {
    const webEnvPath = `${webPath}/.env`
    if (await fileExists(webEnvPath)) {
      let webEnvContent = await readFile(webEnvPath, 'utf8')
      webEnvContent = webEnvContent.replace(/VITE_STORAGE_ENABLED=.*$/m, 'VITE_STORAGE_ENABLED="true"')
      await writeFile(webEnvPath, webEnvContent)
    }
  }

  // Install Umami analytics module (if selected)
  if (includeAnalytics) {
    await installAnalyticsModule({ webPath })
  }

  // Install workflow skill (if workflow is configured)
  if (workflow && workflow.tool !== 'none') {
    await installWorkflowSkill({
      targetPath: webPath,
      workflow,
      projectUrl: workflow.projectUrl
    })

    // Install tool-specific skill for the workflow
    await installToolSkill({
      targetPath: webPath,
      tool: workflow.tool as 'github-projects' | 'jira' | 'notion' | 'linear'
    })
  }

  // Initialize Git repository
  if (!isMonorepo) {
    await exec(`git init ${webPath} > /dev/null 2>&1`)
    await exec(`git -C ${webPath} checkout -b ${mainBranch} > /dev/null 2>&1`)
    if (frontendRepoUrl) await exec(`git -C ${webPath} remote add origin ${frontendRepoUrl} > /dev/null 2>&1`)
    await exec(`git -C ${webPath} add . > /dev/null 2>&1`)
    await exec(`git -C ${webPath} commit -m "Initial commit" > /dev/null 2>&1`)
  }

  return true
}
