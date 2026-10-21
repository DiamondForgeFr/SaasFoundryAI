import { readFile } from 'fs/promises'
import { join } from 'path'

import { readCommittedFile } from './git-agent-scope'
import { resolveAdjustPolicy, type AdjustPolicy } from './routing-adjust-config'
import { routingOverrideIssues, type RoutingOverrides } from './routing-grid'
import type { HarnessAgent, SaaSFoundryManifest } from '../types'

/**
 * What the routing decisions rest on. The worktree a hook runs in may hold an uncommitted manifest (a
 * delegated agent can edit its own), and a move applies to every worktree of the clone: so thresholds,
 * prices and overrides for a decision are read from the **committed working branch**, and a move is
 * refused while the worktree's own block differs from it.
 */
export interface RoutingDecisionSource {
  routing?: RoutingOverrides
  policy: AdjustPolicy
  /** `working-branch`: read from the committed branch. `worktree`: no committed manifest could be read (no commit yet, no such branch). */
  source: 'working-branch' | 'worktree'
  branch: string | null
  /** The committed block cannot be read or does not validate: nothing is decided until it is fixed. */
  invalid: string | null
  /** The worktree's `modules.harness.routing` differs from the committed one: a move would rest on something the team has not committed. */
  differs: boolean
}

export interface ProjectRouting {
  /** Undefined outside a SaaSFoundry project: the shipped grid and the shipped policy apply. */
  manifest?: SaaSFoundryManifest
  /** The shared overrides the developer (or a promotion) wrote in the manifest of this worktree: what a session here is routed by. */
  routing?: RoutingOverrides
  agents: HarnessAgent[]
  /** The policy of this worktree's manifest; automatic decisions use `decision.policy`. */
  policy: AdjustPolicy
  decision: RoutingDecisionSource
}

/** Key-order independent JSON, so two manifests that say the same thing compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

interface CommittedRouting {
  routing?: RoutingOverrides
  branch: string
  /** Why the committed block cannot be used; no decision rests on a block nobody can read. */
  invalid: string | null
}

async function committedRouting(root: string, manifest: SaaSFoundryManifest | undefined): Promise<CommittedRouting | undefined> {
  const branch = manifest?.workflow?.workingBranch
  if (typeof branch !== 'string' || !branch) return undefined
  const text = await readCommittedFile(root, branch, '.saasfoundry.json')
  if (text === undefined) return undefined
  let committed: SaaSFoundryManifest
  try {
    committed = JSON.parse(text) as SaaSFoundryManifest
  } catch {
    return { branch, invalid: `.saasfoundry.json on ${branch} is not valid JSON` }
  }
  const routing = committed.modules?.harness?.routing
  const issues = routingOverrideIssues(routing)
  if (issues.length) return { branch, invalid: `modules.harness.routing on ${branch} is invalid (${issues[0]})` }
  return { ...(routing ? { routing } : {}), branch, invalid: null }
}

/**
 * The routing a project declares, read once and validated: the shared overrides, the declared coding
 * agents and the adjustment policy. A manifest that cannot be read, or whose routing block is
 * invalid, fails closed: an automatic move must never be applied over a configuration nobody checked.
 * A committed block that is invalid does not stop a route from being answered from the worktree's own
 * block, but no decision is taken on it (`decision.invalid`).
 */
export async function readProjectRouting(root: string, options: { validate?: boolean } = {}): Promise<ProjectRouting> {
  let manifest: SaaSFoundryManifest | undefined
  try {
    manifest = JSON.parse(await readFile(join(root, '.saasfoundry.json'), 'utf8')) as SaaSFoundryManifest
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`.saasfoundry.json cannot be read: ${error instanceof Error ? error.message : String(error)}`)
  }
  const harness = manifest?.modules?.harness
  // A caller that answers other questions first (which agent, which kind) validates when it resolves a route.
  const issues = options.validate === false ? [] : routingOverrideIssues(harness?.routing)
  if (issues.length) throw new Error(`Invalid modules.harness.routing:\n- ${issues.join('\n- ')}`)
  const policy = resolveAdjustPolicy(harness?.routing?.adjust)
  const committed = harness ? await committedRouting(root, manifest) : undefined
  const decision: RoutingDecisionSource = committed
    ? {
        ...(committed.routing ? { routing: committed.routing } : {}),
        policy: resolveAdjustPolicy(committed.routing?.adjust),
        source: 'working-branch',
        branch: committed.branch,
        invalid: committed.invalid,
        differs: committed.invalid !== null || canonical(committed.routing ?? null) !== canonical(harness?.routing ?? null)
      }
    : { ...(harness?.routing ? { routing: harness.routing } : {}), policy, source: 'worktree', branch: null, invalid: null, differs: false }
  return {
    ...(manifest ? { manifest } : {}),
    ...(harness?.routing ? { routing: harness.routing } : {}),
    // A harness without an agent declaration is the legacy Claude Code setup.
    agents: harness ? (harness.agents ?? ['claude-code']) : [],
    policy,
    decision
  }
}
