import { readFile } from 'fs/promises'
import { join } from 'path'

import { resolveAdjustPolicy, type AdjustPolicy } from './routing-adjust-config'
import { routingOverrideIssues, type RoutingOverrides } from './routing-grid'
import type { HarnessAgent, SaaSFoundryManifest } from '../types'

export interface ProjectRouting {
  /** Undefined outside a SaaSFoundry project: the shipped grid and the shipped policy apply. */
  manifest?: SaaSFoundryManifest
  /** The shared overrides the developer (or a promotion) wrote in the manifest. */
  routing?: RoutingOverrides
  agents: HarnessAgent[]
  policy: AdjustPolicy
}

/**
 * The routing a project declares, read once and validated: the shared overrides, the declared coding
 * agents and the adjustment policy. A manifest that cannot be read, or whose routing block is
 * invalid, fails closed: an automatic move must never be applied over a configuration nobody checked.
 */
export async function readProjectRouting(root: string): Promise<ProjectRouting> {
  let manifest: SaaSFoundryManifest | undefined
  try {
    manifest = JSON.parse(await readFile(join(root, '.saasfoundry.json'), 'utf8')) as SaaSFoundryManifest
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`.saasfoundry.json cannot be read: ${error instanceof Error ? error.message : String(error)}`)
  }
  const harness = manifest?.modules?.harness
  const issues = routingOverrideIssues(harness?.routing)
  if (issues.length) throw new Error(`Invalid modules.harness.routing:\n- ${issues.join('\n- ')}`)
  return {
    ...(manifest ? { manifest } : {}),
    ...(harness?.routing ? { routing: harness.routing } : {}),
    // A harness without an agent declaration is the legacy Claude Code setup.
    agents: harness ? (harness.agents ?? ['claude-code']) : [],
    policy: resolveAdjustPolicy(harness?.routing?.adjust)
  }
}
