import { createHash } from 'crypto'
import { lstat, open } from 'fs/promises'
import { homedir } from 'os'
import { isAbsolute, join } from 'path'

import { appendRun, buildRunRecord, COMPLEXITIES, NATURES, resolveLedgerDir, type AppendResult, type Complexity, type DelegationRunRecord, type Nature, type RunInput } from './delegation-ledger'
import { resolveGitRoot } from './git-agent-scope'
import type { TokenUsage } from './model-prices'
import { readProjectRouting } from './project-routing'
import { autoKindsFor, emptyLocalRouting, readLocalRouting } from './routing-local'
import { resolveRoute, resolveTierCandidate, tierRank, TASK_KINDS, type RoutingProvider, type TaskKind } from './routing-grid'
import { CHECKS } from '../execution/calibration'

/**
 * Host capture (#1035): turn what a coding agent's hooks hand us into one ledger record, with no help
 * from the session. Two facts decide how much can be known:
 *
 * - the host knows the **cost side** (the subagent transcript lists every API call with its usage, the
 *   `PostToolUse` result has the wall-clock duration and the resolved model);
 * - only the **delegate** knows the **outcome side**, so it ends with one machine line,
 *   `SF-DELEGATION: <pass|fail> kind=<task kind> ticket=<n> checks=<codes>`, read from the last message.
 *
 * A fact the host did not give is left unknown, never estimated: a record without a verdict is
 * `outcome-unknown` and a record without a kind is censored.
 */
export const CAPTURE_HOSTS = ['claude-code', 'codex'] as const
export type CaptureHost = (typeof CAPTURE_HOSTS)[number]

const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024

// --- the delegate's own line --------------------------------------------------------------------------

export interface DelegationReport {
  verdict: 'pass' | 'fail'
  kind: TaskKind | null
  ticket: number | null
  complexity: Complexity | null
  nature: Nature | null
  trial: boolean
  checks: string[]
  /** Keys the line carried that mean nothing to the ledger. */
  ignored: string[]
}

