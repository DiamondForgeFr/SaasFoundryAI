#!/usr/bin/env node

// `sf agents guard --host <host>` is the command the PreToolUse hook of Claude Code and Codex runs on every shell call
// whose payload might need a check (#1251). It takes a dedicated entry that loads only the guard: loading the whole CLI
// (commander, every command, `module-alias`, the stale-skill check) costs about a second per call, the guard alone
// costs a Node start. Any other form (`--help`, a missing or unknown host) is the full CLI.
const argv = process.argv
const guard = argv.length === 6 && argv[2] === 'agents' && argv[3] === 'guard' && argv[4] === '--host' && (argv[5] === 'claude-code' || argv[5] === 'codex') ? loadGuard() : undefined

function loadGuard() {
  try {
    return require('../dist/commands/agents.guard-main.js')
  } catch (error) {
    // A build that predates the dedicated entry: the full CLI has the command too.
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('agents.guard-main')) return undefined
    throw error
  }
}

if (guard) {
  void guard.agentsGuard({ host: argv[5] })
} else {
  require('../dist/index.js')
}
