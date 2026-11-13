import { readFile, lstat } from 'fs/promises'
import { join } from 'path'

import { CODEX_HOOKS_PATH, executable, probeHookCli, readJson, registers, standingOf, type HookStanding } from './delegation-hooks'
import { hookNoteFunction, hookPathDirs, normalizeProbe, type HookCli, type HookCliProbeResult } from './hook-cli'
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
 *    says so (`guardState`, a `fail` since #1228);
 * 4. when the CLI it reached exits non-zero (an older release with no `agents guard`; a current one always exits 0),
 *    writes a line on stderr and an entry in the capture error log, stage `cli`, instead of exiting silently (#1228).
 */
const GUARD_SCRIPT = [
  'p=$(cat)',
  'case "$p" in *SF_WORKFLOW_BYPASS_*|*skip-local-ci*|*[Nn][Aa][Tt][Uu][Rr][Ee]*|*addLabels*|*delegation*|*ready*|*merge*) ;; *) exit 0;; esac',
  'd="${CLAUDE_PROJECT_DIR:-.}"',
  hookNoteFunction('agents guard', 'PreToolUse'),
  'run() { printf %s "$p" | "$@" agents guard --host @HOST@ 2>/dev/null || note "$*" $?; exit 0; }',
  '[ -x "$d/node_modules/.bin/saasfoundryai" ] && run "$d/node_modules/.bin/saasfoundryai"',
  '[ -f "$d/bin/sf.js" ] && grep -q \'"name": "saasfoundryai-cli"\' "$d/package.json" 2>/dev/null && [ -f "$d/dist/index.js" ] && run node "$d/bin/sf.js"',
  'command -v saasfoundryai >/dev/null 2>&1 && run saasfoundryai',
  'exit 0'
].join('; ')

/** The command a host hook runs to check a tool call. */
export const guardCommand = (host: GuardHost): string => GUARD_SCRIPT.replace(/@HOST@/g, host)

export const CLAUDE_GUARD_COMMAND = guardCommand('claude-code')
export const CODEX_GUARD_COMMAND = guardCommand('codex')

/**
 * The guard commands v1.2.0 shipped (#1228), as written then: they exited silently when the CLI they reached had no
 * `agents guard`. Literals on purpose, never built from `GUARD_SCRIPT` (a merge only adds a command whose exact
 * string is missing, so without these a project updated from v1.2.0 would run both guard hooks). The golden spec
 * pastes both from the v1.2.0 tag.
 */
export const V1_2_0_GUARD_COMMANDS: readonly string[] = [
  'p=$(cat); case "$p" in *SF_WORKFLOW_BYPASS_*|*skip-local-ci*|*[Nn][Aa][Tt][Uu][Rr][Ee]*|*addLabels*|*delegation*|*ready*|*merge*) ;; *) exit 0;; esac; d="${CLAUDE_PROJECT_DIR:-.}"; run() { printf %s "$p" | "$@" agents guard --host claude-code 2>/dev/null; exit 0; }; [ -x "$d/node_modules/.bin/saasfoundryai" ] && run "$d/node_modules/.bin/saasfoundryai"; [ -f "$d/bin/sf.js" ] && grep -q \'"name": "saasfoundryai-cli"\' "$d/package.json" 2>/dev/null && [ -f "$d/dist/index.js" ] && run node "$d/bin/sf.js"; command -v saasfoundryai >/dev/null 2>&1 && run saasfoundryai; exit 0',
  'p=$(cat); case "$p" in *SF_WORKFLOW_BYPASS_*|*skip-local-ci*|*[Nn][Aa][Tt][Uu][Rr][Ee]*|*addLabels*|*delegation*|*ready*|*merge*) ;; *) exit 0;; esac; d="${CLAUDE_PROJECT_DIR:-.}"; run() { printf %s "$p" | "$@" agents guard --host codex 2>/dev/null; exit 0; }; [ -x "$d/node_modules/.bin/saasfoundryai" ] && run "$d/node_modules/.bin/saasfoundryai"; [ -f "$d/bin/sf.js" ] && grep -q \'"name": "saasfoundryai-cli"\' "$d/package.json" 2>/dev/null && [ -f "$d/dist/index.js" ] && run node "$d/bin/sf.js"; command -v saasfoundryai >/dev/null 2>&1 && run saasfoundryai; exit 0'
]

/** A guard command an earlier release wrote and a refresh replaces. A hand-edited copy is the project's own and is left. */
export const isLegacyGuardCommand = (command: unknown): boolean => typeof command === 'string' && V1_2_0_GUARD_COMMANDS.includes(command)

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
 * kept, the command an earlier release wrote is replaced (#1228), a repeated render changes nothing. `added` is set
 * when the hook was not there, or was replaced: Codex runs a project hook only once it is trusted, and trust follows
 * the hook's text, so the developer has to review it (`CODEX_GUARD_TRUST_NOTICE`). A file that is not a hooks
 * object is reported, not rewritten.
 */
export function withCodexGuard(content: string): { content: string; added: boolean } | { error: string } {
  let config: unknown
  try {
    config = JSON.parse(content)
  } catch {
    return { error: `${CODEX_HOOKS_PATH} is not valid JSON` }
  }
  if (!object(config) || (config.hooks !== undefined && !object(config.hooks))) return { error: `${CODEX_HOOKS_PATH} is not a hooks object` }
  const legacy = registers(config, 'PreToolUse', isLegacyGuardCommand)
  if (!legacy && registers(config, 'PreToolUse', (command) => command === CODEX_GUARD_COMMAND)) return { content, added: false }
  const hooks = object(config.hooks) ? { ...config.hooks } : {}
  const groups = (Array.isArray(hooks.PreToolUse) ? (hooks.PreToolUse as HookGroup[]) : [])
    .map((group) => (Array.isArray(group?.hooks) ? { ...group, hooks: group.hooks.filter((hook) => !isLegacyGuardCommand(hook?.command)) } : group))
    .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length > 0)
  if (!groups.some((group) => group?.hooks?.some((hook) => hook?.command === CODEX_GUARD_COMMAND)))
    groups.push({ matcher: CODEX_GUARD_MATCHER, hooks: [{ type: 'command', command: CODEX_GUARD_COMMAND, timeout: GUARD_TIMEOUT_SECONDS }] })
  hooks.PreToolUse = groups
  return { content: `${JSON.stringify({ ...config, hooks }, null, 2)}\n`, added: true }
}

/** What a developer is told when Codex has to trust a new guard hook. */
export const CODEX_GUARD_TRUST_NOTICE = `${CODEX_HOOKS_PATH}: the PreToolUse guard hook was added or replaced. Codex skips a project hook until it is trusted: review and trust it with /hooks, or the guard does not run.`

/**
 * `enforced`: the hook is declared and the project's CLI can run it. `declared`: Codex runs it only once its
 * `.codex/` layer and the hook are trusted, which nothing here can see. `declared-not-runnable`: the hook is there
 * but no CLI with `agents guard` resolves, so every call passes unchecked. `declared-outdated-cli`: the CLI the hook
 * reaches has the command but is older than the version that last updated the project (#1228). `outdated`: the
 * hook an earlier release wrote (a refresh replaces it). `missing`: no hook. `not-enforced`: the host has no guard
 * hook at all.
 */
export type GuardState = 'enforced' | 'declared' | 'declared-not-runnable' | 'declared-outdated-cli' | 'outdated' | 'missing' | 'not-enforced'

export type GuardCli = HookCli

/**
 * The CLI the guard hook would run for a project: the same order as the hook's own line. The PATH entries a package
 * runner added for this process (`npx`, `npm run`) are skipped: the hook's shell does not have them (#1228).
 */
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
  for (const dir of hookPathDirs(pathEnv)) {
    const candidate = join(dir, 'saasfoundryai')
    if (await executable(candidate)) return { command: candidate, args: [] }
  }
  return undefined
}

/**
 * Whether the resolved CLI knows `agents guard` (an older release does not), which CLI it is and its version.
 * Injectable, so a spec needs no process; a bare boolean answers only the first question.
 */
export type GuardProbe = (root: string) => Promise<boolean | HookCliProbeResult>

export const defaultGuardProbe = async (root: string): Promise<HookCliProbeResult> => probeHookCli(root, await resolveGuardCli(root), ['agents', 'guard'])

/**
 * Whether the hook that checks a host's tool calls is declared and could run, and the CLI it reaches. Declared is
 * not the same as running (a host may not trust the file yet): this reads the file and asks the CLI the hook
 * resolves whether it has the command, it does not run the host. `requiredVersion` (the version that last updated
 * the project) turns an older CLI into `declared-outdated-cli`.
 */
export async function guardStanding(root: string, agent: HarnessAgent, probe: GuardProbe = defaultGuardProbe, requiredVersion?: string): Promise<HookStanding<GuardState>> {
  if (agent !== 'claude-code' && agent !== 'codex') return { state: 'not-enforced' }
  const config = agent === 'claude-code' ? await readJson(join(root, '.claude', 'settings.json')) : await readJson(join(root, CODEX_HOOKS_PATH))
  const own = agent === 'claude-code' ? CLAUDE_GUARD_COMMAND : CODEX_GUARD_COMMAND
  if (!registers(config, 'PreToolUse', (command) => command === own)) {
    if (!registers(config, 'PreToolUse', isLegacyGuardCommand)) return { state: 'missing' }
    return standingOf<GuardState>('outdated', normalizeProbe(await probe(root)), requiredVersion)
  }
  return standingOf<GuardState>(agent === 'codex' ? 'declared' : 'enforced', normalizeProbe(await probe(root)), requiredVersion)
}

/** The state alone (`guardStanding`). */
export async function guardState(root: string, agent: HarnessAgent, probe: GuardProbe = defaultGuardProbe, requiredVersion?: string): Promise<GuardState> {
  return (await guardStanding(root, agent, probe, requiredVersion)).state
}
