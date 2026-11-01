import { Command } from 'commander'

import { parseList, parseNonNegativeInteger, parsePositiveInteger, runAgentsSubcommand } from './agents.shared'
import { CAPTURE_HOSTS, captureHostEvent, type CaptureResult } from '../harness/delegation-capture'
import { appendEntry, appendRun, appendSignal, buildRunRecord, buildSignalRecord, buildStatusRecord, readLedger, requireLedgerDir, type RunInput } from '../harness/delegation-ledger'
import { readProjectRouting } from '../harness/project-routing'
import { ROUTING_PROVIDERS, TASK_KINDS, parseTaskKind, type TaskKind } from '../harness/routing-grid'
import { runAdjustment } from '../harness/routing-runtime'
import { adjustmentPayload, describeAdjustment } from './agents.routing'

export interface OutcomeRecordOptions {
  kind?: string
  provider?: string
  tier?: string
  outcome?: string
  ticket?: string
  complexity?: string
  nature?: string
  model?: string
  effort?: string
  durationMs?: string
  inputTokens?: string
  outputTokens?: string
  cacheReadTokens?: string
  cacheWriteTokens?: string
  checks?: string
  trial?: boolean
  evidence?: string[]
  json?: boolean
}

export interface OutcomeMarkOptions {
  kind?: string
  note?: string
  json?: boolean
}

/**
 * `sf agents outcome record`: for a coding agent whose host has no capture hook, or to record by hand
 * what a hook could not see. The record is the same one the hooks write; anything not said is
 * recorded as unknown, never guessed.
 */
export async function outcomeRecord(options: OutcomeRecordOptions): Promise<void> {
  await runAgentsSubcommand(options, async () => {
    const root = process.cwd()
    const dir = await requireLedgerDir(root)
    const { policy } = await readProjectRouting(root)
    if (options.kind !== undefined) parseTaskKind(options.kind)
    const tokens: NonNullable<RunInput['tokens']> = {}
    const input = parseNonNegativeInteger(options.inputTokens, '--input-tokens')
    const output = parseNonNegativeInteger(options.outputTokens, '--output-tokens')
    const cacheRead = parseNonNegativeInteger(options.cacheReadTokens, '--cache-read-tokens')
    const cacheWrite = parseNonNegativeInteger(options.cacheWriteTokens, '--cache-write-tokens')
    if (input !== undefined) tokens.input = input
    if (output !== undefined) tokens.output = output
    if (cacheRead !== undefined) tokens.cacheRead = cacheRead
    if (cacheWrite !== undefined) tokens.cacheWrite = cacheWrite
    const record = buildRunRecord(
      {
        host: 'manual',
        ticket: parsePositiveInteger(options.ticket, '--ticket') ?? null,
        taskKind: options.kind ?? null,
        complexity: options.complexity ?? null,
        nature: options.nature ?? null,
        provider: options.provider ?? '',
        tier: options.tier ?? '',
        model: options.model ?? null,
        effort: options.effort ?? null,
        trial: options.trial === true,
        durationMs: parseNonNegativeInteger(options.durationMs, '--duration-ms') ?? null,
        tokens: Object.keys(tokens).length ? tokens : null,
        outcome: options.outcome ?? null,
        checks: parseList(options.checks) ?? [],
        evidenceRefs: options.evidence ?? []
      },
      { prices: policy.prices }
    )
    const result = await appendRun(dir, record)
    if (options.json) {
      process.stdout.write(JSON.stringify({ outcomeVersion: 1, ...result, record }, null, 2) + '\n')
      return
    }
    const cost = record.cost ? `, cost $${record.cost.amount}` : record.tokens ? ', unpriced model' : ''
    const verb = result.status === 'appended' ? 'Recorded' : result.status === 'merged' ? 'Completed' : 'Already recorded'
    process.stdout.write(`${verb} delegation ${result.id}: ${record.taskKind ?? 'unknown kind'} on ${record.provider} ${record.tier}, outcome ${record.outcome}${cost}.\n`)
    if (record.outcome === 'outcome-unknown') process.stdout.write('The outcome was not measured: the run is censored and never counts as a success.\n')
  })
}

/**
 * The kinds that deliver a ticket's work, strongest claim first. A later signal of a ticket (rework, a defect
 * found in Human Testing) is about the work that was delivered, not about the review that found the defect.
 */
export const DELIVERY_KINDS: readonly TaskKind[] = ['multi-file-feature', 'scoped-edit', 'bug-fix', 'tests', 'terminal-ci']

