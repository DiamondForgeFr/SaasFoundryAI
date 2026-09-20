import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import { installAgentInstructions } from '../harness/agent-instructions'
import { resolveHarnessAgents } from '../harness/agent-registry'
import { emailInstallerMeta } from '../installers/email.installer'
import { installSkills } from '../installers/skills.installer'
import { pwaInstallerMeta } from '../installers/pwa.installer'
import { assertTemporaryTechnicalStack, type RenderedTechnicalStack } from '../renderers/technical-stack.renderer'
import type { Answers, ProjectPorts, SaaSFoundryManifest } from '../types'
import { validateProjectName } from '../utils'
import { technicalOwnershipHashes, type TechnicalStackAdoptionPlan } from './technical-stack.planner'

export interface BuildTechnicalTransitionManifestOptions {
  current: SaaSFoundryManifest
  config: Answers
  ports: ProjectPorts
  cliVersion: string
  plan?: TechnicalStackAdoptionPlan
}

/**
 * Construct the post-adoption manifest from explicit technical choices.
 * Existing collaboration configuration and hashes are preserved byte-for-byte
 * at the value level; only newly created technical files become owned.
 */
export function buildTechnicalTransitionManifest({ current, config, ports, cliVersion, plan }: BuildTechnicalTransitionManifestOptions): SaaSFoundryManifest {
  const next: SaaSFoundryManifest = JSON.parse(JSON.stringify(current)) as SaaSFoundryManifest
  const existingModules = current.modules ?? {}
  next.version = cliVersion
  next.structure = config.isMonorepo ? 'monorepo' : 'multirepo'
  next.mainBranch = config.mainBranch
  next.ports = { ...ports }
  next.modules = {
    ...existingModules,
    email: { provider: config.emailService, version: emailInstallerMeta.currentVersion },
    s3Setup: config.s3Setup,
    dbSetup: config.dbSetup,
    includeAnalytics: config.includeAnalytics,
    advancedSkills: existingModules.advancedSkills ?? config.advancedSkills ?? []
  }
  if (config.includePwa) next.modules.pwa = { version: pwaInstallerMeta.currentVersion }
  else delete next.modules.pwa
  next.fileHashes = { ...(current.fileHashes ?? {}), ...(plan ? technicalOwnershipHashes(plan) : {}) }
  return next
}

function childManifest(root: SaaSFoundryManifest, appName: string): SaaSFoundryManifest {
  if (!root.modules?.harness) throw new Error('A managed harness declaration is required before creating multirepo projections.')
  return {
    $schema: root.$schema,
    manifestVersion: root.manifestVersion,
    version: root.version,
    generatedAt: root.generatedAt,
    structure: 'cli',
    projectName: appName,
    mainBranch: root.mainBranch,
    modules: {
      harness: JSON.parse(JSON.stringify(root.modules.harness)),
      advancedSkills: [...(root.modules.advancedSkills ?? [])]
    },
    language: root.language ? JSON.parse(JSON.stringify(root.language)) : undefined,
    workflow: root.workflow ? JSON.parse(JSON.stringify(root.workflow)) : undefined,
    aiRules: root.aiRules ? JSON.parse(JSON.stringify(root.aiRules)) : undefined,
    tools: root.tools ? JSON.parse(JSON.stringify(root.tools)) : undefined,
    skillsAccounts: root.skillsAccounts ? JSON.parse(JSON.stringify(root.skillsAccounts)) : undefined,
    fileHashes: {}
  }
}

export interface FinalizeTechnicalCandidateOptions {
  candidate: RenderedTechnicalStack
  projectRoot: string
  manifest: SaaSFoundryManifest
  cliVersion: string
}

function isNested(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

/**
 * Remove root collaboration deposits from the isolated render and finish the
 * multirepo children. The live harness is never read or written here.
 */
export async function finalizeTechnicalAdoptionCandidate({ candidate, projectRoot, manifest, cliVersion }: FinalizeTechnicalCandidateOptions): Promise<void> {
  const trustedRoot = assertTemporaryTechnicalStack(candidate)
  validateProjectName(manifest.projectName)
  const requestedRoot = resolve(trustedRoot)
  const requestedStat = await lstat(requestedRoot, { bigint: true })
  if (!requestedStat.isDirectory() || requestedStat.isSymbolicLink()) throw new Error('The technical candidate root must be a real temporary directory.')
  const [root, liveRoot] = await Promise.all([realpath(requestedRoot), realpath(resolve(projectRoot))])
  if (isNested(root, liveRoot) || isNested(liveRoot, root)) throw new Error('The technical candidate and live project roots must not overlap.')
  const assertCandidateRoot = async (): Promise<void> => {
    const current = await lstat(root, { bigint: true })
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== requestedStat.dev || current.ino !== requestedStat.ino) {
      throw new Error('The technical candidate root changed during finalization.')
    }
  }

  await assertCandidateRoot()
  const gitPath = join(root, '.git')
  const git = await lstat(gitPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (git) throw new Error('A temporary technical candidate must not contain Git metadata.')

  // Root collaboration deposits remain in the private candidate and are
  // excluded by the planner. Avoiding destructive pruning keeps finalization
  // safe even if the scratch pathname is concurrently replaced.
  if (manifest.structure !== 'multirepo') return
  const apiRelative = `apps/${manifest.projectName}-api`
  const webRelative = `apps/${manifest.projectName}-web`
  await installSkills({
    targetDir: root,
    isMonorepo: false,
    apiPath: apiRelative,
    webPath: webRelative,
    projectName: manifest.projectName,
    version: cliVersion,
    mainBranch: manifest.mainBranch,
    advancedSkills: manifest.modules?.advancedSkills ?? []
  })

  const agents = resolveHarnessAgents(manifest.modules?.harness?.agents)
  for (const relative of [apiRelative, webRelative]) {
    await assertCandidateRoot()
    const appName = relative.split('/').at(-1)!
    const targetPath = join(root, ...relative.split('/'))
    await mkdir(targetPath, { recursive: true })
    const projection = childManifest(manifest, appName)
    const report = await installAgentInstructions({ targetPath, agents, manifest: projection })
    if (report.conflicts.length > 0) throw new Error(`Generated multirepo agent entrypoints conflict: ${report.conflicts.join(', ')}`)
    projection.fileHashes = { ...projection.fileHashes, ...report.fileHashes }
    await writeFile(join(targetPath, '.saasfoundry.json'), JSON.stringify(projection, null, 2))
  }
}

/** Read a child projection without exposing its candidate root in reports. */
export async function readCandidateChildManifest(candidateRoot: string, appName: string): Promise<SaaSFoundryManifest> {
  validateProjectName(appName.replace(/-(?:api|web)$/, ''))
  return JSON.parse(await readFile(join(resolve(candidateRoot), 'apps', appName, '.saasfoundry.json'), 'utf8')) as SaaSFoundryManifest
}
