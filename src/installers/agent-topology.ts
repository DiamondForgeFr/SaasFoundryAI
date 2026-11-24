import { cp, lstat, mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join, posix } from 'path'

import {
  installAgentInstructions,
  installTierAgents,
  planAgentInstructionFileSet,
  planTierAgentFiles,
  previewPlannedAgentInstructions,
  type AgentInstructionsPreview
} from '../harness/agent-instructions'
import { resolveHarnessAgents, type HarnessAgent } from '../harness/agent-registry'
import { CODEX_HOOKS_PATH } from '../harness/delegation-hooks'
import type { SaaSFoundryManifest } from '../types'
import { readManifestFileSafe, replaceManifestFileSafe } from '../manifest-file'

export function projectMultirepoChildManifest(manifest: SaaSFoundryManifest, app: 'api' | 'web'): SaaSFoundryManifest {
  const harness = manifest.modules?.harness
  if (!harness) throw new Error('Cannot project a multirepo child manifest without a harness declaration.')
  const appName = `${manifest.projectName}-${app}`
  return {
    $schema: manifest.$schema,
    manifestVersion: manifest.manifestVersion,
    version: manifest.version,
    generatedAt: manifest.generatedAt,
    structure: 'cli',
    projectName: appName,
    projection: { kind: 'multirepo-child', rootProjectName: manifest.projectName, app },
    mainBranch: manifest.mainBranch,
    modules: { harness: JSON.parse(JSON.stringify(harness)), advancedSkills: [...(manifest.modules?.advancedSkills ?? [])] },
    language: manifest.language ? JSON.parse(JSON.stringify(manifest.language)) : undefined,
    workflow: manifest.workflow ? JSON.parse(JSON.stringify(manifest.workflow)) : undefined,
    aiRules: manifest.aiRules ? JSON.parse(JSON.stringify(manifest.aiRules)) : undefined,
    tools: manifest.tools ? JSON.parse(JSON.stringify(manifest.tools)) : undefined,
    skillsAccounts: manifest.skillsAccounts ? JSON.parse(JSON.stringify(manifest.skillsAccounts)) : undefined,
    fileHashes: {}
  }
}

/**
 * Multirepo apps are independent Git checkouts. Agent lifecycle commands run
 * from those checkout roots, so each app needs a regular manifest projection
 * even though the project root remains the canonical scaffold manifest.
 */
export async function writeMultirepoAgentManifests(manifest: SaaSFoundryManifest, projectName: string): Promise<void> {
  if (manifest.structure !== 'multirepo') return
  if (manifest.projectName !== projectName) throw new Error('The multirepo projection project name must match the root manifest.')
  for (const app of ['api', 'web'] as const) {
    const appName = `${projectName}-${app}`
    const projection = projectMultirepoChildManifest(manifest, app)
    await mkdir(`apps/${appName}`, { recursive: true })
    await writeFile(`apps/${appName}/.saasfoundry.json`, JSON.stringify(projection, null, 2))
  }
}

/** What the agent-instruction refresh wrote, every target together, paths relative to the project root (#1315). */
export interface SelectedAgentInstructionsSummary {
  updated: string[]
  added: string[]
  conflicts: string[]
  removed: string[]
  /** Manifests whose baselines the refresh rewrote. */
  manifests: string[]
}

const agentTargets = (manifest: SaaSFoundryManifest, projectName: string): string[] => (manifest.structure === 'multirepo' ? [`apps/${projectName}-api`, `apps/${projectName}-web`] : ['.'])

const atRoot = (targetPath: string, path: string): string => (targetPath === '.' ? path : posix.join(targetPath, path))

export async function installSelectedAgentInstructions(
  manifest: SaaSFoundryManifest,
  projectName: string,
  agents: HarnessAgent[] | undefined,
  persistRootManifest?: () => Promise<void>,
  { tierAgentsOnly = false }: { tierAgentsOnly?: boolean } = {}
): Promise<SelectedAgentInstructionsSummary> {
  const declaredAgents = resolveHarnessAgents(agents)
  const install = tierAgentsOnly ? installTierAgents : installAgentInstructions
  const summary: SelectedAgentInstructionsSummary = { updated: [], added: [], conflicts: [], removed: [], manifests: [] }

  for (const targetPath of agentTargets(manifest, projectName)) {
    const targetManifestPath = targetPath === '.' ? '.saasfoundry.json' : `${targetPath}/.saasfoundry.json`
    const childSnapshot = targetPath === '.' ? undefined : await readManifestFileSafe(targetManifestPath)
    const targetManifest = childSnapshot ? (JSON.parse(childSnapshot.bytes.toString('utf8')) as SaaSFoundryManifest) : manifest
    const targetAgents = childSnapshot ? resolveHarnessAgents(targetManifest.modules?.harness?.agents ?? agents) : declaredAgents
    const report = await install({ targetPath, agents: targetAgents, manifest: targetManifest })
    for (const warning of report.warnings) console.warn(warning)
    for (const conflict of report.conflicts) console.warn(`Agent instructions need reconciliation: ${conflict}`)
    const added = new Set(report.added ?? [])
    summary.added.push(...report.written.filter((path) => added.has(path)).map((path) => atRoot(targetPath, path)))
    summary.updated.push(...report.written.filter((path) => !added.has(path)).map((path) => atRoot(targetPath, path)))
    summary.conflicts.push(...report.conflicts.map((path) => atRoot(targetPath, path)))
    summary.removed.push(...(report.removed ?? []).map((path) => atRoot(targetPath, path)))
    if (Object.entries(report.fileHashes).some(([path, hash]) => targetManifest.fileHashes?.[path] !== hash)) {
      targetManifest.fileHashes = { ...targetManifest.fileHashes, ...report.fileHashes }
      if (targetPath === '.') Object.assign(manifest, targetManifest)
      if (targetPath === '.' && persistRootManifest) await persistRootManifest()
      else if (childSnapshot) await replaceManifestFileSafe(childSnapshot, Buffer.from(JSON.stringify(targetManifest, null, 2)))
      else await writeFile(targetManifestPath, JSON.stringify(targetManifest, null, 2))
      summary.manifests.push(targetManifestPath)
    }
  }
  return summary
}