/**
 * `sf agents outcome mark <ticket|run> <rework|human-defect>`: a later signal tied to the same step.
 * The session runs it when it had to rework a delegated result and when a ticket comes back from
 * Human Testing or review with a defect; the ledger is append-only, so the original run stays as it was.
 * A ticket without `--kind` is marked on the kind that delivered it, never on a review or an exploration.
 */
export async function outcomeMark(target: string | undefined, signal: string | undefined, options: OutcomeMarkOptions): Promise<void> {
  await runAgentsSubcommand(options, async () => {
    if (!target || !signal) throw new Error('Name what to mark and the signal: sf agents outcome mark <ticket|run-id> <rework|human-defect>.')
    const dir = await requireLedgerDir(process.cwd())
    if (options.kind !== undefined) parseTaskKind(options.kind)
    const byRun = /^[0-9a-f]{20}$/.test(target)
    if (byRun && options.kind !== undefined) throw new Error('--kind narrows a ticket; a run id already names one run.')
    const ticket = byRun ? undefined : parsePositiveInteger(target, 'The target')
    let kind: TaskKind | null = options.kind ? parseTaskKind(options.kind) : null
    if (!byRun && kind === null) {
      const state = await readLedger(dir)
      const recorded = new Set(state.runs.filter((run) => run.ticket === ticket && !run.superseded).map((run) => run.taskKind))
      kind = DELIVERY_KINDS.find((candidate) => recorded.has(candidate)) ?? null
      if (kind === null) throw new Error(`No delivery run (${DELIVERY_KINDS.join(', ')}) is recorded for ticket #${ticket}. Name the kind with --kind <kind>, or mark one run by its id.`)
    }
    const record = buildSignalRecord({ target: byRun ? { run: target } : { ticket: ticket!, taskKind: kind }, signal, note: options.note ?? null })
    const result = await appendSignal(dir, record)
    if (options.json) {
      process.stdout.write(JSON.stringify({ outcomeVersion: 1, status: 'appended', id: result.id, matched: result.matched, signal, kind }, null, 2) + '\n')
      return
    }
    const subject = byRun ? `run ${target}` : `ticket #${ticket} (${kind})`
    process.stdout.write(`Marked ${result.matched} delegation run${result.matched === 1 ? '' : 's'} of ${subject} as ${signal}: a success now counts as a failure.\n`)
  })
}

/**
 * `sf agents outcome status-event <ticket> <status>`: a ticket changed status. `workflow-cli.sh update-status`
 * runs it, best effort, so the ledger knows when a ticket went In progress and reached Human testing and the
 * report can show how long a ticket took. Nothing in the routing depends on it.
 */
export async function outcomeStatusEvent(ticket: string | undefined, status: string | undefined, options: { json?: boolean }): Promise<void> {
  await runAgentsSubcommand(options, async () => {
    if (!ticket || !status) throw new Error('Name the ticket and its new status: sf agents outcome status-event <ticket> <status>.')
    const dir = await requireLedgerDir(process.cwd())
    const record = buildStatusRecord({ ticket: parsePositiveInteger(ticket, 'The ticket')!, status })
    const written = await appendEntry(dir, record)
    if (options.json) process.stdout.write(JSON.stringify({ outcomeVersion: 1, status: written.status, id: record.id, ticket: record.ticket, ticketStatus: record.status }, null, 2) + '\n')
  })
}

export interface OutcomeCaptureOptions {
  host?: string
  json?: boolean
}

async function readStdin(limit = 8 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > limit) throw new Error('The hook payload is larger than 8 MiB.')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * `sf agents outcome capture --host <claude-code|codex>`: the command the host hooks run, with the hook
 * payload on stdin. A hook must never break the agent it observes, so everything that goes wrong after
 * the arguments were understood (an unreadable payload, a project without a ledger) is reported on
 * stderr with exit 0; only a wrong `--host` fails.
 */
