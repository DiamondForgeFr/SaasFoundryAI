import { Command } from 'commander'

import { readShellGuard, recordShellGuard, type ShellGuardRecord, type ShellGuardState } from '../harness/agent-support'
import { delegationCommitAdvice, readBranchProtection } from '../harness/branch-protection'
import { isShellShapeMode, SHELL_SHAPE_MODES } from '../harness/shell-guard-mode'
import { readManifest } from '../utils'
import { runAgentsSubcommand } from './agents.shared'

const ACTIONS = [...SHELL_SHAPE_MODES, 'status'] as const

interface ShellGuardOptions {
  json?: boolean
}

/** What a mode means, said the way the guard behaves: the developer reads it to choose. */
const MEANING: Record<ShellGuardState['shellShape'], string> = {
  refuse: 'A shell line that chains commands, substitutes the output of one into another, loops, writes a file through a heredoc or runs an inline script is refused, with the split to make instead.',
  warn: "Such a line is not refused: the host's own permission flow goes on, and the agent is told the split to make. A host that prompts for it still prompts.",
  off: 'The shape of a shell line is not checked. The guard still refuses an escape hatch, a nature label an agent puts on its own ticket and, for a delegated agent, a merge, a ready pull request and the delegation consent.'
}

export function describeShellGuard(state: ShellGuardState): string {
  const origin = state.source === 'manifest' ? 'recorded in .saasfoundry.json' : 'the default: nothing is recorded in .saasfoundry.json, and absence means refuse'
  return `Shell shape guard: ${state.shellShape} (${origin}). ${MEANING[state.shellShape]}`
}

/** What a repeated command tells the developer, and where to commit a change. */
async function describeRecord(record: ShellGuardRecord, targetPath: string): Promise<string> {
  if (!record.changed) return 'Already recorded; .saasfoundry.json is unchanged.'
  // A direct commit on a protected working branch would push past its required checks (#1124).
  const branch = (await readManifest(targetPath))?.workflow?.workingBranch
  const advice = delegationCommitAdvice(await readBranchProtection({ targetPath, branch }), branch)
  return `Recorded in .saasfoundry.json as the shared team default: ${advice} The guard hook reads it on every call: the next shell call already follows it.`
}

/**
 * `sf agents shell-guard <refuse|warn|off|status>` (#1251): read or record what the guard hook does with a shell line
 * that is not one plain command. The value lives in `modules.harness.guard.shellShape`; only this command writes it,
 * and absence means `refuse`, so a project never has to run it to be covered.
 */
export async function shellGuardCommand(action: string, options: ShellGuardOptions = {}): Promise<void> {
  await runAgentsSubcommand(options, async () => {
    if (!(ACTIONS as readonly string[]).includes(action)) throw new Error(`Choose what to do with the shell shape guard: sf agents shell-guard <${ACTIONS.join('|')}>.`)
    const targetPath = process.cwd()
    const record = isShellShapeMode(action) ? await recordShellGuard({ targetPath, shellShape: action }) : undefined
    const state: ShellGuardState = record ?? (await readShellGuard(targetPath))
    if (options.json) {
      process.stdout.write(JSON.stringify({ shellGuardVersion: 1, shellShape: state.shellShape, source: state.source, ...(record ? { changed: record.changed } : {}) }, null, 2) + '\n')
      return
    }
    process.stdout.write(describeShellGuard(state) + '\n')
    if (record) process.stdout.write((await describeRecord(record, targetPath)) + '\n')
  })
}

/** Register `sf agents shell-guard`. */
export function registerShellGuardCommand(agents: Command): void {
  agents
    .command('shell-guard')
    .description('Read or record what the guard hook does with a shell line that is not one plain command (a chain, a substitution, a loop, an inline script): refuse (default), warn or off')
    .argument('<action>', `${SHELL_SHAPE_MODES.join(', ')}; status prints the current mode`)
    .option('--json', 'Output the versioned state')
    .action((action: string, options: ShellGuardOptions) => shellGuardCommand(action, options))
}
