import { lstat, readFile } from 'fs/promises'
import { join } from 'path'

import type { HarnessAgent } from './agent-registry'
import type { ClaudeHooksConfig } from '../utils/claude-settings'

/**
 * The hooks that feed the delegation ledger (#1035). One command serves every event of a host: it reads
 * the event name from the payload and ignores what is not a routed delegation, so the hook declaration
 * stays short and a future event needs no new command.
 */
export const CLAUDE_CAPTURE_COMMAND = 'sf agents outcome capture --host claude-code'
export const CODEX_CAPTURE_COMMAND = 'sf agents outcome capture --host codex'
const HOOK_TIMEOUT_SECONDS = 30

/**
 * Claude Code: `SubagentStop` is the primary event (transcript, last message); `PostToolUse` on the
 * delegation tool adds the duration and resolved model of a synchronous run. The tool is `Agent` today
 * and was `Task`: the matcher takes both.
 */
export const CLAUDE_CAPTURE_HOOKS: ClaudeHooksConfig = {
  SubagentStop: [{ hooks: [{ type: 'command', command: CLAUDE_CAPTURE_COMMAND, timeout: HOOK_TIMEOUT_SECONDS }] }],
  PostToolUse: [{ matcher: 'Agent|Task', hooks: [{ type: 'command', command: CLAUDE_CAPTURE_COMMAND, timeout: HOOK_TIMEOUT_SECONDS }] }]
}

/** Codex: project hooks load from this file next to the tracked `.codex/agents/`, once the `.codex/` layer is trusted. */
export const CODEX_HOOKS_PATH = '.codex/hooks.json'

interface HookGroup {
  matcher?: string
  hooks?: { type?: string; command?: string; timeout?: number }[]
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

function registers(config: unknown, event: string, command: string): boolean {
  const hooks = object(config) && object(config.hooks) ? config.hooks : undefined
  const groups = hooks && Array.isArray(hooks[event]) ? (hooks[event] as HookGroup[]) : []
  return groups.some((group) => Array.isArray(group?.hooks) && group.hooks.some((hook) => hook?.command === command))
}

/**
 * The Codex hooks file with the capture hook added to what the project already has there: other hooks
 * and keys are kept, a repeated render changes nothing. An existing file that is not JSON is left alone.
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
  if (registers(config, 'SubagentStop', CODEX_CAPTURE_COMMAND)) return { content: existing ?? '' }
  const hooks = object(config.hooks) ? { ...config.hooks } : {}
  const groups = Array.isArray(hooks.SubagentStop) ? [...(hooks.SubagentStop as unknown[])] : []
  groups.push({ hooks: [{ type: 'command', command: CODEX_CAPTURE_COMMAND, timeout: HOOK_TIMEOUT_SECONDS }] })
  hooks.SubagentStop = groups
  return { content: `${JSON.stringify({ ...config, hooks }, null, 2)}\n` }
}

export type CaptureState = 'enforced' | 'missing' | 'not-enforced'

async function readJson(path: string): Promise<unknown> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) return undefined
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Whether the hooks that capture a host's delegations are declared. Declared is not the same as running
 * (a host may not trust the file yet): this reads the file, it does not run the host.
 */
export async function captureState(root: string, agent: HarnessAgent): Promise<CaptureState> {
  if (agent === 'claude-code') return registers(await readJson(join(root, '.claude', 'settings.json')), 'SubagentStop', CLAUDE_CAPTURE_COMMAND) ? 'enforced' : 'missing'
  if (agent === 'codex') return registers(await readJson(join(root, CODEX_HOOKS_PATH)), 'SubagentStop', CODEX_CAPTURE_COMMAND) ? 'enforced' : 'missing'
  return 'not-enforced'
}
