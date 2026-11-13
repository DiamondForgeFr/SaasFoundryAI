import { execFile } from 'child_process'
import { constants } from 'fs'
import { access, lstat, readFile } from 'fs/promises'
import { join } from 'path'

import type { HarnessAgent } from './agent-registry'
import { hookCliLabel, hookNoteFunction, hookPathDirs, normalizeProbe, olderThan, readHookCliVersion, type HookCli, type HookCliProbeResult } from './hook-cli'
import type { ClaudeHooksConfig } from '../utils/claude-settings'

/**
 * The hooks that feed the delegation ledger (#1035). One command serves every event of a host: it reads
 * the event name from the payload and ignores what is not a routed delegation, so the hook declaration
 * stays short and a future event needs no new command.
 *
 * The command is a self-contained shell line, not a bare `sf`: `sf` may be another CLI on the machine (the
 * Salesforce one) or an older SaaSFoundry that has no `outcome` command, and a hook that errors on every
 * subagent stop is worse than no hook. It
 *
 * 1. reads the payload once and leaves at once (before Node starts) unless it mentions a routed `sf-<tier>` agent;
 * 2. runs the CLI the **project** resolves: `node_modules/.bin/saasfoundryai`, then `.../sf`, then this
 *    repository's own `bin/sf.js` when the project is SaaSFoundry itself, then `saasfoundryai` on the PATH
 *    (never a bare `sf`);
 * 3. exits 0 whatever happens, and lets only the CLI's **stdout** reach the host (#1105): a stop of a delegate
 *    that left out its `SF-DELEGATION` line is answered with one JSON object (`{"decision":"block",...}`) that
 *    keeps the agent running. Anything else the capture has to say goes to the capture error log, which
 *    `sf status` reports, so stderr is discarded: a hook must never break the agent it observes;
 * 4. when the CLI it reached exits non-zero (an older release with no `agents outcome capture`; a current one
 *    always exits 0), writes that to the capture error log itself, stage `cli`, instead of exiting silently (#1228).
 */
export type CaptureHost = 'claude-code' | 'codex'

const CAPTURE_SCRIPT = [
  'p=$(cat)',
  'case "$p" in *sf-*) ;; *) exit 0;; esac',
  'd="${CLAUDE_PROJECT_DIR:-.}"',
  hookNoteFunction('agents outcome capture', 'capture'),
  'run() { printf %s "$p" | "$@" agents outcome capture --host @HOST@ 2>/dev/null || note "$*" $?; exit 0; }',
  'for c in "$d/node_modules/.bin/saasfoundryai" "$d/node_modules/.bin/sf"; do [ -x "$c" ] && run "$c"; done',
  '[ -f "$d/bin/sf.js" ] && grep -q \'"name": "saasfoundryai-cli"\' "$d/package.json" 2>/dev/null && run node "$d/bin/sf.js"',
  'command -v saasfoundryai >/dev/null 2>&1 && run saasfoundryai',
  'exit 0'
].join('; ')

/** The command a host hook runs to capture a delegation. */
export const captureCommand = (host: CaptureHost): string => CAPTURE_SCRIPT.replace(/@HOST@/g, host)

export const CLAUDE_CAPTURE_COMMAND = captureCommand('claude-code')
export const CODEX_CAPTURE_COMMAND = captureCommand('codex')

/** The commands the first build wrote: a bare `sf`. A refresh replaces them. */
const LEGACY_CAPTURE_COMMAND = /^sf agents outcome capture --host (?:claude-code|codex)$/

/**
 * The capture commands v1.1.0 shipped, as written then (#1105). They are literals on purpose, never built from
 * `CAPTURE_SCRIPT`: that one changes (the v1.1.0 line discarded the CLI's stdout, so it could not carry a decision
 * to the host), and a string rebuilt from it would stop matching what installed projects hold. A merge only
 * adds a command whose exact string is missing, so without these a project updated from v1.1.0 would run two
 * capture hooks, and the old, silent one would stay. The golden spec pastes both from the v1.1.0 tag.
 */
