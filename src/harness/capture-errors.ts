import { appendFile, lstat, open, readFile, rename, unlink, writeFile } from 'fs/promises'
import { join } from 'path'

import { withLock } from './delegation-ledger'

/**
 * The capture error log (#1105): where a delegation capture that went wrong leaves a trace. The host hooks
 * run `sf agents outcome capture` with its output discarded and an exit code of 0, so a payload that cannot be
 * read, a ledger that cannot be written or a routing adjustment that was skipped used to vanish: the routing
 * learned from fewer outcomes and nobody knew. Each failure is now one line here, next to the ledger, and
 * `sf status` and `sf agents routing report` count the recent ones.
 *
 * The file lives in the Git directory of the clone (`<git-common-dir>/saasfoundry/`), like the ledger: never
 * tracked, shared by every worktree. It holds no payload content and no host agent id, only what the capture
 * itself says about the failure, and it is bounded: past 64 KiB it keeps its last 200 lines.
 *
 * Everything here is best effort. Logging a failure must never become a failure of the hook.
 */
export const CAPTURE_ERRORS_FILE = 'capture-errors.jsonl'
export const CAPTURE_ERROR_STAGES = ['payload', 'ledger', 'adjustment', 'ignored'] as const
export type CaptureErrorStage = (typeof CAPTURE_ERROR_STAGES)[number]

/** `sf status` counts the errors of this many days: an old failure must not warn for ever. */
export const CAPTURE_ERROR_WINDOW_DAYS = 7
const DAY_MS = 24 * 60 * 60_000
const LOCK_NAME = 'capture-errors.lock'
/** A hook has a 30 s timeout and the log is a courtesy: give up on the lock early. */
const LOCK_WAIT_MS = 2_000
const MAX_BYTES = 64 * 1024
const KEEP_LINES = 200
/** A larger file (a trim that kept failing) is read from its tail only. */
const MAX_READ_BYTES = 256 * 1024
const MAX_MESSAGE = 300

export interface CaptureErrorEntry {
  v: 1
  at: string
  host: string
  /** The hook event the payload named, or `unknown`: a short word, never payload text. */
  event: string
  stage: CaptureErrorStage
  message: string
}

export type CaptureErrorInput = Pick<CaptureErrorEntry, 'host' | 'event' | 'stage' | 'message'>

const ISO_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const WORD = /^[a-z][a-z-]{0,23}$/i
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const LONG_HEX = /\b[0-9a-f]{16,}\b/gi

/** One line of plain text: no control character, no host id, bounded. */
export function sanitizeCaptureMessage(message: unknown): string {
  const text = String(message ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(UUID, '<id>')
    .replace(LONG_HEX, '<id>')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text
}

async function refuseLink(file: string): Promise<void> {
  try {
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected a regular file for the capture error log, not a link or directory: ${file}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/**
 * Keep the last lines only: at most `KEEP_LINES`, and no more than half the size bound, so the next failure
 * does not trim again. Written whole then renamed, so a reader never sees half a file. Runs under the lock.
 */
async function trim(file: string): Promise<void> {
  const kept = (await readFile(file, 'utf8')).split('\n').filter(Boolean).slice(-KEEP_LINES)
  while (kept.length > 1 && Buffer.byteLength(kept.join('\n')) > MAX_BYTES / 2) kept.shift()
  const temporary = `${file}.${process.pid}.tmp`
  try {
    await writeFile(temporary, `${kept.join('\n')}\n`, { mode: 0o600 })
    await rename(temporary, file)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

/**
 * Append one failure to the log in `dir` (the clone-private directory that holds the ledger). Returns whether
 * the line was written; never throws.
 */
export async function appendCaptureError(dir: string, input: CaptureErrorInput, now: () => Date = () => new Date()): Promise<boolean> {
  try {
    const entry: CaptureErrorEntry = {
      v: 1,
      at: now().toISOString(),
      host: typeof input.host === 'string' && WORD.test(input.host) ? input.host : 'unknown',
      event: typeof input.event === 'string' && WORD.test(input.event) ? input.event : 'unknown',
      stage: (CAPTURE_ERROR_STAGES as readonly string[]).includes(input.stage) ? input.stage : 'payload',
      message: sanitizeCaptureMessage(input.message)
    }
    const file = join(dir, CAPTURE_ERRORS_FILE)
    await withLock(
      dir,
      async () => {
        await refuseLink(file)
        await appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
        if ((await lstat(file)).size > MAX_BYTES) await trim(file)
      },
      LOCK_NAME,
      LOCK_WAIT_MS
    )
    return true
  } catch {
    return false
  }
}

export interface CaptureErrorSummary {
  /** Errors logged since `since`. */
  count: number
  /** The start of the window, ISO-8601. */
  since: string
  /** The most recent error of the window. */
  last?: Pick<CaptureErrorEntry, 'at' | 'host' | 'event' | 'stage' | 'message'>
}

function parseEntry(line: string): CaptureErrorEntry | undefined {
  try {
    const value: unknown = JSON.parse(line)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const entry = value as Record<string, unknown>
    if (entry.v !== 1 || typeof entry.at !== 'string' || !ISO_MILLIS.test(entry.at)) return undefined
    if (typeof entry.stage !== 'string' || !(CAPTURE_ERROR_STAGES as readonly string[]).includes(entry.stage)) return undefined
    if (typeof entry.message !== 'string' || typeof entry.host !== 'string' || typeof entry.event !== 'string') return undefined
    return { v: 1, at: entry.at, host: entry.host, event: entry.event, stage: entry.stage as CaptureErrorStage, message: sanitizeCaptureMessage(entry.message) }
  } catch {
    // A torn or foreign line is not a reason to lose the others.
    return undefined
  }
}

/** The text of the log, or of its tail when it grew past what a read should cost. */
async function readLog(file: string): Promise<string> {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink()) return ''
  if (info.size <= MAX_READ_BYTES) return readFile(file, 'utf8')
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(MAX_READ_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, MAX_READ_BYTES, info.size - MAX_READ_BYTES)
    const text = buffer.subarray(0, bytesRead).toString('utf8')
    // The first line of a tail is cut somewhere.
    return text.slice(text.indexOf('\n') + 1)
  } finally {
    await handle.close()
  }
}

/** The window `sf status` reports on: the last `CAPTURE_ERROR_WINDOW_DAYS` days. */
export const captureErrorWindowStart = (now: Date = new Date()): Date => new Date(now.getTime() - CAPTURE_ERROR_WINDOW_DAYS * DAY_MS)

/**
 * How many errors the log holds since `since`, and the last one. A log that does not exist, or that cannot be
 * read, holds none: reporting it must never fail a status.
 */
export async function readCaptureErrors(dir: string, { since }: { since: Date }): Promise<CaptureErrorSummary> {
  const start = since.toISOString()
  let text = ''
  try {
    text = await readLog(join(dir, CAPTURE_ERRORS_FILE))
  } catch {
    return { count: 0, since: start }
  }
  let count = 0
  let last: CaptureErrorEntry | undefined
  for (const line of text.split('\n')) {
    if (!line) continue
    const entry = parseEntry(line)
    if (!entry || entry.at < start) continue
    count++
    if (!last || entry.at >= last.at) last = entry
  }
  return { count, since: start, ...(last ? { last: { at: last.at, host: last.host, event: last.event, stage: last.stage, message: last.message } } : {}) }
}
