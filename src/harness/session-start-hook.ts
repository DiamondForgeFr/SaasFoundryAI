import type { ClaudeHooksConfig } from '../utils/claude-settings'

/**
 * The hook that puts the project status in front of the session at its start (#1103). Its command is a
 * self-contained shell line, not a bare `sf`: `sf` is whatever comes first on the machine's PATH, an older
 * SaaSFoundryAI whose report lacks the `delegation:`, `routing:` and `local-ci:` lines the instructions send
 * the agent to read, or the Salesforce CLI. It runs the CLI the **project** resolves, in the order the
 * delegation capture hook uses:
 *
 * 1. `node_modules/.bin/saasfoundryai`, the CLI the project installed;
 * 2. this repository's own `bin/sf.js`, when the project is the SaaSFoundryAI CLI itself (its `package.json`
 *    names it) and `dist/index.js` is built, since `bin/sf.js` runs `dist/`;
 * 3. `saasfoundryai` on the PATH.
 *
 * `node_modules/.bin/sf` is not tried: a project can install the Salesforce CLI, whose binary is also `sf`,
 * and ours always installs `saasfoundryai` next to it.
 *
 * What it prints is facts. The status report states the project; when the hook cannot produce one it prints a
 * `- cli:` or `- status:` line that says why (no CLI found, `bin/sf.js` not built, the CLI exited with a
 * code), never an instruction. It always exits 0: a hook that fails on every session start is worse than none.
 * The CLI's stale-skill advisory is silenced (`SF_SKILL_NO_WARN=1`) because this report is read by an agent,
 * not a developer. The project is `CLAUDE_PROJECT_DIR`, or the current directory when the host sets none.
 */
const SESSION_START_SCRIPT = [
  'd="${CLAUDE_PROJECT_DIR:-.}"',
  'cd "$d" 2>/dev/null || { echo "- cli: cannot enter the project directory $d"; exit 0; }',
  'run() { SF_SKILL_NO_WARN=1 "$@" status --agent-friendly --no-network || echo "- status: $* exited $?"; exit 0; }',
  '[ -x node_modules/.bin/saasfoundryai ] && run node_modules/.bin/saasfoundryai',
  `[ -f bin/sf.js ] && grep -q '"name": "saasfoundryai-cli"' package.json 2>/dev/null && { [ -f dist/index.js ] && run node bin/sf.js; echo "- cli: bin/sf.js is not built (run npm run build); trying saasfoundryai on the PATH"; }`,
  'command -v saasfoundryai >/dev/null 2>&1 && run saasfoundryai',
  'echo "- cli: no SaaSFoundryAI CLI found (looked for node_modules/.bin/saasfoundryai, bin/sf.js and saasfoundryai on the PATH)"',
  'exit 0'
].join('; ')

export const SESSION_START_COMMAND = SESSION_START_SCRIPT

/** Seconds the host waits: `sf status` starts a probe per declared coding agent, up to 8 s each. */
const HOOK_TIMEOUT_SECONDS = 30

/** Claude Code: no matcher, so it runs on startup, resume, clear and compact. */
export const SESSION_START_HOOKS: ClaudeHooksConfig = {
  SessionStart: [{ hooks: [{ type: 'command', command: SESSION_START_COMMAND, timeout: HOOK_TIMEOUT_SECONDS }] }]
}

/**
 * The commands an earlier release wrote: a bare `sf status`, with either spelling of the flag. A merge
 * replaces them with the resolved command (the settings merge only adds a command whose exact string is
 * missing, so without this the project would keep both).
 */
const LEGACY_SESSION_START_COMMAND = /^sf status --(?:claude|agent)-friendly --no-network$/
export const isLegacySessionStartCommand = (command: unknown): boolean => typeof command === 'string' && LEGACY_SESSION_START_COMMAND.test(command)

interface HookGroup {
  matcher?: string
  hooks?: { type?: string; command?: string; timeout?: number }[]
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * The Codex hooks file with its bare-`sf` SessionStart command replaced by the resolved one, in place. A file
 * without that command is returned as it is: `.codex/hooks.json` is project-owned, and a session-start hook
 * the project did not ask for is not added to it. Other hooks and keys are kept, a repeated render changes
 * nothing, and a file that is not a hooks object is reported, not rewritten.
 */
export function withCodexSessionStart(content: string): { content: string } | { error: string } {
  let config: unknown
  try {
    config = JSON.parse(content)
  } catch {
    return { error: 'is not valid JSON' }
  }
  if (!object(config) || (config.hooks !== undefined && !object(config.hooks))) return { error: 'is not a hooks object' }
  const groups = object(config.hooks) && Array.isArray(config.hooks.SessionStart) ? (config.hooks.SessionStart as HookGroup[]) : []
  const registered = (command: unknown) => groups.some((group) => Array.isArray(group?.hooks) && group.hooks.some((hook) => hook?.command === command))
  if (!groups.some((group) => Array.isArray(group?.hooks) && group.hooks.some((hook) => isLegacySessionStartCommand(hook?.command)))) return { content }

  // Replaced in place, so the hook keeps its position among the project's own; dropped when the resolved one is already there.
  let placed = registered(SESSION_START_COMMAND)
  const next = groups
    .map((group) => {
      if (!Array.isArray(group?.hooks)) return group
      const hooks = group.hooks.flatMap((hook) => {
        if (!isLegacySessionStartCommand(hook?.command)) return [hook]
        if (placed) return []
        placed = true
        return [{ type: 'command', command: SESSION_START_COMMAND, timeout: HOOK_TIMEOUT_SECONDS }]
      })
      return { ...group, hooks }
    })
    .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length > 0)
  return { content: `${JSON.stringify({ ...config, hooks: { ...(config.hooks as Record<string, unknown>), SessionStart: next } }, null, 2)}\n` }
}
