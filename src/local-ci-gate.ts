import fs from 'fs'
import path from 'path'

import { MOLTEN_PROJECT_FILE, declaredMoltenJobs } from './molten-pipeline'
import type { SaaSFoundryManifest } from './types'

/**
 * The step the agent publishes after the project's own suite ran: `workflow-cli.sh ai-status <ticket> "Local CI" success`
 * becomes the commit status `AI testing / Local CI`.
 */
export const AGENT_LOCAL_CI_STEP = 'Local CI'
export const AGENT_LOCAL_CI_CONTEXT = `AI testing / ${AGENT_LOCAL_CI_STEP}`

/**
 * Where the commit statuses a pull request needs come from (#1104), in this order:
 * - `manifest`: `workflow.localCi.requiredStatuses` lists them. The manifest always wins.
 * - `manifest-none`: that list is empty, a deliberate "this project has no local CI".
 * - `molten`: the key is absent and `.molten/project.json` declares jobs that publish to GitHub: `local-<job>` each.
 * - `agent`: neither, so the status the agent publishes once the project's suite is green.
 *
 * `github-projects-cli.sh` resolves the same list at run time (`resolve_local_ci_required`): the two are kept in
 * step by the specs that run both on the same fixtures.
 */
export type LocalCiGateSource = 'manifest' | 'manifest-none' | 'molten' | 'agent'

export interface LocalCiGate {
  source: LocalCiGateSource
  requiredStatuses: string[]
  /** A Molten pipeline exists whose verdicts the gate cannot read (it does not publish to GitHub). */
  moltenNote?: string
}

export type LocalCiGateResult = LocalCiGate | { error: string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whether a parsed `.molten/project.json` publishes its verdicts as GitHub commit statuses (`"ci": { "statuses": "github" }`). */
export function moltenPublishesToGithub(project: unknown): boolean {
  return isRecord(project) && isRecord(project.ci) && project.ci.statuses === 'github'
}

/** The status each job of a parsed `.molten/project.json` publishes: `local-<job>`. */
export function moltenStatusContexts(project: unknown): string[] {
  return declaredMoltenJobs(project).map((job) => `local-${job.name}`)
}

/**
 * The commit statuses the project's gate requires, and where they come from. Reads `.saasfoundry.json` (already parsed by
 * the caller) and `.molten/project.json`; never runs `molten`. A declaration that cannot be read is an error, never a
 * fallback to a weaker gate.
 */
export function resolveLocalCiGate(projectRoot: string, manifest: SaaSFoundryManifest | null): LocalCiGateResult {
  const declared: unknown = manifest?.workflow?.localCi?.requiredStatuses
  if (declared !== undefined && declared !== null) {
    if (!Array.isArray(declared) || declared.some((entry) => typeof entry !== 'string' || entry === '')) {
      return { error: 'workflow.localCi.requiredStatuses must be a list of commit status contexts (strings)' }
    }
    const requiredStatuses = declared as string[]
    return { source: requiredStatuses.length > 0 ? 'manifest' : 'manifest-none', requiredStatuses }
  }

  const file = path.join(projectRoot, MOLTEN_PROJECT_FILE)
  let moltenNote: string | undefined
  if (fs.existsSync(file)) {
    let project: unknown
    try {
      project = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (error) {
      return { error: `Could not read ${MOLTEN_PROJECT_FILE}: ${error instanceof Error ? error.message : String(error)}` }
    }
    if (!isRecord(project)) return { error: `Could not read ${MOLTEN_PROJECT_FILE}: it is not a JSON object` }
    const contexts = moltenStatusContexts(project)
    if (contexts.length > 0) {
      if (moltenPublishesToGithub(project)) return { source: 'molten', requiredStatuses: contexts }
      moltenNote = `${MOLTEN_PROJECT_FILE} declares a pipeline but not "ci": { "statuses": "github" }, so its verdicts are not published as commit statuses the gate can read`
    }
  }
  return { source: 'agent', requiredStatuses: [AGENT_LOCAL_CI_CONTEXT], ...(moltenNote ? { moltenNote } : {}) }
}

/** The gate on one line: how many statuses, and from where. */
export function localCiGateSummary(gate: LocalCiGateResult): string {
  if ('error' in gate) return `unreadable (${gate.error})`
  const count = gate.requiredStatuses.length
  switch (gate.source) {
    case 'manifest':
      return `${count} status${count === 1 ? '' : 'es'} from workflow.localCi.requiredStatuses`
    case 'manifest-none':
      return 'none: workflow.localCi.requiredStatuses is an empty list (no local CI declared)'
    case 'molten':
      return `${count} local-<job> status${count === 1 ? '' : 'es'} derived from ${MOLTEN_PROJECT_FILE}`
    case 'agent':
      return `${AGENT_LOCAL_CI_CONTEXT}, published by ai-status once the project's own suite is green`
  }
}
