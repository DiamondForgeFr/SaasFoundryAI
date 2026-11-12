import { execFile } from 'child_process'
import { readFile, lstat } from 'fs/promises'
import { delimiter, join } from 'path'

import { CODEX_HOOKS_PATH, executable, readJson, registers } from './delegation-hooks'
import type { HarnessAgent } from './agent-registry'
import type { GuardHost } from './tool-call-guard'
import type { ClaudeHooksConfig } from '../utils/claude-settings'

/**
 * The `PreToolUse` hook that keeps an agent from getting past a guard on its own (#1106). A guard of the workflow
 * scripts refuses a transition, and the escape hatch it used to print was the agent's way round it: the hook refuses
 * the Bash calls that set a hatch, label a ticket `nature:internal`, or (for a delegated agent) merge, mark a pull
 * request ready or record the delegation consent. What it refuses is decided by `sf agents guard`
 * (`tool-call-guard.ts`); this module is the line the host runs, and how the state of that line is read.
 *
 * The command is a self-contained shell line like the capture hook's, for the same reasons (never a bare `sf`; a
 * hook that errors on every call is worse than none). It
 *
 * 1. reads the payload once and leaves at once, before Node starts, unless it mentions one of the words a refused
 *    call needs: almost no Bash call does, so almost none pays for a process. The filter is deliberately loose
 *    (`*merge*`, not `gh pr merge`) so that an extra space or a flag in between cannot slip past it;
 * 2. runs the CLI the **project** resolves: `node_modules/.bin/saasfoundryai`, then this repository's own `bin/sf.js`
 *    when the project is SaaSFoundryAI itself and `dist/` is built, then `saasfoundryai` on the PATH;
 * 3. exits 0 whatever happens and lets only the CLI's **stdout** reach the host, where a decision is one JSON object.
 *    With no CLI, or one that has no `agents guard`, the call goes through: the hook fails open, and `sf status`
 *    says so (`guardState`).
 */
const GUARD_SCRIPT = [
  'p=$(cat)',
  'case "$p" in *SF_WORKFLOW_BYPASS_*|*skip-local-ci*|*[Nn][Aa][Tt][Uu][Rr][Ee]*|*addLabels*|*delegation*|*ready*|*merge*) ;; *) exit 0;; esac',
  'd="${CLAUDE_PROJECT_DIR:-.}"',
  'run() { printf %s "$p" | "$@" agents guard --host @HOST@ 2>/dev/null; exit 0; }',
  '[ -x "$d/node_modules/.bin/saasfoundryai" ] && run "$d/node_modules/.bin/saasfoundryai"',
  '[ -f "$d/bin/sf.js" ] && grep -q \'"name": "saasfoundryai-cli"\' "$d/package.json" 2>/dev/null && [ -f "$d/dist/index.js" ] && run node "$d/bin/sf.js"',
  'command -v saasfoundryai >/dev/null 2>&1 && run saasfoundryai',
  'exit 0'
].join('; ')

/** The command a host hook runs to check a tool call. */
export const guardCommand = (host: GuardHost): string => GUARD_SCRIPT.replace('@HOST@', host)

export const CLAUDE_GUARD_COMMAND = guardCommand('claude-code')
export const CODEX_GUARD_COMMAND = guardCommand('codex')

/** The line only checks a command: a host that waits longer than this has a problem the guard cannot fix. */
const GUARD_TIMEOUT_SECONDS = 10

/** Claude Code runs `PreToolUse` for the Bash tool, and for PowerShell where Bash is not the shell. */
export const CLAUDE_GUARD_MATCHER = 'Bash|PowerShell'
/** Codex names its shell tools `Bash`. */
export const CODEX_GUARD_MATCHER = 'Bash'

export const CLAUDE_GUARD_HOOKS: ClaudeHooksConfig = {
  PreToolUse: [{ matcher: CLAUDE_GUARD_MATCHER, hooks: [{ type: 'command', command: CLAUDE_GUARD_COMMAND, timeout: GUARD_TIMEOUT_SECONDS }] }]
}