export const V1_1_0_CAPTURE_COMMANDS: readonly string[] = [
  'p=$(cat); case "$p" in *sf-*) ;; *) exit 0;; esac; d="${CLAUDE_PROJECT_DIR:-.}"; run() { printf %s "$p" | "$@" agents outcome capture --host claude-code >/dev/null 2>&1; exit 0; }; for c in "$d/node_modules/.bin/saasfoundryai" "$d/node_modules/.bin/sf"; do [ -x "$c" ] && run "$c"; done; [ -f "$d/bin/sf.js" ] && grep -q \'"name": "saasfoundryai-cli"\' "$d/package.json" 2>/dev/null && run node "$d/bin/sf.js"; command -v saasfoundryai >/dev/null 2>&1 && run saasfoundryai; exit 0',
  'p=$(cat); case "$p" in *sf-*) ;; *) exit 0;; esac; d="${CLAUDE_PROJECT_DIR:-.}"; run() { printf %s "$p" | "$@" agents outcome capture --host codex >/dev/null 2>&1; exit 0; }; for c in "$d/node_modules/.bin/saasfoundryai" "$d/node_modules/.bin/sf"; do [ -x "$c" ] && run "$c"; done; [ -f "$d/bin/sf.js" ] && grep -q \'"name": "saasfoundryai-cli"\' "$d/package.json" 2>/dev/null && run node "$d/bin/sf.js"; command -v saasfoundryai >/dev/null 2>&1 && run saasfoundryai; exit 0'
]

/**
 * The capture commands v1.2.0 shipped (#1228), literals for the same reason as v1.1.0's: they exited silently when
 * the CLI they reached had no `agents outcome capture`. The golden spec pastes both from the v1.2.0 tag.
 */
export const V1_2_0_CAPTURE_COMMANDS: readonly string[] = [
  'p=$(cat); case "$p" in *sf-*) ;; *) exit 0;; esac; d="${CLAUDE_PROJECT_DIR:-.}"; run() { printf %s "$p" | "$@" agents outcome capture --host claude-code 2>/dev/null; exit 0; }; for c in "$d/node_modules/.bin/saasfoundryai" "$d/node_modules/.bin/sf"; do [ -x "$c" ] && run "$c"; done; [ -f "$d/bin/sf.js" ] && grep -q \'"name": "saasfoundryai-cli"\' "$d/package.json" 2>/dev/null && run node "$d/bin/sf.js"; command -v saasfoundryai >/dev/null 2>&1 && run saasfoundryai; exit 0',
  'p=$(cat); case "$p" in *sf-*) ;; *) exit 0;; esac; d="${CLAUDE_PROJECT_DIR:-.}"; run() { printf %s "$p" | "$@" agents outcome capture --host codex 2>/dev/null; exit 0; }; for c in "$d/node_modules/.bin/saasfoundryai" "$d/node_modules/.bin/sf"; do [ -x "$c" ] && run "$c"; done; [ -f "$d/bin/sf.js" ] && grep -q \'"name": "saasfoundryai-cli"\' "$d/package.json" 2>/dev/null && run node "$d/bin/sf.js"; command -v saasfoundryai >/dev/null 2>&1 && run saasfoundryai; exit 0'
]

/**
 * A capture command an earlier release wrote and a refresh replaces: the first build's bare `sf`, the v1.1.0
 * shell line (#1105) and the v1.2.0 one (#1228). A hand-edited copy of any is the project's own and is left.
 */
export const isLegacyCaptureCommand = (command: unknown): boolean =>
  typeof command === 'string' && (LEGACY_CAPTURE_COMMAND.test(command) || V1_1_0_CAPTURE_COMMANDS.includes(command) || V1_2_0_CAPTURE_COMMANDS.includes(command))

const HOOK_TIMEOUT_SECONDS = 30
/** The routed tier agents are all named `sf-<tier>`: the host runs the hook only for them. */
export const CLAUDE_SUBAGENT_MATCHER = 'sf-.*'

/**
 * Claude Code: `SubagentStop` is the primary event (transcript, last message); `PostToolUse` on the
 * delegation tool adds the duration and resolved model of a synchronous run. The tool is `Agent` today
 * and was `Task`: the matcher takes both.
 */
export const CLAUDE_CAPTURE_HOOKS: ClaudeHooksConfig = {
  SubagentStop: [{ matcher: CLAUDE_SUBAGENT_MATCHER, hooks: [{ type: 'command', command: CLAUDE_CAPTURE_COMMAND, timeout: HOOK_TIMEOUT_SECONDS }] }],
  PostToolUse: [{ matcher: 'Agent|Task', hooks: [{ type: 'command', command: CLAUDE_CAPTURE_COMMAND, timeout: HOOK_TIMEOUT_SECONDS }] }]
}

/** Codex: project hooks load from this file next to the tracked `.codex/agents/`, once the `.codex/` layer is trusted. */
export const CODEX_HOOKS_PATH = '.codex/hooks.json'

