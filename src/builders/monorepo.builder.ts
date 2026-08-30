import { copy } from 'fs-extra'
import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'

import { depositEmailSharedTypes } from '../installers/email.installer'
import { depositStorageSharedConfig } from '../installers/storage.installer'
import { installWorkflowArtifacts } from '../installers/harness.installer'
import { DEFAULT_PORTS } from '../ports'
import { CreateMonorepoRootParams, overlaysPath } from '../types'
import { applyProjectIdentity, fileExists, getNvmPrefix, replaceInFile, substitutePlaceholdersInFiles, validateProjectName } from '../utils'
import { runBestEffort, runRequired, warn } from '../run'

export async function createMonorepoRoot({ projectName, projectDescription, monorepoUrl, mainBranch, workflow, ports }: CreateMonorepoRootParams) {
  validateProjectName(projectName)

  const { api: apiPort } = ports ?? DEFAULT_PORTS

  // Copy monorepo root overlay to project root (current directory)
  await copy(resolve(overlaysPath, 'monorepo/root'), '.', { overwrite: true })

  // Substitute {{PROJECT_NAME}} in shared-* + api-client + ui-primitives package files (scoped package names + docs)
  await substitutePlaceholdersInFiles(
    [
      'packages/shared-types/package.json',
      'packages/shared-types/README.md',
      'packages/shared-validation/package.json',
      'packages/shared-validation/README.md',
      'packages/shared-config/package.json',
      'packages/shared-config/README.md',
      'packages/api-client/package.json',
      'packages/api-client/README.md',
      'packages/api-client/src/index.ts',
      'packages/ui-primitives/package.json',
      'packages/ui-primitives/README.md',
      'packages/ui-primitives/src/index.ts',
      'packages/ui-primitives/src/theme.css'
    ],
    { PROJECT_NAME: projectName }
  )

  // Monorepo commands run from the repository root, which is the cwd here.
  const nvm = getNvmPrefix(process.cwd())

  // Substitute {{PROJECT_NAME}} in root package.json BEFORE the JSON merge below so the
  // `codegen:api-client -w @<name>/api-client` script ends up with the project's npm scope.
  await substitutePlaceholdersInFiles(['package.json'], { PROJECT_NAME: projectName })

  // Update root package.json
  const packageJsonPath = 'package.json'
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  packageJson.name = projectName
  packageJson.description = projectDescription
  packageJson.repository.url = monorepoUrl || 'https://github.com/agachet/saasfoundry.git'
  packageJson.keywords = [projectName, 'saasfoundry', 'monorepo', 'turborepo']
  // `packageManager` deliberately keeps the value pinned in the template. It used to be stamped
  // with the *generating machine's* npm version, which made generation non-deterministic: the
  // scaffold's package manager depended on whoever ran `sf new`. Docker (npm 10.9.x) therefore
  // baked a broken npm into every generated monorepo — the whole npm 10 line crashes on this
  // workspace peer graph with "Cannot read properties of null (reading 'edgesOut')" (arborist
  // #loadPeerSet). npm 11+ resolves it. Keep the pin in the template, not the host's version.
  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

  // Update deployment workflow references with project-specific names
  const deployApiPath = '.github/workflows/deployment-api.yml'
  if (await fileExists(deployApiPath)) {
    let content = await readFile(deployApiPath, 'utf8')
    content = applyProjectIdentity(content, projectName)
    // Same port identity as the multirepo deployment workflow.
    content = content.replace(/PORT=\\"3500\\"/, `PORT=\\"${apiPort}\\"`).replace(/'\/ports:\/,\/3500\/d'/, `'/ports:/,/${apiPort}/d'`)
    await writeFile(deployApiPath, content)
  }

  const deployWebPath = '.github/workflows/deployment-web.yml'
  if (await fileExists(deployWebPath)) {
    let content = await readFile(deployWebPath, 'utf8')
    content = applyProjectIdentity(content, projectName)
    await writeFile(deployWebPath, content)
  }

  // The root CLAUDE.md tells the AI where the API docs live.
  await replaceInFile('CLAUDE.md', [[/http:\/\/localhost:3500/g, `http://localhost:${apiPort}`]])

  // Branch placeholders in CI workflows: PRs target the working branch + main, deploys push from main
  const ciPrBranches = [...new Set([workflow?.workingBranch || mainBranch, mainBranch])].join(', ')
  await substitutePlaceholdersInFiles(['.github/workflows/test.yml', deployApiPath, deployWebPath], { MAIN_BRANCH: mainBranch, CI_PR_BRANCHES: ciPrBranches })

  // Replay shared-config / shared-types deposits for any module the API
  // installer activated before the workspace existed. `installStorageModule`
  // and `installEmailModule` run during `createApiApp` (i.e. before this
  // builder lays down `packages/shared-config/` and `packages/shared-types/`),
  // so their mono-only deposits are no-ops the first time. The deposit fns are
  // idempotent + gated on activation markers, so calling them here covers
  // `sf new`, `sf update`, and the docker harness uniformly.
  await depositStorageSharedConfig({ apiPath: 'apps/api', projectName })
  await depositEmailSharedTypes({ apiPath: 'apps/api', projectName })

  // Install all dependencies at root (npm workspaces hoists everything)
  runRequired('npm install (monorepo root)', `${nvm}npm install`)

  // Generate Prisma client from the API workspace
  runRequired('prisma generate (api)', `${nvm}cd apps/api && npx prisma generate`)

  // Install workflow artefacts (skill + tool skill) when a workflow is configured
  await installWorkflowArtifacts({ targetPath: '.', workflow })

  // Initialize Git repository at root level
  runBestEffort('git init', 'git init', { onSkipped: warn })
  runBestEffort('git checkout', `git checkout -b ${mainBranch}`, { onSkipped: warn })
  if (monorepoUrl) runBestEffort('git remote add', `git remote add origin ${monorepoUrl}`, { onSkipped: warn })
  runBestEffort('git add', 'git add .', { onSkipped: warn })
  runBestEffort('git commit', 'git commit -m "Initial commit"', { onSkipped: warn })
  // Develop-first: the manifest declares workflow.workingBranch as the AI's work
  // branch — create it and stay on it so the repo matches its own documentation.
  const workingBranch = workflow?.workingBranch
  if (workingBranch && workingBranch !== mainBranch) runBestEffort('git working branch', `git checkout -b ${workingBranch}`, { onSkipped: warn })

  return true
}