/**
 * Files a refresh earlier in the same `sf update` would write before the agent instructions are rendered,
 * keyed by project-root-relative path: their new bytes, or `null` for a removal (#1315).
 */
export type PendingRefreshWrites = ReadonlyMap<string, Buffer | null>

/** The preview of every target together, paths relative to the project root. */
export interface SelectedAgentInstructionsPreview extends AgentInstructionsPreview {
  /** Manifests whose recorded baselines the refresh would rewrite. */
  manifests: string[]
}

/** Whether a path is one the agent-instruction render reads: the instructions, the Codex hooks, the skill sources. */
export function isAgentInstructionSource(path: string): boolean {
  return path === 'AGENTS.md' || path === 'CLAUDE.md' || path === CODEX_HOOKS_PATH || path.startsWith('.claude/skills/')
}

/**
 * Copy what the render reads into a scratch directory, links kept as links so the render refuses them the
 * same way, then lay the pending refresh writes over it.
 */
async function stageInstructionSources(targetPath: string, pending: PendingRefreshWrites): Promise<string> {
  const staging = await mkdtemp(join(tmpdir(), 'saasfoundry-agent-preview-'))
  for (const path of ['AGENTS.md', 'CLAUDE.md', CODEX_HOOKS_PATH, '.claude/skills']) {
    const source = join(targetPath, path)
    try {
      await lstat(source)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    await mkdir(dirname(join(staging, path)), { recursive: true })
    await cp(source, join(staging, path), { recursive: true, verbatimSymlinks: true, filter: (from) => !from.split(/[\\/]/).includes('node_modules') })
  }
  for (const [path, content] of pending) {
    if (!isAgentInstructionSource(path) || path.split('/').includes('..')) continue
    const destination = join(staging, path)
    if (content === null) {
      await rm(destination, { force: true })
      continue
    }
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, content)
  }
  return staging
}

/**
 * What `installSelectedAgentInstructions` would write, with nothing written (#1315): the instructions are
 * rendered from a staged copy of the project that already carries the refresh earlier in the same update
 * (`pending`, root target only), then classified against the project as it stands. The `.codex/config.toml`
 * limit is left out: the dry run reports it as `codexInstructionLimit`.
 */
export async function previewSelectedAgentInstructions(
  manifest: SaaSFoundryManifest,
  projectName: string,
  agents: HarnessAgent[] | undefined,
  { tierAgentsOnly = false, pending = new Map() }: { tierAgentsOnly?: boolean; pending?: PendingRefreshWrites } = {}
): Promise<SelectedAgentInstructionsPreview> {
  const declaredAgents = resolveHarnessAgents(agents)
  const preview: SelectedAgentInstructionsPreview = { update: [], add: [], conflict: [], remove: [], recordsBaselines: false, manifests: [], warnings: [] }

  for (const targetPath of agentTargets(manifest, projectName)) {
    const targetManifestPath = targetPath === '.' ? '.saasfoundry.json' : `${targetPath}/.saasfoundry.json`
    const childSnapshot = targetPath === '.' ? undefined : await readManifestFileSafe(targetManifestPath)
    const targetManifest = childSnapshot ? (JSON.parse(childSnapshot.bytes.toString('utf8')) as SaaSFoundryManifest) : manifest
    const targetAgents = childSnapshot ? resolveHarnessAgents(targetManifest.modules?.harness?.agents ?? agents) : declaredAgents
    let staging: string | undefined
    try {
      let plan
      if (tierAgentsOnly) plan = planTierAgentFiles({ targetPath, agents: targetAgents, manifest: targetManifest })
      else {
        staging = await stageInstructionSources(targetPath, targetPath === '.' ? pending : new Map())
        plan = await planAgentInstructionFileSet({ targetPath: staging, agents: targetAgents, manifest: targetManifest })
      }
      const result = await previewPlannedAgentInstructions(targetPath, plan, targetManifest.fileHashes)
      preview.update.push(...result.update.map((path) => atRoot(targetPath, path)))
      preview.add.push(...result.add.map((path) => atRoot(targetPath, path)))
      preview.conflict.push(...result.conflict.map((path) => atRoot(targetPath, path)))
      preview.remove.push(...result.remove.map((path) => atRoot(targetPath, path)))
      if (result.recordsBaselines) {
        preview.recordsBaselines = true
        preview.manifests.push(targetManifestPath)
      }
      // The warnings name paths of the staged copy: report them relative to the project.
      preview.warnings.push(...result.warnings.map((warning) => (staging ? warning.split(staging).join(targetPath) : warning)))
    } catch (error) {
      preview.warnings.push(`${targetPath === '.' ? 'Agent instructions' : `${targetPath}: agent instructions`} could not be previewed: ${(error as Error).message}`)
    } finally {
      if (staging) await rm(staging, { recursive: true, force: true }).catch(() => {})
    }
  }
  return preview
}