export async function outcomeCapture(options: OutcomeCaptureOptions): Promise<void> {
  const host = options.host
  if (host !== 'claude-code' && host !== 'codex') {
    process.stderr.write(`Error: --host must be ${CAPTURE_HOSTS.join(' or ')}.\n`)
    process.exitCode = 1
    return
  }
  let result: CaptureResult
  try {
    if (process.stdin.isTTY) throw new Error('capture reads a hook payload on stdin: it is run by the host hooks, not by hand (use sf agents outcome record).')
    const text = await readStdin()
    result = await captureHostEvent(host, JSON.parse(text))
  } catch (error) {
    result = { status: 'ignored', reason: `capture failed: ${error instanceof Error ? error.message : String(error)}` }
    process.stderr.write(`sf agents outcome capture: ${result.reason}\n`)
  }
  // After each recorded run the routing looks at the evidence again: a move is applied without asking,
  // and logged where `sf agents routing report` and `sf status` show it. It reads the state the append
  // just returned, the project and the directory the capture already resolved: nothing is read twice.
  let adjustment: Record<string, unknown> | undefined
  if ('state' in result && (result.status === 'detail' || result.record?.taskKind !== null)) {
    try {
      const adjusted = await runAdjustment(result.root, { ledger: result.state, dir: result.dir, project: result.project })
      adjustment = adjustmentPayload(adjusted)
      const lines = describeAdjustment(adjusted)
      if (lines.length) process.stderr.write(`${lines.map((line) => `sf routing: ${line}`).join('\n')}\n`)
    } catch (error) {
      process.stderr.write(`sf agents outcome capture: the routing adjustment was skipped (${error instanceof Error ? error.message : String(error)})\n`)
    }
  }
  if (options.json) {
    // The project and the folded ledger are what the adjustment read, not part of the answer
    const printable = Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'project' && key !== 'state'))
    process.stdout.write(JSON.stringify({ outcomeVersion: 1, host, ...printable, ...(adjustment ? { adjustment } : {}) }, null, 2) + '\n')
  }
}

const collect = (value: string, previous: string[]): string[] => [...previous, value]

/** Register `sf agents outcome record|mark` (and `capture`, added by the host-capture slice). */
export function registerOutcomeCommands(agents: Command): Command {
  const outcome = agents.command('outcome').description('Record what a routed delegation cost and whether it did the job (the ledger the routing adjusts itself from)')
  outcome
    .command('record')
    .description('Append one delegation outcome to the clone ledger (for a host without a capture hook, or to complete a record by hand)')
    .requiredOption('--provider <agent>', ROUTING_PROVIDERS.join(', '))
    .requiredOption('--tier <tier>', 'The tier agent that ran: light, edit, build, fix, plan, terminal')
    .option('--kind <kind>', `The task kind (${TASK_KINDS.join(', ')}); without it the run is censored`)
    .option('--outcome <code>', 'success, execution-failed, validation-failed, candidate-unavailable, cancelled, or pass / fail; without it the outcome is unknown')
    .option('--ticket <number>', 'The ticket the delegation served')
    .option('--complexity <level>', 'bug, low, medium, complex')
    .option('--nature <nature>', 'user-facing, internal, bundled-pr')
    .option('--model <id>', 'The model that ran')
    .option('--effort <effort>', 'The effort it ran at')
    .option('--duration-ms <ms>', 'Wall-clock duration')
    .option('--input-tokens <n>', 'Input tokens of the whole run')
    .option('--output-tokens <n>', 'Output tokens of the whole run')
    .option('--cache-read-tokens <n>', 'Cache read tokens')
    .option('--cache-write-tokens <n>', 'Cache write tokens')
    .option('--checks <codes>', 'Comma-separated check codes the delegate ran: self-review, type-check, automated-tests, integration-tests, independent-review, security-tests')
    .option('--trial', 'The run tried a cheaper tier than the one the kind is routed to')
    .option('--evidence <ref>', 'A short reference to the evidence (a commit, a report); repeatable', collect, [])
    .option('--json', 'Output the versioned result')
    .action((options: OutcomeRecordOptions) => outcomeRecord(options))
  outcome
    .command('mark')
    .description('Tie a later signal to a delegated step: the session reworked it, or a Human Testing defect came back')
    .argument('<target>', 'A ticket number or a run id')
    .argument('<signal>', 'rework or human-defect')
    .option('--kind <kind>', 'The task kind to mark, with a ticket (default: the kind that delivered the ticket: multi-file-feature, scoped-edit, bug-fix, tests, terminal-ci; never a review)')
    .option('--note <text>', 'A short note')
    .option('--json', 'Output the versioned result')
    .action((target: string, signal: string, options: OutcomeMarkOptions) => outcomeMark(target, signal, options))
  outcome
    .command('status-event')
    .description('Record that a ticket changed status (run by workflow-cli.sh update-status, best effort): the report shows how long a ticket took')
    .argument('<ticket>', 'The ticket number')
    .argument('<status>', 'Its new status, e.g. "In progress"')
    .option('--json', 'Output the versioned result')
    .action((ticket: string, status: string, options: { json?: boolean }) => outcomeStatusEvent(ticket, status, options))
  outcome
    .command('capture')
    .description('Record the delegation a host hook reports (hook payload on stdin); run by the SubagentStop and PostToolUse hooks, never fails the host')
    .requiredOption('--host <agent>', CAPTURE_HOSTS.join(' or '))
    .option('--json', 'Print the versioned result (silent otherwise)')
    .action((options: OutcomeCaptureOptions) => outcomeCapture(options))
  return outcome
}