interface HookGroup {
  matcher?: string
  hooks?: { type?: string; command?: string; timeout?: number }[]
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

function groupsOf(config: unknown, event: string): HookGroup[] {
  const hooks = object(config) && object(config.hooks) ? config.hooks : undefined
  return hooks && Array.isArray(hooks[event]) ? (hooks[event] as HookGroup[]) : []
}

export function registers(config: unknown, event: string, accepts: (command: unknown) => boolean): boolean {
  return groupsOf(config, event).some((group) => Array.isArray(group?.hooks) && group.hooks.some((hook) => accepts(hook?.command)))
}

/**
 * The Codex hooks file with the capture hook added to what the project already has there: other hooks
 * and keys are kept, the commands an earlier release wrote (the first build's bare `sf`, the v1.1.0 shell
 * line) are replaced, a repeated render changes nothing. An existing file that is not JSON is left alone.
 * `replaced` is set when a command an earlier release wrote was taken out: Codex runs a project hook only
 * once it is trusted, and trust follows the hook's text, so the developer has to review the new one.
 */
export function renderCodexHooks(existing?: string): { content: string; replaced?: true } | { error: string } {
  let config: Record<string, unknown> = {}
  if (existing !== undefined && existing.trim()) {
    try {
      const parsed: unknown = JSON.parse(existing)
      if (!object(parsed) || (parsed.hooks !== undefined && !object(parsed.hooks))) return { error: `${CODEX_HOOKS_PATH} is not a hooks object` }
      config = parsed
    } catch {
      return { error: `${CODEX_HOOKS_PATH} is not valid JSON` }
    }
  }
  const legacy = registers(config, 'SubagentStop', isLegacyCaptureCommand)
  if (!legacy && registers(config, 'SubagentStop', (command) => command === CODEX_CAPTURE_COMMAND)) return { content: existing ?? '' }
  const hooks = object(config.hooks) ? { ...config.hooks } : {}
  const groups = (Array.isArray(hooks.SubagentStop) ? (hooks.SubagentStop as HookGroup[]) : [])
    .map((group) => (Array.isArray(group?.hooks) ? { ...group, hooks: group.hooks.filter((hook) => !isLegacyCaptureCommand(hook?.command)) } : group))
    .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length > 0)
  if (!groups.some((group) => group?.hooks?.some((hook) => hook?.command === CODEX_CAPTURE_COMMAND)))
    groups.push({ hooks: [{ type: 'command', command: CODEX_CAPTURE_COMMAND, timeout: HOOK_TIMEOUT_SECONDS }] })
  hooks.SubagentStop = groups
  return { content: `${JSON.stringify({ ...config, hooks }, null, 2)}\n`, ...(legacy ? { replaced: true as const } : {}) }
}

/** What a developer is told when Codex has to trust a changed capture hook again. */
export const CODEX_RETRUST_NOTICE = `${CODEX_HOOKS_PATH}: the delegation capture hook was replaced. Codex skips a changed project hook until it is trusted: review and trust it with /hooks, or delegations stay unrecorded.`

/**
 * `enforced`: the hook is declared and the project's CLI can run it. `declared`: Codex runs it only once its
 * `.codex/` layer is trusted, which nothing here can see. `declared-not-runnable`: the hook is there but no
 * CLI with `agents outcome capture` resolves, so every delegation passes unrecorded. `declared-outdated-cli`: the CLI
 * the hook reaches has the command but is older than the version that last updated the project (#1228).
 * `outdated`: a hook an earlier release wrote (a refresh replaces it). `missing`: no hook. `not-enforced`: the host
 * has no capture hook at all.
 */
export type CaptureState = 'enforced' | 'declared' | 'declared-not-runnable' | 'declared-outdated-cli' | 'outdated' | 'missing' | 'not-enforced'

/**
 * A hook's state, with the CLI it reaches when one resolves (#1228): `sf status` and `sf update` name it, since the
 * CLI a hook runs is not always the one that reports on it.
 */
export interface HookStanding<S extends string> {
  state: S
  /** The CLI the hook reaches: a path, or the `bin/sf.js` this repository runs with node. */
  cli?: string
  /** Its version, when it is the `saasfoundryai-cli` package. */
  cliVersion?: string
}

/**
 * What a hook that is in place amounts to, given what the probe found: a CLI without the command lets everything
 * through, one older than `requiredVersion` runs an older guard or capture. `ok` is the state when neither applies.
 */
export function standingOf<S extends string>(ok: S, probed: HookCliProbeResult, requiredVersion?: string): HookStanding<S | 'declared-not-runnable' | 'declared-outdated-cli'> {
  const cli = { ...(probed.cli ? { cli: probed.cli } : {}), ...(probed.version ? { cliVersion: probed.version } : {}) }
  if (!probed.runnable) return { state: 'declared-not-runnable', ...cli }
  if (probed.version && requiredVersion && olderThan(probed.version, requiredVersion)) return { state: 'declared-outdated-cli', ...cli }
  return { state: ok, ...cli }
}

