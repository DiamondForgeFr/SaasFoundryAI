import { copy } from 'fs-extra'
import { globSync } from 'node:fs'
import { readFile, rm, writeFile } from 'fs/promises'
import { join, resolve } from 'path'

import { installAnalyticsModule } from '../installers/analytics.installer'
import { installPwaModule } from '../installers/pwa.installer'
import { installWorkflowArtifacts } from '../installers/harness.installer'
import { DEFAULT_PORTS } from '../ports'
import { blueprintsPath, CreateWebAppParams, overlaysPath } from '../types'
import { applyProjectIdentity, fileExists, getNvmPrefix, replaceInFile, substitutePlaceholdersInFiles, validateProjectName } from '../utils'
import { assertGitBranchName, runBestEffortArgv, runRequired, warn } from '../run'
import { impactValidationPlaceholders, installImpactValidation } from './impact-validation'

export async function createWebApp(params: CreateWebAppParams) {
  const targetDir = params.targetDir ?? '.'
  const result = await renderWebApp({ ...params, targetDir })
  if (params.externalEffects !== false) await provisionWebApp({ ...params, targetDir })
  return result
}

/** Render the web candidate without running package or Git commands. */
export async function renderWebApp({
  targetDir,
  isMonorepo,
  projectName,
  projectDescription,
  frontendRepoUrl,
  mainBranch,
  s3Setup,
  includeAnalytics,
  includePwa,
  workflow,
  ports
}: CreateWebAppParams & {
  targetDir: string
}) {
  validateProjectName(projectName)

  const { api: apiPort, web: webPort } = ports ?? DEFAULT_PORTS

  // Create the WEB app directory
  const webPath = join(targetDir, isMonorepo ? 'apps/web' : `apps/${projectName}-web`)

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
    const monorepoSrcTsFiles = globSync(`${webPath}/src/**/*.{ts,tsx}`, { exclude: [`${webPath}/node_modules/**`] })
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
    const monorepoSrcFiles = globSync(`${webPath}/src/**/*.{ts,tsx}`, { exclude: [`${webPath}/node_modules/**`] })
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

  // Every web-side file that names a port. `.env` carries both: the API the app calls,
  // and the port Vite serves on — which the config now actually reads (FRONTEND_PORT was
  // declared and ignored, so the web port worked only because 5173 is Vite's own default).
  for (const envFile of ['.env', '.env.test']) {
    await replaceInFile(`${webPath}/${envFile}`, [
      [/^VITE_BASE_API_URL=.*$/m, `VITE_BASE_API_URL="http://localhost:${apiPort}"`],
      [/^FRONTEND_PORT=.*$/m, `FRONTEND_PORT="${webPort}"`]
    ])
  }
  await replaceInFile(`${webPath}/vite.config.ts`, [[/5173/g, String(webPort)]])
  await replaceInFile(`${webPath}/playwright.config.ts`, [[/localhost:5173/g, `localhost:${webPort}`]])
  // The host AND the port. nginx proxies to the API container by name, and that name was
  // the one place no builder renamed — so the containerised web app dialled a host called
  // `saasfoundry-api` that no generated project ever creates (#606).
  await replaceInFile(`${webPath}/nginx.conf`, [
    [/:3500;/g, `:${apiPort};`],
    [/saasfoundry-([a-z0-9-]+)/g, `${projectName}-$1`]
  ])
  await replaceInFile(`${webPath}/CLAUDE.md`, [[/port 5173/g, `port ${webPort}`]])
  // Monorepo overlay: the web dev script waits on the API's port before starting Vite.
  await replaceInFile(`${webPath}/package.json`, [[/tcp:3500/g, `tcp:${apiPort}`]])
  // The image describes itself, and the lockfile names the package. Both carried the
  // scaffold's name: an image labelled as somebody else's app, and a lockfile disagreeing
  // with the package.json beside it until the first npm install rewrote it.
  await replaceInFile(`${webPath}/Dockerfile`, [[/saasfoundry-([a-z0-9-]+)/g, `${projectName}-$1`]])
  await replaceInFile(`${webPath}/package-lock.json`, [[/"saasfoundry-web"/g, `"${projectName}-web"`]])

  // Update Docker network name in docker-compose.yml
  const dockerComposePath = `${webPath}/docker-compose.yml`
  if (await fileExists(dockerComposePath)) {
    let dockerComposeContent = await readFile(dockerComposePath, 'utf8')
    dockerComposeContent = applyProjectIdentity(dockerComposeContent, projectName)
    await writeFile(dockerComposePath, dockerComposeContent)
  }

  // Update network name in GitHub Actions deployment.yml
  const deploymentYmlPath = `${webPath}/.github/workflows/deployment.yml`
  if (await fileExists(deploymentYmlPath)) {
    let deploymentYmlContent = await readFile(deploymentYmlPath, 'utf8')
    deploymentYmlContent = applyProjectIdentity(deploymentYmlContent, projectName)
    await writeFile(deploymentYmlPath, deploymentYmlContent)
  }

  if (!isMonorepo) await installImpactValidation(webPath, 'web')

  // Branch placeholders in CI workflows: PRs target the working branch + main, deploys push from main
  const ciPrBranchList = [...new Set([workflow?.workingBranch || mainBranch, mainBranch])]
  const ciPrBranches = ciPrBranchList.join(', ')
  await substitutePlaceholdersInFiles([`${webPath}/.github/workflows/test.yml`, deploymentYmlPath], {
    MAIN_BRANCH: mainBranch,
    CI_PR_BRANCHES: ciPrBranches,
    ...impactValidationPlaceholders(mainBranch, workflow?.workingBranch)
  })

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

  // Install the PWA module (if selected) — makes the app installable as a desktop application
  if (includePwa) {
    await installPwaModule({ webPath, projectName, projectDescription })
  }

  // Install workflow artefacts (skill + tool skill) when a workflow is configured
  await installWorkflowArtifacts({ targetPath: webPath, workflow })

  return true
}

/** Apply the external effects required to make a rendered multirepo web app ready to use. */
export async function provisionWebApp({ targetDir = '.', isMonorepo, projectName, frontendRepoUrl, mainBranch, workflow }: CreateWebAppParams): Promise<void> {
  if (isMonorepo) return
  const webPath = join(targetDir, `apps/${projectName}-web`)
  const nvm = getNvmPrefix(webPath)

  // Install once, after every module installer has finalized package.json.
  runRequired('npm install (web)', `${nvm}npm install`, { cwd: webPath })

  const workingBranch = workflow?.workingBranch
  assertGitBranchName(mainBranch)
  if (workingBranch) assertGitBranchName(workingBranch)
  runBestEffortArgv('git init (web)', 'git', ['init'], { cwd: webPath, onSkipped: warn })
  runBestEffortArgv('git checkout (web)', 'git', ['checkout', '-b', mainBranch], { cwd: webPath, onSkipped: warn })
  if (frontendRepoUrl) runBestEffortArgv('git remote add (web)', 'git', ['remote', 'add', 'origin', frontendRepoUrl], { cwd: webPath, onSkipped: warn })
  runBestEffortArgv('git add (web)', 'git', ['add', '.'], { cwd: webPath, onSkipped: warn })
  runBestEffortArgv('git commit (web)', 'git', ['commit', '-m', 'Initial commit'], { cwd: webPath, onSkipped: warn })
  if (workingBranch && workingBranch !== mainBranch) runBestEffortArgv('git working branch (web)', 'git', ['checkout', '-b', workingBranch], { cwd: webPath, onSkipped: warn })
}
