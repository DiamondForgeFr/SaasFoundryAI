import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { provisionApiApp, renderApiApp } from '../builders/api.builder'
import { createDevServicesCompose } from '../builders/dev-services.builder'
import { provisionMonorepoRoot, renderMonorepoRoot } from '../builders/monorepo.builder'
import { provisionWebApp, renderWebApp } from '../builders/web.builder'
import type { Answers, ProjectPorts } from '../types'

export interface TechnicalStackRenderOptions {
  /** Explicit project root. Rendering never changes or reads the process cwd. */
  targetDir: string
  config: Answers
  ports: ProjectPorts
  /** Opt in to npm, Prisma and Git provisioning after every file is rendered. */
  externalEffects?: boolean
}

export interface RenderedTechnicalStack {
  rootDir: string
  apiPath: string
  webPath: string
}

/**
 * Render one complete technical candidate into an explicit directory.
 *
 * All file rendering finishes before optional npm, Prisma or Git effects begin,
 * which lets profile transitions inspect and merge the exact same candidate used
 * by `sf new` without touching the current project.
 */
export async function renderTechnicalStack({ targetDir, config, ports, externalEffects = false }: TechnicalStackRenderOptions): Promise<RenderedTechnicalStack> {
  const apiPath = join(targetDir, config.isMonorepo ? 'apps/api' : `apps/${config.projectName}-api`)
  const webPath = join(targetDir, config.isMonorepo ? 'apps/web' : `apps/${config.projectName}-web`)
  await mkdir(join(targetDir, 'apps'), { recursive: true })

  const shared = { targetDir, externalEffects: false }
  await renderApiApp({
    ...shared,
    isMonorepo: config.isMonorepo,
    projectName: config.projectName,
    projectDescription: config.projectDescription,
    backendRepoUrl: config.backendRepoUrl,
    dbCredentials: config.dbCredentials,
    mainBranch: config.mainBranch,
    emailService: config.emailService,
    mailersendApiKey: config.mailersendApiKey,
    mailersendSenderEmail: config.mailersendSenderEmail,
    mailersendSenderName: config.mailersendSenderName,
    s3Setup: config.s3Setup,
    s3Credentials: config.s3Credentials,
    workflow: config.workflow,
    ports
  })

  if (config.dbSetup === 'docker' || config.s3Setup === 'docker') {
    await createDevServicesCompose({
      apiPath,
      projectName: config.projectName,
      dbSetup: config.dbSetup,
      dbCredentials: config.dbCredentials,
      s3Setup: config.s3Setup,
      s3Credentials: config.s3Credentials,
      s3Ports: { api: ports.s3, console: ports.s3Console }
    })
  }

  await renderWebApp({
    ...shared,
    isMonorepo: config.isMonorepo,
    projectName: config.projectName,
    projectDescription: config.projectDescription,
    frontendRepoUrl: config.frontendRepoUrl || '',
    mainBranch: config.mainBranch,
    s3Setup: config.s3Setup,
    includeAnalytics: config.includeAnalytics,
    includePwa: config.includePwa ?? true,
    workflow: config.workflow,
    ports
  })

  if (config.isMonorepo) {
    await renderMonorepoRoot({
      ...shared,
      projectName: config.projectName,
      projectDescription: config.projectDescription,
      monorepoUrl: config.monorepoUrl,
      mainBranch: config.mainBranch,
      workflow: config.workflow,
      ports
    })
  }

  if (externalEffects) {
    if (config.isMonorepo) {
      await provisionMonorepoRoot({
        targetDir,
        projectName: config.projectName,
        projectDescription: config.projectDescription,
        monorepoUrl: config.monorepoUrl,
        mainBranch: config.mainBranch,
        workflow: config.workflow,
        ports
      })
    } else {
      await provisionApiApp({
        targetDir,
        isMonorepo: false,
        projectName: config.projectName,
        projectDescription: config.projectDescription,
        backendRepoUrl: config.backendRepoUrl,
        dbCredentials: config.dbCredentials,
        mainBranch: config.mainBranch,
        emailService: config.emailService,
        s3Setup: config.s3Setup,
        workflow: config.workflow
      })
      await provisionWebApp({
        targetDir,
        isMonorepo: false,
        projectName: config.projectName,
        projectDescription: config.projectDescription,
        frontendRepoUrl: config.frontendRepoUrl || '',
        mainBranch: config.mainBranch,
        s3Setup: config.s3Setup,
        includeAnalytics: config.includeAnalytics,
        includePwa: config.includePwa ?? true,
        workflow: config.workflow
      })
    }
  }

  return { rootDir: targetDir, apiPath, webPath }
}

/** Secure scratch generation with cleanup guaranteed after success or failure. */
export async function withTemporaryTechnicalStack<T>(
  options: Omit<TechnicalStackRenderOptions, 'targetDir' | 'externalEffects'>,
  useCandidate: (candidate: RenderedTechnicalStack) => Promise<T>
): Promise<T> {
  const targetDir = await mkdtemp(join(tmpdir(), 'saasfoundry-stack-'))
  try {
    const candidate = await renderTechnicalStack({ ...options, targetDir, externalEffects: false })
    return await useCandidate(candidate)
  } finally {
    await rm(targetDir, { recursive: true, force: true })
  }
}
