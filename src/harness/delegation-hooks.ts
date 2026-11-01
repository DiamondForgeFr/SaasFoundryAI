import { execFile } from 'child_process'
import { constants } from 'fs'
import { access, lstat, readFile } from 'fs/promises'
import { delimiter, join } from 'path'

import type { HarnessAgent } from './agent-registry'
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
 * 3. exits 0 whatever happens, silently: a hook must never break the agent it observes.
 */
export type CaptureHost = 'claude-code' | 'codex'

const CAPTURE_SCRIPT = [
  'p=$(cat)',
  'case "$p" in *sf-*) ;; *) exit 0;; esac',
  'd="${CLAUDE_PROJECT_DIR:-.}"',
  'run() { printf %s "$p" | "$@" agents outcome capture --host @HOST@ >/dev/null 2>&1; exit 0; }',
  'for c in "$d/node_modules/.bin/saasfoundryai" "$d/node_modules/.bin/sf"; do [ -x "$c" ] && run "$c"; done',
  '[ -f "$d/bin/sf.js" ] && grep -q \'"name": "saasfoundryai-cli"\' "$d/package.json" 2>/dev/null && run node "$d/bin/sf.js"',
  'command -v saasfoundryai >/dev/null 2>&1 && run saasfoundryai',
  'exit 0'
].join('; ')

/** The command a host hook runs to capture a delegation. */
export const captureCommand = (host: CaptureHost): string => CAPTURE_SCRIPT.replace('@HOST@', host)

export const CLAUDE_CAPTURE_COMMAND = captureCommand('claude-code')
export const CODEX_CAPTURE_COMMAND = captureCommand('codex')

/** The commands the first release wrote: a bare `sf`. A refresh replaces them. */
const LEGACY_CAPTURE_COMMAND = /^sf agents outcome capture --host (?:claude-code|codex)$/
export const isLegacyCaptureCommand = (command: unknown): boolean => typeof command === 'string' && LEGACY_CAPTURE_COMMAND.test(command)

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

function registers(config: unknown, event: string, accepts: (command: unknown) => boolean): boolean {
  return groupsOf(config, event).some((group) => Array.isArray(group?.hooks) && group.hooks.some((hook) => accepts(hook?.command)))
}

/**
 * The Codex hooks file with the capture hook added to what the project already has there: other hooks
 * and keys are kept, the first release's bare-`sf` command is replaced, a repeated render changes nothing.
 * An existing file that is not JSON is left alone.
 */
export function renderCodexHooks(existing?: string): { content: string } | { error: string } {
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
  return { content: `${JSON.stringify({ ...config, hooks }, null, 2)}\n` }
}

/**
 * `enforced`: the hook is declared and the project's CLI can run it. `declared`: Codex runs it only once its
 * `.codex/` layer is trusted, which nothing here can see. `declared-not-runnable`: the hook is there but no
 * CLI with `agents outcome capture` resolves, so every delegation passes unrecorded. `outdated`: the first
 * release's bare-`sf` hook. `missing`: no hook. `not-enforced`: the host has no capture hook at all.
 */
export type CaptureState = 'enforced' | 'declared' | 'declared-not-runnable' | 'outdated' | 'missing' | 'not-enforced'

async function readJson(path: string): Promise<unknown> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) return undefined
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return (await lstat(path)).isFile() || true
  } catch {
    return false
  }
}

export interface CaptureCli {
  command: string
  args: string[]
}

/** The CLI the capture hook would run for a project: the same order as the hook's own line. */
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
  for (const dir of (pathEnv ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(dir, 'saasfoundryai')
    if (await executable(candidate)) return { command: candidate, args: [] }
  }
  return undefined
}

/** Whether the resolved CLI knows `agents outcome capture` (an older release does not). Injectable, so a spec needs no process. */
export type CaptureProbe = (root: string) => Promise<boolean>

export const defaultCaptureProbe: CaptureProbe = async (root) => {
  const cli = await resolveCaptureCli(root)
  if (!cli) return false
  return new Promise<boolean>((resolve) => {
    const child = execFile(cli.command, [...cli.args, 'agents', 'outcome', 'capture', '--help'], { cwd: root, timeout: 8000, encoding: 'utf8' }, (error, stdout) =>
      resolve(!error && /--host/.test(stdout))
    )
    // A command that reads its input must not wait for ours.
    child.stdin?.end()
  })
}

/**
 * Whether the hooks that capture a host's delegations are declared and could run. Declared is not the same
 * as running (a host may not trust the file yet): this reads the file and asks the project's CLI whether it has
 * the command, it does not run the host.
 */
export async function captureState(root: string, agent: HarnessAgent, probe: CaptureProbe = defaultCaptureProbe): Promise<CaptureState> {
  if (agent !== 'claude-code' && agent !== 'codex') return 'not-enforced'
  const config = agent === 'claude-code' ? await readJson(join(root, '.claude', 'settings.json')) : await readJson(join(root, CODEX_HOOKS_PATH))
  const own = agent === 'claude-code' ? CLAUDE_CAPTURE_COMMAND : CODEX_CAPTURE_COMMAND
  if (!registers(config, 'SubagentStop', (command) => command === own)) return registers(config, 'SubagentStop', isLegacyCaptureCommand) ? 'outdated' : 'missing'
  if (!(await probe(root))) return 'declared-not-runnable'
  return agent === 'codex' ? 'declared' : 'enforced'
}
