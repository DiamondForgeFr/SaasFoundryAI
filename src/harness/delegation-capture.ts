import { lstat, open } from 'fs/promises'
import { homedir } from 'os'
import { isAbsolute, join } from 'path'

import {
  agentToken,
  appendEntry,
  appendRun,
  buildDetailRecord,
  buildRunRecord,
  findAgentSegments,
  findRoute,
  LEDGER_DIR,
  type AppendResult,
  type DelegationRunRecord,
  type LedgerState,
  type RunInput
} from './delegation-ledger'
import { resolveGitLayout } from './git-agent-scope'
import type { TokenUsage } from './model-prices'
import { readProjectRouting, type ProjectRouting } from './project-routing'
import { resolveAdjustPolicy } from './routing-adjust-config'
import { resolveTierCandidate } from './routing-grid'
import { CHECKS } from '../execution/calibration'

/**
 * Host capture (#1035): turn what a coding agent's hooks hand us into ledger records, with no help
 * from the session. Two facts decide how much can be known:
 *
 * - the host knows the **cost side** (the subagent transcript lists every API call with its usage, the
 *   `PostToolUse` result has the wall-clock duration and the resolved model);
 * - only the **delegate** knows the **outcome side**, so it ends with one machine line,
 *   `SF-DELEGATION: <pass|fail> route=<id> checks=<codes>`, read from the last message.
 *
 * What the delegate says about itself is only believed for the verdict and the checks. Which task kind,
 * tier, ticket and trial a delegation was comes from the **route record** `sf agents route --record`
 * issued and the delegate echoed: a missing or unknown id leaves the run without a kind, and a run
 * without a kind is censored. A fact the host did not give is left unknown, never estimated.
 *
 * An agent can be resumed (the session hands a result back to it): each stop is its own run, which
 * continues the agent's earlier one and counts only the transcript bytes written since that stop.
 */
export const CAPTURE_HOSTS = ['claude-code', 'codex'] as const
export type CaptureHost = (typeof CAPTURE_HOSTS)[number]

/** The most a single stop reads: a transcript beyond it is picked up by the next stop of the agent. */
const MAX_SEGMENT_BYTES = 64 * 1024 * 1024
/** A gap between two events of a transcript longer than this is the host waiting (or the agent idle), not work. */
const GAP_CAP_MS = 5 * 60_000

// --- the delegate's own line --------------------------------------------------------------------------

export interface DelegationReport {
  verdict: 'pass' | 'fail'
  /** The route id the delegate echoed: where the task kind, the tier, the ticket and the trial come from. */
  route: string | null
  checks: string[]
  /** Keys the line carried that the ledger does not read (a delegate's own claim of kind, ticket or trial is among them). */
  ignored: string[]
}

const DELEGATION_LINE = /^[\s*_`-]*SF-DELEGATION:[ \t]*(pass|fail)(?![A-Za-z0-9_])(.*)$/i
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/
const ROUTE_ID = /^[0-9a-f]{20}$/

/**
 * The delegate's closing line: the last non-empty line of the message outside a code fence. A line quoted
 * earlier, an example in a fence or one followed by more text is not the verdict. The fences are followed
 * from the start of the message, in one pass: a window cut inside a code block (a long diff, then the line)
 * would read open as closed and closed as open. Linear in the message, which the host bounds: no pattern
 * backtracks over blank lines. Values it got wrong become null or are dropped: the run is kept and censored
 * rather than refused.
 */
export function parseDelegationLine(message: unknown): DelegationReport | undefined {
  if (typeof message !== 'string') return undefined
  let last: string | undefined
  // A fence closes with the same mark, at least as long, and nothing after it; a backtick fence's info string has no backtick.
  let open: { mark: string; length: number } | undefined
  for (let start = 0; start <= message.length; ) {
    const end = message.indexOf('\n', start)
    const line = message.slice(start, end < 0 ? message.length : end).replace(/\r$/, '')
    start = end < 0 ? message.length + 1 : end + 1
    const fence = FENCE.exec(line)
    if (open) {
      if (fence && fence[1][0] === open.mark && fence[1].length >= open.length && fence[2].trim() === '') open = undefined
      continue
    }
    if (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) {
      open = { mark: fence[1][0], length: fence[1].length }
      continue
    }
    if (line.trim()) last = line
  }
  const match = last === undefined ? null : DELEGATION_LINE.exec(last)
  if (!match) return undefined
  const fields = new Map<string, string>()
  for (const token of match[2]
    .replace(/[*_`]+$/g, '')
    .trim()
    .split(/\s+/)) {
    const separator = token.indexOf('=')
    if (separator > 0) fields.set(token.slice(0, separator).toLowerCase(), token.slice(separator + 1).replace(/^["'`]|["'`,.;]+$/g, ''))
  }
  const route = (fields.get('route') ?? '').toLowerCase()
  const checks = (fields.get('checks') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => (CHECKS as readonly string[]).includes(entry))
  return {
    verdict: match[1].toLowerCase() as 'pass' | 'fail',
    route: ROUTE_ID.test(route) ? route : null,
    checks: [...new Set(checks)],
    ignored: [...fields.keys()].filter((key) => key !== 'route' && key !== 'checks')
  }
}

// --- transcripts --------------------------------------------------------------------------------------

export interface TranscriptSummary {
  tokens?: TokenUsage
  /** The usage of each API call, when the transcript lists them: a model with a long-prompt rate is priced call by call. */
  calls?: TokenUsage[]
  model?: string
  /** The time the agent worked: the gaps between its events, each capped, summed. */
  activeMs?: number
  /** API calls (Claude Code) or token reports (Codex) the summary is made of. */
  count: number
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const whole = (value: unknown): number | undefined => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined)
const TIMESTAMP = /"timestamp"\s*:\s*"([0-9T:.+\-Z]{20,32})"/

function parseObject(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line)
    return object(value) ? value : undefined
  } catch {
    // A torn line (the host was still writing) is not a reason to lose the others.
    return undefined
  }
}