export async function readJson(path: string): Promise<unknown> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) return undefined
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
}

export async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return (await lstat(path)).isFile() || true
  } catch {
    return false
  }
}

export type CaptureCli = HookCli

/**
 * The CLI the capture hook would run for a project: the same order as the hook's own line. The PATH entries a
 * package runner added for this process (`npx`, `npm run`) are skipped: the hook's shell does not have them (#1228).
 */
export async function resolveCaptureCli(root: string, pathEnv: string | undefined = process.env.PATH): Promise<CaptureCli | undefined> {
  for (const name of ['saasfoundryai', 'sf']) {
    const candidate = join(root, 'node_modules', '.bin', name)
    if (await executable(candidate)) return { command: candidate, args: [] }
  }
  try {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { name?: unknown }
    if (manifest.name === 'saasfoundryai-cli' && (await lstat(join(root, 'bin', 'sf.js'))).isFile()) return { command: process.execPath, args: [join(root, 'bin', 'sf.js')] }
  } catch {
    // Not this repository.
  }
  for (const dir of hookPathDirs(pathEnv)) {
    const candidate = join(dir, 'saasfoundryai')
    if (await executable(candidate)) return { command: candidate, args: [] }
  }
  return undefined
}

/**
 * Whether a resolved CLI answers `<command…> --help` with its `--host` option, the CLI it is and its version. An
 * older release has no such command and fails.
 */
export async function probeHookCli(root: string, cli: HookCli | undefined, command: string[]): Promise<HookCliProbeResult> {
  if (!cli) return { runnable: false }
  const version = await readHookCliVersion(cli)
  const known = { cli: hookCliLabel(cli), ...(version ? { version } : {}) }
  return new Promise<HookCliProbeResult>((resolve) => {
    const child = execFile(cli.command, [...cli.args, ...command, '--help'], { cwd: root, timeout: 8000, encoding: 'utf8' }, (error, stdout) =>
      resolve({ runnable: !error && /--host/.test(stdout), ...known })
    )
    // A command that reads its input must not wait for ours.
    child.stdin?.end()
  })
}

/**
 * Whether the resolved CLI knows `agents outcome capture` (an older release does not), which CLI it is and its
 * version. Injectable, so a spec needs no process; a bare boolean answers only the first question.
 */
export type CaptureProbe = (root: string) => Promise<boolean | HookCliProbeResult>

export const defaultCaptureProbe = async (root: string): Promise<HookCliProbeResult> => probeHookCli(root, await resolveCaptureCli(root), ['agents', 'outcome', 'capture'])

/**
 * Whether the hooks that capture a host's delegations are declared and could run, and the CLI they reach. Declared
 * is not the same as running (a host may not trust the file yet): this reads the file and asks the CLI the hook
 * resolves whether it has the command, it does not run the host. `requiredVersion` (the version that last updated
 * the project) turns an older CLI into `declared-outdated-cli`. An outdated hook still runs that CLI: a CLI that
 * cannot is said first.
 */
export async function captureStanding(root: string, agent: HarnessAgent, probe: CaptureProbe = defaultCaptureProbe, requiredVersion?: string): Promise<HookStanding<CaptureState>> {
  if (agent !== 'claude-code' && agent !== 'codex') return { state: 'not-enforced' }
  const config = agent === 'claude-code' ? await readJson(join(root, '.claude', 'settings.json')) : await readJson(join(root, CODEX_HOOKS_PATH))
  const own = agent === 'claude-code' ? CLAUDE_CAPTURE_COMMAND : CODEX_CAPTURE_COMMAND
  if (!registers(config, 'SubagentStop', (command) => command === own)) {
    if (!registers(config, 'SubagentStop', isLegacyCaptureCommand)) return { state: 'missing' }
    return standingOf<CaptureState>('outdated', normalizeProbe(await probe(root)), requiredVersion)
  }
  return standingOf<CaptureState>(agent === 'codex' ? 'declared' : 'enforced', normalizeProbe(await probe(root)), requiredVersion)
}

/** The state alone (`captureStanding`). */
export async function captureState(root: string, agent: HarnessAgent, probe: CaptureProbe = defaultCaptureProbe, requiredVersion?: string): Promise<CaptureState> {
  return (await captureStanding(root, agent, probe, requiredVersion)).state
}
