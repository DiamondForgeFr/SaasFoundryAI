import { execFile } from 'child_process'
import { access } from 'fs/promises'
import { join } from 'path'

import { COMPLEXITIES, NATURES, type Complexity, type Nature } from './delegation-ledger'
import { readManifest } from '../utils'

/**
 * What a ticket says about itself, read through the workflow tool the project configured (#1105). A route record
 * (`sf agents route --record`) carries the ticket's `complexity` and `nature`, and the routing report groups its
 * evidence by them. The documented form of the command names a ticket and no `--complexity`, and sessions copy it:
 * the records then said "unknown". The command now asks the ticket, and says so when it cannot.
 *
 * The labels come from the tool CLI the workflow itself uses (`.claude/skills/sf-tool-<tool>/<tool>-cli.sh
 * get-labels <n>`, one label per line), so the project has one way to read a ticket. Only the GitHub Projects CLI
 * has that command today; the others answer "unknown", as the workflow's own complexity guard does.
 */
const COMPLEXITY_LABEL = /^complexity: (bug|low|medium|complex)$/
const NATURE_LABEL = /^nature:(user-facing|internal|bundled-pr)$/
const TOOL_NAME = /^[a-z][a-z0-9-]*$/
/** A label read is a courtesy to the delegation: it does not hold it up for longer than this. */
export const LABEL_READ_TIMEOUT_MS = 10_000

export interface TicketLabels {
  complexity: Complexity | null
  nature: Nature | null
}

export type TicketLabelsResult = ({ ok: true } & TicketLabels) | { ok: false; reason: string }

/** Run a program and return its standard output; rejects with the failure. Injectable, so a spec starts no process. */
export type LabelExec = (file: string, args: readonly string[], options: { cwd: string; timeout: number }) => Promise<string>

export const defaultLabelExec: LabelExec = (file, args, options) =>
  new Promise((resolve, reject) => {
    const child = execFile(file, [...args], { cwd: options.cwd, timeout: options.timeout, encoding: 'utf8', maxBuffer: 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
    // A command that reads its input must not wait for ours.
    child.stdin?.end()
  })

function failure(error: unknown, command: string): string {
  const failed = error as { code?: unknown; killed?: boolean; signal?: string | null }
  if (failed.killed || failed.signal === 'SIGTERM') return `${command} did not answer within ${LABEL_READ_TIMEOUT_MS / 1000} s`
  if (failed.code === 'ENOENT') return `${command} could not be started`
  return typeof failed.code === 'number' ? `${command} exited with code ${failed.code}` : `${command} failed`
}

/** The tool CLI of the project's workflow tool, from the Claude Code skills and then the shared `.agents` ones. */
async function toolCli(root: string, tool: string): Promise<string | undefined> {
  for (const base of ['.claude', '.agents']) {
    const candidate = join(base, 'skills', `sf-tool-${tool}`, `${tool}-cli.sh`)
    try {
      await access(join(root, candidate))
      return candidate
    } catch {
      // Next location.
    }
  }
  return undefined
}

/**
 * The `complexity:` and `nature:` labels of a ticket. A failure is a value, never a throw: `reason` says what
 * could not be done, for a warning, and a ticket that simply has no such label reads as `null`.
 */
export async function readTicketLabels(root: string, ticket: number, { exec = defaultLabelExec }: { exec?: LabelExec } = {}): Promise<TicketLabelsResult> {
  const tool = (await readManifest(root))?.workflow?.tool
  if (typeof tool !== 'string' || !tool || tool === 'none') return { ok: false, reason: 'no workflow tool is configured in .saasfoundry.json' }
  if (!TOOL_NAME.test(tool)) return { ok: false, reason: `the workflow tool ${JSON.stringify(tool)} is not a tool name` }
  const cli = await toolCli(root, tool)
  if (!cli) return { ok: false, reason: `the ${tool} tool CLI was not found at .claude/skills/sf-tool-${tool}/${tool}-cli.sh` }
  const command = `${cli} get-labels ${ticket}`
  let stdout: string
  try {
    stdout = await exec('bash', [cli, 'get-labels', String(ticket)], { cwd: root, timeout: LABEL_READ_TIMEOUT_MS })
  } catch (error) {
    return { ok: false, reason: failure(error, command) }
  }
  const labels = stdout.split('\n').map((line) => line.trim())
  const complexity = labels.map((label) => COMPLEXITY_LABEL.exec(label)?.[1]).find((value) => value !== undefined)
  const nature = labels.map((label) => NATURE_LABEL.exec(label)?.[1]).find((value) => value !== undefined)
  return {
    ok: true,
    complexity: (COMPLEXITIES as readonly string[]).includes(complexity ?? '') ? (complexity as Complexity) : null,
    nature: (NATURES as readonly string[]).includes(nature ?? '') ? (nature as Nature) : null
  }
}

export type FactSource = 'flag' | 'label'

/** The complexity and nature a route record is issued with, where each came from, and what the command has to say. */
export interface RouteFacts {
  complexity: Complexity | null
  complexitySource: FactSource | null
  nature: Nature | null
  natureSource: FactSource | null
  /** One line per value the command could not find: it goes to stderr, and the record carries none. */
  warnings: string[]
}

/**
 * What `sf agents route --record` records for the ticket it serves. A flag wins over the label, and a ticket whose
 * facts are all given is not asked. Without a ticket there is nothing to ask. The command fails open: whatever goes
 * wrong reading the ticket leaves the value unknown and says why, it never holds up a delegation. Only a missing
 * complexity is reported: a ticket with no `nature:` label is the default one, not a gap.
 */
export async function resolveRouteFacts(
  root: string,
  input: { ticket: number | null; complexity?: Complexity | null; nature?: Nature | null },
  { exec }: { exec?: LabelExec } = {}
): Promise<RouteFacts> {
  const facts: RouteFacts = {
    complexity: input.complexity ?? null,
    complexitySource: input.complexity ? 'flag' : null,
    nature: input.nature ?? null,
    natureSource: input.nature ? 'flag' : null,
    warnings: []
  }
  if (input.ticket === null || (facts.complexity !== null && facts.nature !== null)) return facts
  const read = await readTicketLabels(root, input.ticket, { exec })
  if (!read.ok) {
    if (facts.complexity === null) facts.warnings.push(`the complexity of #${input.ticket} could not be read (${read.reason}): the route record carries none; pass --complexity <level>`)
    return facts
  }
  if (facts.complexity === null) {
    if (read.complexity) Object.assign(facts, { complexity: read.complexity, complexitySource: 'label' })
    else facts.warnings.push(`the complexity of #${input.ticket} could not be read (the ticket has no complexity label): the route record carries none; pass --complexity <level>`)
  }
  if (facts.nature === null && read.nature) Object.assign(facts, { nature: read.nature, natureSource: 'label' })
  return facts
}
