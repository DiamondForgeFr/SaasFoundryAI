import { readFile } from 'fs/promises'
import { join } from 'path'

import { defaultRemoteBranch, readCommittedFile, readHeadFile } from './git-agent-scope'
import { resolveAdjustPolicy, type AdjustPolicy } from './routing-adjust-config'
import { routingOverrideIssues, type RoutingOverrides } from './routing-grid'
import type { HarnessAgent, SaaSFoundryManifest } from '../types'

/**
 * What the routing decisions rest on. The worktree a hook runs in may hold an uncommitted manifest (a
 * delegated agent can edit its own), and a move applies to every worktree of the clone: so thresholds,
 * prices and overrides for a decision are read from the **committed working branch**, and a move is
 * refused while the worktree's own block differs from it, or while no committed manifest can be read.
 */
export interface RoutingDecisionSource {
  routing?: RoutingOverrides
  policy: AdjustPolicy
  /**
   * `working-branch`: read from the committed working branch. `head`: no committed manifest names one, so the
   * commit the worktree is on is the committed copy. `shipped`: the project has no harness block, so there is
   * nothing to decide on.
   */
  source: 'working-branch' | 'head' | 'shipped'
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
  source: 'working-branch' | 'head'
  branch: string
  /** Why the committed block cannot be used; no decision rests on a block nobody can read. */
  invalid: string | null
}

const NAMED_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/

/**
 * The working branch, named by a **committed** manifest: the one on the remote's default branch, then the one
 * on the commit the worktree is on. The manifest on disk is never asked, since the worktree is exactly where
 * the name could be changed to a branch that does not exist. When no committed manifest names it, the
 * remote's default branch is the best guess there is.
 */
async function committedWorkingBranch(root: string): Promise<string | undefined> {
  const remote = await defaultRemoteBranch(root)
  const sources = [remote ? await readCommittedFile(root, remote, '.saasfoundry.json') : undefined, await readHeadFile(root, '.saasfoundry.json')]
  for (const text of sources) {
    if (text === undefined) continue
    try {
      const name = (JSON.parse(text) as SaaSFoundryManifest).workflow?.workingBranch
      if (typeof name === 'string' && NAMED_BRANCH.test(name) && !name.includes('..')) return name
    } catch {
      // A committed manifest that is not JSON names nothing.
    }
  }
  return remote
}

function parseCommitted(text: string, source: CommittedRouting['source'], branch: string): CommittedRouting {
  let committed: SaaSFoundryManifest
  try {
    committed = JSON.parse(text) as SaaSFoundryManifest
  } catch {
    return { source, branch, invalid: `.saasfoundry.json on ${branch} is not valid JSON` }
  }
  const routing = committed.modules?.harness?.routing
  const issues = routingOverrideIssues(routing)
  if (issues.length) return { source, branch, invalid: `modules.harness.routing on ${branch} is invalid (${issues[0]})` }
  return { ...(routing ? { routing } : {}), source, branch, invalid: null }
}

/**
 * The committed copy of the routing block a decision rests on. With a harness there is always one answer:
 * the block, or the reason there is none (`invalid`), so a worktree cannot get its own thresholds applied by
 * hiding the committed manifest.
 */
async function committedRouting(root: string): Promise<CommittedRouting> {
  const named = await committedWorkingBranch(root)
  if (named) {
    const text = await readCommittedFile(root, named, '.saasfoundry.json')
    return text === undefined
      ? { source: 'working-branch', branch: named, invalid: `no committed .saasfoundry.json can be read on the working branch ${named} (is it fetched?)` }
      : parseCommitted(text, 'working-branch', named)
  }
  const head = await readHeadFile(root, '.saasfoundry.json')
  return head === undefined
    ? { source: 'head', branch: 'HEAD', invalid: 'no commit holds .saasfoundry.json yet: commit it, so that a decision rests on what is committed' }
    : parseCommitted(head, 'head', 'HEAD')
}

/**
 * The routing a project declares, read once and validated: the shared overrides, the declared coding
 * agents and the adjustment policy. A manifest that cannot be read, or whose routing block is
 * invalid, fails closed: an automatic move must never be applied over a configuration nobody checked.
 * A committed block that is invalid or missing does not stop a route from being answered from the
 * worktree's own block, but no decision is taken (`decision.invalid`).
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
  const committed = harness ? await committedRouting(root) : undefined
  const decision: RoutingDecisionSource = committed
    ? {
        ...(committed.routing ? { routing: committed.routing } : {}),
        policy: resolveAdjustPolicy(committed.routing?.adjust),
        source: committed.source,
        branch: committed.branch,
        invalid: committed.invalid,
        differs: committed.invalid !== null || canonical(committed.routing ?? null) !== canonical(harness?.routing ?? null)
      }
    : { policy, source: 'shipped', branch: null, invalid: null, differs: false }
  return {
    ...(manifest ? { manifest } : {}),
    ...(harness?.routing ? { routing: harness.routing } : {}),
    // A harness without an agent declaration is the legacy Claude Code setup.
    agents: harness ? (harness.agents ?? ['claude-code']) : [],
    policy,
    decision
  }
}
