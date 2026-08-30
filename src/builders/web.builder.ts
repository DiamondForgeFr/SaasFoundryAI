import { copy } from 'fs-extra'
import { readFile, rm, writeFile } from 'fs/promises'
import { resolve } from 'path'

import glob from 'glob'

import { installAnalyticsModule } from '../installers/analytics.installer'
import { installPwaModule } from '../installers/pwa.installer'
import { installWorkflowArtifacts } from '../installers/harness.installer'
import { DEFAULT_PORTS } from '../ports'
import { blueprintsPath, CreateWebAppParams, overlaysPath } from '../types'
import { applyProjectIdentity, fileExists, getNvmPrefix, replaceInFile, substitutePlaceholdersInFiles, validateProjectName } from '../utils'
import { runBestEffort, runRequired, warn } from '../run'

export async function createWebApp({ isMonorepo, projectName, projectDescription, frontendRepoUrl, mainBranch, s3Setup, includeAnalytics, includePwa, workflow, ports }: CreateWebAppParams) {
  validateProjectName(projectName)

  const { api: apiPort, web: webPort } = ports ?? DEFAULT_PORTS

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

  // Branch placeholders in CI workflows: PRs target the working branch + main, deploys push from main
  const ciPrBranches = [...new Set([workflow?.workingBranch || mainBranch, mainBranch])].join(', ')
  await substitutePlaceholdersInFiles([`${webPath}/.github/workflows/test.yml`, deploymentYmlPath], { MAIN_BRANCH: mainBranch, CI_PR_BRANCHES: ciPrBranches })

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

  /**
   * Install once, after every module installer has had its say.
   *
   * This used to run before them, and the PWA installer adds `vite-plugin-pwa` to
   * package.json and its import to vite.config.ts — so the default web app shipped a config
   * importing a package nothing had installed, and `npm run dev` died before Vite started
   * (#608). The manifest recorded the module as installed all the same.
   *
   * The rule is the order, not a second install per module: package.json is final here, so
   * a module added later cannot reintroduce the gap by forgetting to install its own
   * dependency. Monorepo is unaffected either way — the root builder installs after every
   * builder has run.
   */
  if (!isMonorepo) {
    const nvm = getNvmPrefix(webPath)
    runRequired('npm install (web)', `${nvm}npm install --prefix ${webPath}`)
  }

  // Initialize Git repository
  if (!isMonorepo) {
    runBestEffort('git init (web)', `git init ${webPath}`, { onSkipped: warn })
    runBestEffort('git checkout (web)', `git -C ${webPath} checkout -b ${mainBranch}`, { onSkipped: warn })
    if (frontendRepoUrl) runBestEffort('git remote add (web)', `git -C ${webPath} remote add origin ${frontendRepoUrl}`, { onSkipped: warn })
    runBestEffort('git add (web)', `git -C ${webPath} add .`, { onSkipped: warn })
    runBestEffort('git commit (web)', `git -C ${webPath} commit -m "Initial commit"`, { onSkipped: warn })
    // Develop-first: create the declared working branch so the repo matches its docs.
    const workingBranch = workflow?.workingBranch
    if (workingBranch && workingBranch !== mainBranch) runBestEffort('git working branch (web)', `git -C ${webPath} checkout -b ${workingBranch}`, { onSkipped: warn })
  }

  return true
}