/** The active time of an agent: gaps between consecutive events, each capped. Needs two timestamps. */
function activeTime(lines: readonly string[]): number | undefined {
  let previous: number | undefined
  let total = 0
  let seen = 0
  for (const line of lines) {
    const match = TIMESTAMP.exec(line)
    const time = match ? Date.parse(match[1]) : NaN
    if (!Number.isFinite(time)) continue
    seen++
    if (previous !== undefined) total += Math.min(Math.max(time - previous, 0), GAP_CAP_MS)
    previous = time
  }
  return seen >= 2 && total > 0 ? total : undefined
}

const sum = (calls: readonly TokenUsage[]): TokenUsage =>
  calls.reduce(
    (total, call) => ({ input: total.input + call.input, output: total.output + call.output, cacheRead: total.cacheRead + call.cacheRead, cacheWrite: total.cacheWrite + call.cacheWrite }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  )

/**
 * Claude Code: a subagent transcript lists each API call as one or several `assistant` lines of the same
 * `message.id` while it streams, the last carrying the final output count. The usage of a stop is the sum
 * over the distinct calls; only lines that carry a usage are parsed.
 */
export function summarizeClaudeLines(lines: readonly string[]): TranscriptSummary {
  const byCall = new Map<string, TokenUsage>()
  const models = new Map<string, number>()
  for (const [index, line] of lines.entries()) {
    if (!line.includes('"usage"') || !line.includes('"assistant"')) continue
    const entry = parseObject(line)
    if (!entry || entry.type !== 'assistant' || !object(entry.message) || !object(entry.message.usage)) continue
    const usage = entry.message.usage
    const id = typeof entry.message.id === 'string' ? entry.message.id : `line-${index}`
    const seen = byCall.get(id) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    byCall.set(id, {
      input: Math.max(seen.input, whole(usage.input_tokens) ?? 0),
      output: Math.max(seen.output, whole(usage.output_tokens) ?? 0),
      cacheRead: Math.max(seen.cacheRead, whole(usage.cache_read_input_tokens) ?? 0),
      cacheWrite: Math.max(seen.cacheWrite, whole(usage.cache_creation_input_tokens) ?? 0)
    })
    if (typeof entry.message.model === 'string' && !entry.message.model.startsWith('<')) models.set(entry.message.model, (models.get(entry.message.model) ?? 0) + 1)
  }
  const activeMs = activeTime(lines)
  if (!byCall.size) return { count: 0, ...(activeMs !== undefined ? { activeMs } : {}) }
  const calls = [...byCall.values()]
  const model = [...models.entries()].sort((left, right) => right[1] - left[1])[0]?.[0]
  return { tokens: sum(calls), calls, count: calls.length, ...(model ? { model } : {}), ...(activeMs !== undefined ? { activeMs } : {}) }
}

/**
 * Codex: the rollout reports a cumulative `token_count` after each turn; the last one is the run so far. Its
 * `input_tokens` includes the cached ones, which the ledger prices apart. A resumed agent starts from what
 * its earlier stops already counted (`before`), so a stop is billed for its own turns only.
 */
export function summarizeCodexLines(lines: readonly string[], before?: TokenUsage | null): TranscriptSummary {
  let usage: Record<string, unknown> | undefined
  let model: string | undefined
  let count = 0
  for (const line of lines) {
    const isContext = line.includes('"turn_context"')
    if (!isContext && !line.includes('"token_count"')) continue
    const entry = parseObject(line)
    const payload = entry?.payload
    if (!entry || !object(payload)) continue
    if (entry.type === 'turn_context' && typeof payload.model === 'string') model = payload.model
    if (entry.type === 'event_msg' && payload.type === 'token_count' && object(payload.info) && object(payload.info.total_token_usage)) {
      usage = payload.info.total_token_usage
      count++
    }
  }
  const activeMs = activeTime(lines)
  const base = { count, ...(model ? { model } : {}), ...(activeMs !== undefined ? { activeMs } : {}) }
  const input = whole(usage?.input_tokens)
  const output = whole(usage?.output_tokens)
  if (!usage || input === undefined || output === undefined) return base
  const cached = Math.min(whole(usage.cached_input_tokens) ?? 0, input)
  const total: TokenUsage = { input: input - cached, output, cacheRead: cached, cacheWrite: whole(usage.cache_write_input_tokens) ?? 0 }
  const prior = before ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const own: TokenUsage = {
    input: Math.max(total.input - prior.input, 0),
    output: Math.max(total.output - prior.output, 0),
    cacheRead: Math.max(total.cacheRead - prior.cacheRead, 0),
    cacheWrite: Math.max(total.cacheWrite - prior.cacheWrite, 0)
  }
  return { ...base, tokens: own }
}

/** Whole-text conveniences for fixtures and tests. */
export const summarizeClaudeTranscript = (text: string): TranscriptSummary => summarizeClaudeLines(text.split('\n'))
export const summarizeCodexTranscript = (text: string, before?: TokenUsage | null): TranscriptSummary => summarizeCodexLines(text.split('\n'), before)

export interface TranscriptSlice {
  lines: string[]
  /** Where this slice starts: the offset asked for, or 0 when the file is shorter than that (it started over). */
  from: number
  /** The byte after the last complete line read: where the next stop of the agent continues. */
  to: number
  /** More was written than one stop reads: the rest belongs to the next stop. */
  truncated: boolean
}

/**
 * The part of a transcript the host named that was written since `from`, read with the care a path from a
 * payload deserves: a regular file, bounded, never a link. Only complete lines are returned (a last line the
 * host is still writing is left for the next stop), and the bytes are cut on newlines, never inside a character.
 */
export async function readTranscriptSlice(path: unknown, from = 0): Promise<TranscriptSlice | undefined> {
  if (typeof path !== 'string' || !path || path.includes('\0')) return undefined
  const resolved = path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
  if (!isAbsolute(resolved)) return undefined
  try {
    const info = await lstat(resolved)
    if (!info.isFile() || info.isSymbolicLink()) return undefined
    const start = from <= info.size ? from : 0
    const length = Math.min(info.size - start, MAX_SEGMENT_BYTES)
    if (length <= 0) return { lines: [], from: start, to: start, truncated: false }
    const handle = await open(resolved, 'r')
    try {
      const buffer = Buffer.alloc(length)
      let read = 0
      while (read < length) {
        const { bytesRead } = await handle.read(buffer, read, length - read, start + read)
        if (bytesRead === 0) break
        read += bytesRead
      }
      const data = buffer.subarray(0, read)
      let end = data.lastIndexOf(0x0a) + 1
      // A final line without its newline counts when it is a whole JSON value: the host does not always end the file with one.
      if (end < data.length && start + read >= info.size && parseObject(data.toString('utf8', end)) !== undefined) end = data.length
      const lines = data
        .toString('utf8', 0, end)
        .split('\n')
        .filter((line) => line.trim())
      return { lines, from: start, to: start + end, truncated: start + length < info.size }
    } finally {
      await handle.close()
    }
  } catch {
    return undefined
  }
}

// --- the host event -----------------------------------------------------------------------------------

export interface CaptureOptions {
  /** Where the project is; defaults to the `cwd` of the payload, then the process directory. */
  root?: string
  now?: () => Date
}

/**
 * What a capture did. A run is `appended`, `merged` (a repeated stop that added a fact), `replayed` (the same
 * stop again) or `spooled` (the lock stayed taken; the line waits for the next writer). A tool result is a
 * `detail` of its agent. `root`, `dir` and `project` are what the adjustment that follows reads again.
 */
export type CaptureResult =
  | (AppendResult & { record: DelegationRunRecord; root: string; dir: string; project: ProjectRouting })
  /** The stop was recorded before and the transcript has nothing new: no state was read. */
  | { status: 'replayed'; id: string; record: DelegationRunRecord; root: string; dir: string; project: ProjectRouting }
  | { status: 'detail'; id: string; state: LedgerState; root: string; dir: string; project: ProjectRouting }
  | { status: 'ignored'; reason: string }

const FAILED_TOOL_STATUS = new Set(['failed', 'error', 'timeout', 'timed_out'])
const CANCELLED_TOOL_STATUS = new Set(['killed', 'cancelled', 'canceled'])
const BACKGROUND_TOOL_STATUS = new Set(['async_launched', 'launched', 'running', 'in_progress', 'background'])
const squash = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')

function routedTier(agentType: unknown): string | undefined {
  const match = typeof agentType === 'string' ? /^sf-([a-z][a-z0-9-]*)$/.exec(agentType) : null
  return match ? match[1] : undefined
}

const FALLBACK_PROJECT: ProjectRouting = (() => {
  const policy = resolveAdjustPolicy()
  return { agents: [], policy, decision: { policy, source: 'shipped', branch: null, invalid: null, differs: false } }
})()

/** Capture one hook payload. Never throws for a payload that is not ours: it is ignored with the reason. */
export async function captureHostEvent(host: CaptureHost, payload: unknown, options: CaptureOptions = {}): Promise<CaptureResult> {
  if (!object(payload)) return { status: 'ignored', reason: 'the payload is not a JSON object' }
  const event = squash(payload.hook_event_name ?? payload.event ?? payload.type)
  const isStop = event === 'subagentstop'
  const isTool = event === 'posttooluse' && host === 'claude-code' && ['agent', 'task'].includes(squash(payload.tool_name))
  if (!isStop && !isTool) return { status: 'ignored', reason: `${event || 'an unnamed event'} is not a delegation event` }

  const toolInput = object(payload.tool_input) ? payload.tool_input : {}
  const toolResponse = object(payload.tool_response) ? payload.tool_response : {}
  const tier = routedTier(isStop ? (payload.agent_type ?? payload.agent_name ?? payload.agent) : toolInput.subagent_type)
  if (!tier) return { status: 'ignored', reason: 'the agent is not a routed sf-<tier> agent' }

  const cwd = typeof options.root === 'string' ? options.root : typeof payload.cwd === 'string' && isAbsolute(payload.cwd) ? payload.cwd : process.cwd()
  const layout = await resolveGitLayout(cwd)
  if (!layout) return { status: 'ignored', reason: 'not a Git checkout: the ledger is kept in the Git directory of the clone' }
  const { root } = layout
  const dir = join(layout.commonDir, LEDGER_DIR)
  // The ledger is evidence: an unreadable manifest must not lose the record. The run is kept against the shipped
  // grid and marked, and only the trial flag and the price are judged without what could not be read.
  let project: ProjectRouting
  let degraded = false
  try {
    project = await readProjectRouting(root)
  } catch {
    degraded = true
    project = FALLBACK_PROJECT
  }
  const candidate = resolveTierCandidate(tier, host, project.decision.routing)
  if (!candidate) return { status: 'ignored', reason: `tier ${tier} is not declared for ${host}` }

  // An agent id is the host's own: it is never recorded as it came, only a hash of it.
  const rawAgentId = isStop ? payload.agent_id : (toolResponse.agentId ?? toolResponse.agent_id ?? payload.agent_id)
  const agentId = typeof rawAgentId === 'string' && rawAgentId ? agentToken(rawAgentId) : undefined
  const now = (options.now?.() ?? new Date()).toISOString()
  const unreadable = degraded || project.decision.invalid ? ['routing-unreadable'] : []

  if (!isStop) {
    const status = String(toolResponse.status ?? '').toLowerCase()
    if (!agentId) return { status: 'ignored', reason: 'the tool result names no agent id, so it cannot be joined to the agent stop' }
    if (BACKGROUND_TOOL_STATUS.has(status)) return { status: 'ignored', reason: 'a background launch: the agent stop carries the result' }
    const resolved = toolResponse.resolvedModel ?? toolResponse.model
    const detail = buildDetailRecord({
      host,
      agentId,
      durationMs: whole(toolResponse.totalDurationMs) ?? null,
      model: typeof resolved === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(resolved) ? resolved : null,
      status: FAILED_TOOL_STATUS.has(status) ? 'failed' : CANCELLED_TOOL_STATUS.has(status) ? 'cancelled' : null,
      at: now
    })
    const written = await appendEntry(dir, detail)
    return { status: 'detail', id: detail.id, state: written.state, root, dir, project }
  }

  const segments = agentId ? await findAgentSegments(dir, host, agentId) : []
  const previous = segments[segments.length - 1]
  const slice = await readTranscriptSlice(payload.agent_transcript_path ?? payload.transcript_path, previous?.segment?.to ?? 0)
  // The same stop seen again: the transcript has nothing the agent's last segment did not already count.
  if (previous && slice && slice.to === previous.segment?.to) return { status: 'replayed', id: previous.id, record: previous, root, dir, project }
  const summary = slice === undefined ? undefined : host === 'claude-code' ? summarizeClaudeLines(slice.lines) : summarizeCodexLines(slice.lines, sumTokens(segments))
  const report = parseDelegationLine(payload.last_assistant_message)
  const passed = report?.verdict === 'pass' && report.checks.some((check) => check !== 'self-review')

  // The route record, not the delegate's word, says which kind, tier, ticket and trial this was.
  const routeId = report?.route ?? previous?.route ?? null
  const route = routeId ? await findRoute(dir, routeId) : undefined
  const reasons: string[] = []
  if (!routeId) reasons.push('no-route')
  else if (!route) reasons.push('unknown-route')
  else if (route.provider !== host) reasons.push('route-provider-mismatch')
  else if (route.tier !== tier) reasons.push('route-tier-mismatch')
  else if (route.users.some((user) => user !== (agentId ?? null))) reasons.push('route-used-by-another-agent')
  // A route nobody has used and whose reservation lapsed is not a delegation anyone is waiting for: its trial would
  // land outside the share that was counted. An agent that already used the route (a resumed one) is never expired.
  else if (route.users.length === 0 && route.expiresAt < now) reasons.push('route-expired')
  const attributed = route !== undefined && reasons.length === 0

  const segment = slice ? { from: slice.from, to: slice.to } : null
  const messageKey = `${agentId ?? slice?.to ?? 'none'}:${String(payload.last_assistant_message ?? '').length}`
  const input: RunInput = {
    eventKey: agentId && segment ? `${host}:${agentId}:${segment.to}` : `${host}:${messageKey}:${String(payload.session_id ?? '').slice(0, 40)}`,
    at: now,
    host,
    agentId: agentId ?? null,
    segment,
    continues: previous?.id ?? null,
    retryOf: attributed ? route!.retryOf : null,
    route: routeId && route ? routeId : null,
    provider: host,
    tier,
    ticket: attributed ? route!.ticket : null,
    taskKind: attributed ? route!.taskKind : null,
    complexity: attributed ? route!.complexity : null,
    nature: attributed ? route!.nature : null,
    model: summary?.model ?? candidate.model,
    effort: candidate.effort,
    trial: attributed && route!.trial,
    durationMs: summary?.activeMs ?? null,
    tokens: summary?.tokens ?? null,
    calls: summary?.calls ?? null,
    outcome: report ? (report.verdict === 'fail' ? 'fail' : passed ? 'pass' : null) : null,
    checks: report?.checks ?? [],
    evidenceRefs: [
      agentId ? `agent:${agentId}` : undefined,
      report ? undefined : 'no-sf-delegation-line',
      report?.verdict === 'pass' && !passed ? 'pass-without-check' : undefined,
      slice?.truncated ? 'transcript-truncated' : undefined,
      ...reasons,
      ...unreadable
    ].filter((entry): entry is string => entry !== undefined)
  }
  const record = buildRunRecord(input, { prices: project.decision.policy.prices })
  const appended = await appendRun(dir, record)
  return { ...appended, record, root, dir, project }
}

function sumTokens(segments: readonly DelegationRunRecord[]): TokenUsage | null {
  const counted = segments.flatMap((segment) => (segment.tokens ? [segment.tokens] : []))
  return counted.length ? sum(counted) : null
}
