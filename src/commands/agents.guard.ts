import { Command } from 'commander'
import { isAbsolute } from 'path'

import { appendCaptureError } from '../harness/capture-errors'
import { resolveLedgerDir } from '../harness/delegation-ledger'
import { evaluateToolCall, GUARDED_TOOLS, type GuardHost } from '../harness/tool-call-guard'

export const GUARD_HOSTS: readonly GuardHost[] = ['claude-code', 'codex']

export interface AgentsGuardOptions {
  host?: string
}

/** A payload no guard decision can be read from; larger than this, it is not a command a person or an agent typed. */
const MAX_PAYLOAD_BYTES = 1024 * 1024

class GuardPayloadError extends Error {}

async function readStdin(limit = MAX_PAYLOAD_BYTES): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > limit) throw new GuardPayloadError('the hook payload is larger than 1 MiB')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const record = (value: unknown): Record<string, unknown> | undefined => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined)

/**
 * The command a host is about to run, from the shape of its tool event. Claude Code and Codex both put it in
 * `tool_input.command`; Codex `exec_command` calls it `cmd`, and a shell tool may pass an argument vector, which
 * is quoted word by word so that the tokeniser reads it as the shell would.
 */
function commandOf(toolInput: unknown): string {
  const input = record(toolInput)
  const value = input?.command ?? input?.cmd
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every((word) => typeof word === 'string')) return (value as string[]).map((word) => `'${word.replace(/'/g, `'\\''`)}'`).join(' ')
  return ''
}

/**
 * `sf agents guard --host <claude-code|codex>`: the command the `PreToolUse` hook of a host runs, with the tool
 * event on stdin. It prints the host's deny decision when the call is one the guard refuses (`tool-call-guard.ts`),
 * and nothing otherwise: staying silent leaves the host's own permission flow in place. A hook must never break
 * the agent it watches, so it always exits 0, and fails open: a payload it cannot read lets the call through and
 * is written to the capture error log, where `sf status` counts it.
 */
export async function agentsGuard(options: AgentsGuardOptions): Promise<void> {
  const host = options.host
  if (host !== 'claude-code' && host !== 'codex') {
    process.stderr.write(`sf agents guard: --host must be ${GUARD_HOSTS.join(' or ')}.\n`)
    return
  }
  if (process.stdin.isTTY) {
    process.stderr.write('sf agents guard reads a hook payload on stdin: it is run by the PreToolUse hook of the host, not by hand.\n')
    return
  }
  let project: string | undefined
  try {
    let payload: unknown
    try {
      payload = JSON.parse(await readStdin())
    } catch (error) {
      // The message of a JSON syntax error quotes the text it choked on: the payload stays out of every log.
      throw error instanceof SyntaxError ? new GuardPayloadError('the hook payload is not valid JSON') : error
    }
    const event = record(payload)
    if (!event) throw new GuardPayloadError('the hook payload is not an object')
    const cwd = typeof event.cwd === 'string' && isAbsolute(event.cwd) ? event.cwd : undefined
    project = cwd
    const toolName = typeof event.tool_name === 'string' ? event.tool_name : ''
    if (!GUARDED_TOOLS[host].includes(toolName)) return
    const decision = evaluateToolCall({
      host,
      toolName,
      command: commandOf(event.tool_input),
      ...(cwd ? { cwd } : {}),
      ...(typeof event.agent_id === 'string' && event.agent_id ? { agentId: event.agent_id } : {})
    })
    if (!decision) return
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.reason } })}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`sf agents guard: the call was let through (${message})\n`)
    try {
      const dir = await resolveLedgerDir(project ?? process.cwd())
      if (dir) await appendCaptureError(dir, { host, event: 'PreToolUse', stage: 'payload', message: `the guard hook let a call through: ${message}` })
    } catch {
      // The log is a courtesy: the line above is all there is outside a Git checkout.
    }
  }
}

/** Register `sf agents guard`. */
export function registerGuardCommand(agents: Command): void {
  agents
    .command('guard')
    .description(
      'Refuse the tool calls an agent must not make on its own (a bypass variable, a nature label, and, for a delegated agent, a merge); hook payload on stdin, run by the PreToolUse hook, never fails the host'
    )
    .requiredOption('--host <agent>', GUARD_HOSTS.join(' or '))
    .action((options: AgentsGuardOptions) => agentsGuard(options))
}