const DELEGATION_LINE = /^[\s>*_`-]*SF-DELEGATION:[ \t]*(pass|fail)\b([^\n]*)$/gim

/**
 * The delegate's closing line, the last one when it wrote several (a quoted example earlier in its
 * message must not win over its real verdict). Values it got wrong become null: the run is kept and
 * censored rather than refused.
 */
export function parseDelegationLine(message: unknown): DelegationReport | undefined {
  if (typeof message !== 'string') return undefined
  let last: RegExpExecArray | undefined
  for (const match of message.matchAll(DELEGATION_LINE)) last = match
  if (!last) return undefined
  const fields = new Map<string, string>()
  for (const token of last[2]
    .replace(/[*_`]+$/g, '')
    .trim()
    .split(/\s+/)) {
    const separator = token.indexOf('=')
    if (separator > 0) fields.set(token.slice(0, separator).toLowerCase(), token.slice(separator + 1).replace(/^["'`]|["'`,.;]+$/g, ''))
  }
  const known = ['kind', 'ticket', 'complexity', 'nature', 'trial', 'checks']
  const ticket = Number((fields.get('ticket') ?? '').replace(/^#/, ''))
  const checks = (fields.get('checks') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => (CHECKS as readonly string[]).includes(entry))
  return {
    verdict: last[1].toLowerCase() as 'pass' | 'fail',
    kind: (TASK_KINDS as readonly string[]).includes(fields.get('kind') ?? '') ? (fields.get('kind') as TaskKind) : null,
    ticket: Number.isSafeInteger(ticket) && ticket > 0 ? ticket : null,
    complexity: (COMPLEXITIES as readonly string[]).includes(fields.get('complexity') ?? '') ? (fields.get('complexity') as Complexity) : null,
    nature: (NATURES as readonly string[]).includes(fields.get('nature') ?? '') ? (fields.get('nature') as Nature) : null,
    trial: ['yes', 'true', '1'].includes((fields.get('trial') ?? '').toLowerCase()),
    checks: [...new Set(checks)],
    ignored: [...fields.keys()].filter((key) => !known.includes(key))
  }
}

// --- transcripts --------------------------------------------------------------------------------------

export interface TranscriptSummary {
  tokens?: TokenUsage
  model?: string
  durationMs?: number
  /** API calls (Claude Code) or token reports (Codex) the summary is made of. */
  calls: number
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const whole = (value: unknown): number | undefined => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined)

function jsonLines(text: string): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const value: unknown = JSON.parse(line)
      if (object(value)) lines.push(value)
    } catch {
      // A torn last line (the host was still writing) is not a reason to lose the others.
    }
  }
  return lines
}

function spanMs(lines: readonly Record<string, unknown>[]): number | undefined {
  const times = lines.map((line) => (typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : NaN)).filter((time) => Number.isFinite(time))
  if (times.length < 2) return undefined
  const span = Math.max(...times) - Math.min(...times)
  return span > 0 ? span : undefined
}

/**
 * Claude Code: a subagent transcript lists each API call as one or several `assistant` lines of the same
 * `message.id` while it streams, the last carrying the final output count. The run's usage is the sum
 * over the distinct calls.
 */
export function summarizeClaudeTranscript(text: string): TranscriptSummary {
  const lines = jsonLines(text)
  const byCall = new Map<string, TokenUsage>()
  const models = new Map<string, number>()
  for (const [index, line] of lines.entries()) {
    if (line.type !== 'assistant' || !object(line.message)) continue
    const usage = line.message.usage
    if (!object(usage)) continue
    const id = typeof line.message.id === 'string' ? line.message.id : `line-${index}`
    const seen = byCall.get(id) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    byCall.set(id, {
      input: Math.max(seen.input, whole(usage.input_tokens) ?? 0),
      output: Math.max(seen.output, whole(usage.output_tokens) ?? 0),
      cacheRead: Math.max(seen.cacheRead, whole(usage.cache_read_input_tokens) ?? 0),
      cacheWrite: Math.max(seen.cacheWrite, whole(usage.cache_creation_input_tokens) ?? 0)
    })
    if (typeof line.message.model === 'string' && !line.message.model.startsWith('<')) models.set(line.message.model, (models.get(line.message.model) ?? 0) + 1)
  }
  const durationMs = spanMs(lines)
  if (!byCall.size) return { calls: 0, ...(durationMs !== undefined ? { durationMs } : {}) }
  const tokens = [...byCall.values()].reduce((sum, call) => ({
    input: sum.input + call.input,
    output: sum.output + call.output,
    cacheRead: sum.cacheRead + call.cacheRead,
    cacheWrite: sum.cacheWrite + call.cacheWrite
  }))
  const model = [...models.entries()].sort((left, right) => right[1] - left[1])[0]?.[0]
  return { tokens, calls: byCall.size, ...(model ? { model } : {}), ...(durationMs !== undefined ? { durationMs } : {}) }
}

/**
 * Codex: the rollout reports a cumulative `token_count` after each turn; the last one is the run. Its
 * `input_tokens` includes the cached ones, which the ledger prices apart.
 */
export function summarizeCodexTranscript(text: string): TranscriptSummary {
  const lines = jsonLines(text)
  let usage: Record<string, unknown> | undefined
  let model: string | undefined
  let calls = 0
  for (const line of lines) {
    const payload = line.payload
    if (!object(payload)) continue
    if (line.type === 'turn_context' && typeof payload.model === 'string') model = payload.model
    if (line.type === 'event_msg' && payload.type === 'token_count' && object(payload.info) && object(payload.info.total_token_usage)) {
      usage = payload.info.total_token_usage
      calls++
    }
  }
  const durationMs = spanMs(lines)
  const input = whole(usage?.input_tokens)
  const output = whole(usage?.output_tokens)
  const base = { calls, ...(model ? { model } : {}), ...(durationMs !== undefined ? { durationMs } : {}) }
  if (!usage || input === undefined || output === undefined) return base
  const cached = Math.min(whole(usage.cached_input_tokens) ?? 0, input)
  return { ...base, tokens: { input: input - cached, output, cacheRead: cached, cacheWrite: whole(usage.cache_write_input_tokens) ?? 0 } }
}

/** A transcript the host named, read with the care a path from a payload deserves: a regular file, bounded, never a link. */
export async function readTranscriptText(path: unknown): Promise<string | undefined> {
  if (typeof path !== 'string' || !path || path.includes('\0')) return undefined
  const resolved = path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
  if (!isAbsolute(resolved)) return undefined
  try {
    const info = await lstat(resolved)
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_TRANSCRIPT_BYTES) return undefined
    const handle = await open(resolved, 'r')
    try {
      return await handle.readFile('utf8')
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
  /** The tier a kind is routed to right now, for flagging a run that tried a cheaper one. Defaults to the shared routing and the clone's automatic moves. */
  effectiveTier?: (kind: TaskKind, provider: RoutingProvider) => string | undefined
}

/** `root` is the working tree the project was found in: the adjustment that follows a capture reads the same project. */
export type CaptureResult = (AppendResult & { record: DelegationRunRecord; root: string }) | { status: 'ignored'; reason: string }

const FAILED_TOOL_STATUS = new Set(['failed', 'error', 'killed', 'cancelled', 'canceled', 'timeout', 'timed_out'])
const BACKGROUND_TOOL_STATUS = new Set(['async_launched', 'launched', 'running', 'in_progress', 'background'])
const squash = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')

function routedTier(agentType: unknown): string | undefined {
  const match = typeof agentType === 'string' ? /^sf-([a-z][a-z0-9-]*)$/.exec(agentType) : null
  return match ? match[1] : undefined
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 16)

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
  const root = (await resolveGitRoot(cwd)) ?? cwd
  const ledgerDir = await resolveLedgerDir(root)
  if (!ledgerDir) return { status: 'ignored', reason: 'not a Git checkout: the ledger is kept in the Git directory of the clone' }
  const project = await readProjectRouting(root)
  // A damaged local layer must not lose the record: the run is kept, only its trial flag is judged without the layer.
  const local = await readLocalRouting(ledgerDir).catch(() => emptyLocalRouting())
  const candidate = resolveTierCandidate(tier, host, project.routing)
  if (!candidate) return { status: 'ignored', reason: `tier ${tier} is not declared for ${host}` }

  const agentId = isStop ? payload.agent_id : (toolResponse.agentId ?? toolResponse.agent_id ?? payload.agent_id)
  let input: RunInput
  if (isStop) {
    const transcript = await readTranscriptText(payload.agent_transcript_path ?? payload.transcript_path)
    const summary = transcript === undefined ? undefined : host === 'claude-code' ? summarizeClaudeTranscript(transcript) : summarizeCodexTranscript(transcript)
    const report = parseDelegationLine(payload.last_assistant_message)
    const passed = report?.verdict === 'pass' && report.checks.length > 0
    const evidence = [
      typeof agentId === 'string' ? `agent:${agentId}` : undefined,
      report ? undefined : 'no-sf-delegation-line',
      report?.verdict === 'pass' && !passed ? 'pass-without-check' : undefined
    ]
    // The tier the kind is routed to by now, the clone's own automatic moves included: a run below it is a trial.
    const routedTier = options.effectiveTier ?? ((kind: TaskKind, provider: RoutingProvider) => resolveRoute(kind, provider, project.routing, autoKindsFor(local, provider)).tier)
    const effectiveTier = report?.kind ? routedTier(report.kind, host) : undefined
    const cheaper = effectiveTier !== undefined && effectiveTier !== tier && tierRank(tier) >= 0 && tierRank(tier) < tierRank(effectiveTier)
    input = {
      eventKey: `${host}:${typeof agentId === 'string' && agentId ? agentId : hash(String(payload.agent_transcript_path ?? payload.session_id ?? '') + String(payload.last_assistant_message ?? ''))}`,
      at: (options.now?.() ?? new Date()).toISOString(),
      host,
      provider: host,
      tier,
      ticket: report?.ticket ?? null,
      taskKind: report?.kind ?? null,
      complexity: report?.complexity ?? null,
      nature: report?.nature ?? null,
      model: summary?.model ?? candidate.model,
      effort: candidate.effort,
      trial: Boolean(report?.trial) || cheaper,
      durationMs: summary?.durationMs ?? null,
      tokens: summary?.tokens ?? null,
      outcome: report ? (report.verdict === 'fail' ? 'fail' : passed ? 'pass' : null) : null,
      checks: report?.checks ?? [],
      evidenceRefs: evidence.filter((entry): entry is string => entry !== undefined)
    }
  } else {
    const status = String(toolResponse.status ?? '').toLowerCase()
    if (typeof agentId !== 'string' || !agentId) return { status: 'ignored', reason: 'the tool result names no agent id, so it cannot be joined to the agent stop' }
    if (BACKGROUND_TOOL_STATUS.has(status)) return { status: 'ignored', reason: 'a background launch: the agent stop carries the result' }
    const duration = whole(toolResponse.totalDurationMs)
    const resolved = toolResponse.resolvedModel ?? toolResponse.model
    input = {
      eventKey: `${host}:${agentId}`,
      at: (options.now?.() ?? new Date()).toISOString(),
      host,
      provider: host,
      tier,
      model: typeof resolved === 'string' ? resolved : null,
      effort: candidate.effort,
      durationMs: duration ?? null,
      // The result reports the last request's usage only, not the run's: tokens come from the transcript.
      tokens: null,
      outcome: FAILED_TOOL_STATUS.has(status) ? 'execution-failed' : null,
      evidenceRefs: [`agent:${agentId}`, ...(status ? [`tool-status:${status}`] : [])]
    }
  }
  const record = buildRunRecord(input, { prices: project.policy.prices })
  const appended = await appendRun(ledgerDir, record)
  return { ...appended, record, root }
}
