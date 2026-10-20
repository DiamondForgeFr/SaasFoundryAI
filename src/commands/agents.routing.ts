import { Command } from 'commander'

import { runAgentsSubcommand } from './agents.shared'
import { promoteLocalRouting } from '../harness/agent-support'
import { runAdjustment, type AdjustmentReport } from '../harness/routing-runtime'

export interface RoutingAdjustOptions {
  dryRun?: boolean
  verbose?: boolean
  json?: boolean
}

export interface RoutingPromoteOptions {
  provider?: string
  json?: boolean
}

/** The versioned JSON of an adjustment: what moved, and what was held back and why. */
export function adjustmentPayload(report: AdjustmentReport): Record<string, unknown> {
  return {
    adjustVersion: 1,
    dryRun: report.dryRun,
    applied: report.decisions.filter((decision) => decision.action !== 'hold'),
    held: report.decisions.filter((decision) => decision.action === 'hold'),
    staleTierAgents: report.staleTierAgents
  }
}

const money = (amount: string | null): string => (amount === null ? 'unknown' : `$${amount}`)

/** Print the moves of an adjustment, one line each with the figure that justified it. */
export function describeAdjustment(report: AdjustmentReport, verbose = false): string[] {
  const lines: string[] = []
  for (const decision of report.decisions) {
    const evidence = decision.evidence
    if (decision.action === 'hold') {
      if (verbose) lines.push(`Held ${decision.kind} (${decision.provider}) on ${decision.from}: ${decision.reason}.`)
      continue
    }
    const cost = evidence ? ` Expected feature cost ${money(evidence.expectedFeatureCost.from)} on ${decision.from}, ${money(evidence.expectedFeatureCost.to)} on ${decision.to}.` : ''
    lines.push(`${decision.action === 'escalate' ? 'Escalated' : 'De-escalated'} ${decision.kind} (${decision.provider}): ${decision.from} → ${decision.to}. ${decision.reason}.${cost}`)
  }
  return lines
}

/**
 * `sf agents routing adjust`: apply the automatic adjustment to the local layer. The capture hooks run it
 * after each recorded delegation; running it by hand is for a dry run and for a host without hooks.
 */
export async function routingAdjust(options: RoutingAdjustOptions): Promise<void> {
  await runAgentsSubcommand(options, async () => {
    const report = await runAdjustment(process.cwd(), { dryRun: options.dryRun === true })
    if (options.json) {
      process.stdout.write(JSON.stringify(adjustmentPayload(report), null, 2) + '\n')
      return
    }
    const lines = describeAdjustment(report, options.verbose === true)
    if (!lines.length) lines.push(report.decisions.length ? 'No routing change: no kind met a threshold.' : 'No routing change: no delegation with a task kind is recorded yet.')
    process.stdout.write(`${options.dryRun ? '[dry run] ' : ''}${lines.join('\n')}\n`)
    if (report.moved && !options.dryRun) {
      process.stdout.write('The move applies to every worktree of this clone at once and is not committed. Share it with sf agents routing promote; undo it with sf agents routing reset <kind>.\n')
    }
    if (report.staleTierAgents.length)
      process.stdout.write(
        `The tier agents are rendered from the shared routing, so ${report.staleTierAgents.length} of them differ from the effective routing until a move is promoted and the agents are refreshed. sf agents route is authoritative.\n`
      )
  })
}

/** `sf agents routing promote [<kind>]`: copy an automatic move into the shared manifest, as a change to review. */
export async function routingPromote(kind: string | undefined, options: RoutingPromoteOptions): Promise<void> {
  await runAgentsSubcommand(options, async () => {
    const result = await promoteLocalRouting({ targetPath: process.cwd(), kind, provider: options.provider })
    if (options.json) {
      process.stdout.write(JSON.stringify({ promoteVersion: 1, ...result }, null, 2) + '\n')
      return
    }
    for (const entry of result.promoted) {
      const dropped = entry.dropped.length ? ` The move of ${entry.dropped.join(', ')} for this kind was dropped: the shared override decides for every provider.` : ''
      process.stdout.write(`Promoted ${entry.kind} → ${entry.tier} (${entry.providers.join(', ')}) into modules.harness.routing.${dropped}\n`)
    }
    for (const entry of result.skipped) process.stdout.write(`Skipped ${entry.kind}: ${entry.reason}.\n`)
    if (result.manifestChanged) process.stdout.write('Review the change to .saasfoundry.json, run sf agents refresh --scope shared to regenerate the tier agents, and commit both.\n')
    else if (!result.promoted.length) process.stdout.write('Nothing was promoted.\n')
  })
}

/** Register `sf agents routing adjust|promote` (and, from the report slice, `report|reset`). */
export function registerRoutingCommands(agents: Command): Command {
  const routing = agents.command('routing').description('Adjust the routing from the measured outcomes of the delegations: bounded, visible, reversible')
  routing
    .command('adjust')
    .description('Apply the automatic adjustment to the local routing layer of this clone (run by the capture hooks after each recorded delegation)')
    .option('--dry-run', 'Decide without writing the local layer')
    .option('--verbose', 'Also say why a kind was held')
    .option('--json', 'Output the versioned decisions')
    .action((options: RoutingAdjustOptions) => routingAdjust(options))
  routing
    .command('promote')
    .description('Copy an automatic move into modules.harness.routing, where the team reviews it; the local entry is dropped')
    .argument('[kind]', 'A task kind; omitted: every automatic move')
    .option('--provider <agent>', 'Promote the move of one coding agent when the agents moved the kind differently')
    .option('--json', 'Output the versioned result')
    .action((kind: string | undefined, options: RoutingPromoteOptions) => routingPromote(kind, options))
  return routing
}