interface HookGroup {
  matcher?: string
  hooks?: { type?: string; command?: string; timeout?: number }[]
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * The Codex hooks file with the guard hook added to what the project already has there: other hooks and keys are
 * kept, a repeated render changes nothing. `added` is set when the hook was not there: Codex runs a project hook
 * only once it is trusted, so the developer has to review it (`CODEX_GUARD_TRUST_NOTICE`). A file that is not a
 * hooks object is reported, not rewritten.
 */
export function withCodexGuard(content: string): { content: string; added: boolean } | { error: string } {
  let config: unknown
  try {
    config = JSON.parse(content)
  } catch {
    return { error: `${CODEX_HOOKS_PATH} is not valid JSON` }
  }
  if (!object(config) || (config.hooks !== undefined && !object(config.hooks))) return { error: `${CODEX_HOOKS_PATH} is not a hooks object` }
  if (registers(config, 'PreToolUse', (command) => command === CODEX_GUARD_COMMAND)) return { content, added: false }
  const hooks = object(config.hooks) ? { ...config.hooks } : {}
  const groups = Array.isArray(hooks.PreToolUse) ? [...(hooks.PreToolUse as HookGroup[])] : []
  groups.push({ matcher: CODEX_GUARD_MATCHER, hooks: [{ type: 'command', command: CODEX_GUARD_COMMAND, timeout: GUARD_TIMEOUT_SECONDS }] })
  hooks.PreToolUse = groups
  return { content: `${JSON.stringify({ ...config, hooks }, null, 2)}\n`, added: true }
}

/** What a developer is told when Codex has to trust a new guard hook. */
export const CODEX_GUARD_TRUST_NOTICE = `${CODEX_HOOKS_PATH}: the PreToolUse guard hook was added. Codex skips a project hook until it is trusted: review and trust it with /hooks, or the guard does not run.`

/**
 * `enforced`: the hook is declared and the project's CLI can run it. `declared`: Codex runs it only once its
 * `.codex/` layer and the hook are trusted, which nothing here can see. `declared-not-runnable`: the hook is there
 * but no CLI with `agents guard` resolves, so every call passes unchecked. `missing`: no hook. `not-enforced`: the
 * host has no guard hook at all.
 */
export type GuardState = 'enforced' | 'declared' | 'declared-not-runnable' | 'missing' | 'not-enforced'

export interface GuardCli {
  command: string
  args: string[]
}

/** The CLI the guard hook would run for a project: the same order as the hook's own line. */
export async function resolveGuardCli(root: string, pathEnv: string | undefined = process.env.PATH): Promise<GuardCli | undefined> {
  const installed = join(root, 'node_modules', '.bin', 'saasfoundryai')
  if (await executable(installed)) return { command: installed, args: [] }
  try {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { name?: unknown }
    if (manifest.name === 'saasfoundryai-cli' && (await lstat(join(root, 'bin', 'sf.js'))).isFile() && (await lstat(join(root, 'dist', 'index.js'))).isFile()) {
      return { command: process.execPath, args: [join(root, 'bin', 'sf.js')] }
    }
  } catch {
    // Not this repository, or not built.
  }
  for (const dir of (pathEnv ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(dir, 'saasfoundryai')
    if (await executable(candidate)) return { command: candidate, args: [] }
  }
  return undefined
}

/** Whether the resolved CLI knows `agents guard` (an older release does not). Injectable, so a spec needs no process. */
export type GuardProbe = (root: string) => Promise<boolean>

export const defaultGuardProbe: GuardProbe = async (root) => {
  const cli = await resolveGuardCli(root)
  if (!cli) return false
  return new Promise<boolean>((resolve) => {
    const child = execFile(cli.command, [...cli.args, 'agents', 'guard', '--help'], { cwd: root, timeout: 8000, encoding: 'utf8' }, (error, stdout) => resolve(!error && /--host/.test(stdout)))
    // A command that reads its input must not wait for ours.
    child.stdin?.end()
  })
}

/**
 * Whether the hook that checks a host's tool calls is declared and could run. Declared is not the same as running (a
 * host may not trust the file yet): this reads the file and asks the project's CLI whether it has the command, it
 * does not run the host.
 */
export async function guardState(root: string, agent: HarnessAgent, probe: GuardProbe = defaultGuardProbe): Promise<GuardState> {
  if (agent !== 'claude-code' && agent !== 'codex') return 'not-enforced'
  const config = agent === 'claude-code' ? await readJson(join(root, '.claude', 'settings.json')) : await readJson(join(root, CODEX_HOOKS_PATH))
  const own = agent === 'claude-code' ? CLAUDE_GUARD_COMMAND : CODEX_GUARD_COMMAND
  if (!registers(config, 'PreToolUse', (command) => command === own)) return 'missing'
  if (!(await probe(root))) return 'declared-not-runnable'
  return agent === 'codex' ? 'declared' : 'enforced'
}
