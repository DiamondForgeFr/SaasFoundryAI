import { Command } from 'commander'

import { agentsGuard, GUARD_HOSTS, type AgentsGuardOptions } from './agents.guard-main'

// The body of the command lives in `agents.guard-main.ts`, which loads no commander and no other command: `bin/sf.js`
// runs it directly when the PreToolUse hook calls `agents guard --host <host>` (#1251). This module only registers it.
export { agentsGuard, GUARD_HOSTS, type AgentsGuardOptions }

/** Register `sf agents guard`. */
export function registerGuardCommand(agents: Command): void {
  agents
    .command('guard')
    .description(
      'Refuse the tool calls an agent must not make on its own (a bypass variable, a nature label, a shell line that is not one plain command, and, for a delegated agent, a merge); hook payload on stdin, run by the PreToolUse hook, never fails the host'
    )
    .requiredOption('--host <agent>', GUARD_HOSTS.join(' or '))
    .action((options: AgentsGuardOptions) => agentsGuard(options))
}
