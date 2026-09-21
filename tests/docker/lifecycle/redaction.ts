import { StringDecoder } from 'node:string_decoder'

const ANSI_ESCAPE = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
const AUTHORIZATION = /\b(authorization\s*[:=]\s*)(?:basic|bearer)?\s*[^\s,;]+/gi
const COOKIE = /\b((?:set-)?cookie\s*[:=]\s*)[^\r\n]*/gi
const PASSWORD_URL = /\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+(@)/gi
const SENSITIVE_ASSIGNMENT = /\b((?:api[_-]?key|access[_-]?token|auth(?:orization)?|cookie|password|passwd|secret|token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi
const SENSITIVE_JSON = /("(?:api[_-]?key|access[_-]?token|auth(?:orization)?|cookie|password|passwd|secret|token)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi
const SENSITIVE_QUERY = /([?&](?:api[_-]?key|access[_-]?token|auth|authorization|cookie|password|secret|token)=)[^&#\s]*/gi

export interface StreamingRedactorOptions {
  secrets?: readonly string[]
  maxRetainedBytes?: number
  /** An unterminated record larger than this is replaced as a unit rather than emitted unsafely. */
  maxPendingBytes?: number
}

export interface RedactedCapture {
  text: string
  observedBytes: number
  retainedBytes: number
  truncated: boolean
  oversizedRecords: number
}

function exactSecrets(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0 && !/[\r\n]/.test(value)))].sort((left, right) => right.length - left.length)
}

/** Redact complete diagnostic text before it is retained or written. */
export function redactText(value: string, secrets: readonly string[] = []): string {
  let redacted = value
  for (const secret of exactSecrets(secrets)) redacted = redacted.split(secret).join('<redacted>')
  return redacted
    .replace(PASSWORD_URL, '$1<redacted>$2')
    .replace(AUTHORIZATION, '$1<redacted>')
    .replace(COOKIE, '$1<redacted>')
    .replace(SENSITIVE_JSON, '$1"<redacted>"')
    .replace(SENSITIVE_QUERY, '$1<redacted>')
    .replace(SENSITIVE_ASSIGNMENT, '$1<redacted>')
    .replace(JWT, '<redacted-jwt>')
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE, '')
}

/**
 * Line-buffered streaming redaction.
 *
 * Raw bytes exist only in the bounded carry buffer. Complete records are redacted before
 * entering the retained capture, which also means a secret split across arbitrary chunks
 * is treated as one value. An attacker cannot force an unbounded carry by omitting `\n`.
 */
export class StreamingRedactor {
  private readonly decoder = new StringDecoder('utf8')
  private readonly secrets: readonly string[]
  private readonly maxRetainedBytes: number
  private readonly maxPendingBytes: number
  private pending = ''
  private retained: Buffer[] = []
  private retainedBytes = 0
  private observedBytes = 0
  private wasTruncated = false
  private oversizedRecords = 0
  private ended = false
  private discardingOversizedRecord = false

  constructor(options: StreamingRedactorOptions = {}) {
    this.secrets = exactSecrets(options.secrets ?? [])
    this.maxRetainedBytes = positiveLimit(options.maxRetainedBytes ?? 64 * 1024, 'maxRetainedBytes')
    this.maxPendingBytes = positiveLimit(options.maxPendingBytes ?? 64 * 1024, 'maxPendingBytes')
  }

  /** Returns only newly retained, already-redacted text. */
  push(chunk: Buffer | string): string {
    if (this.ended) throw new Error('Cannot append to a finished diagnostic redactor.')
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    this.observedBytes += bytes.length
    this.pending += this.decoder.write(bytes)
    return this.flushCompleteRecords()
  }

  /** Finish UTF-8 decoding and redact the final unterminated record. */
  end(chunk?: Buffer | string): string {
    if (this.ended) return ''
    let emitted = ''
    if (chunk !== undefined) emitted += this.push(chunk)
    this.pending += this.decoder.end()
    emitted += this.flushCompleteRecords()
    if (this.discardingOversizedRecord) {
      this.pending = ''
    } else if (this.pending.length > 0) {
      const finalRecord = Buffer.byteLength(this.pending, 'utf8') > this.maxPendingBytes ? this.oversizedReplacement() : redactText(this.pending, this.secrets)
      this.pending = ''
      emitted += this.retain(finalRecord)
    }
    this.ended = true
    return emitted
  }

  snapshot(): RedactedCapture {
    return {
      text: Buffer.concat(this.retained, this.retainedBytes).toString('utf8'),
      observedBytes: this.observedBytes,
      retainedBytes: this.retainedBytes,
      truncated: this.wasTruncated,
      oversizedRecords: this.oversizedRecords
    }
  }

  private flushCompleteRecords(): string {
    let emitted = ''
    if (this.discardingOversizedRecord) {
      const newline = this.pending.indexOf('\n')
      if (newline === -1) {
        this.pending = ''
        return emitted
      }
      this.pending = this.pending.slice(newline + 1)
      this.discardingOversizedRecord = false
    }
    let newline = this.pending.indexOf('\n')
    while (newline !== -1) {
      const record = this.pending.slice(0, newline + 1)
      this.pending = this.pending.slice(newline + 1)
      const safe = Buffer.byteLength(record, 'utf8') > this.maxPendingBytes ? this.oversizedReplacement() : redactText(record, this.secrets)
      emitted += this.retain(safe)
      newline = this.pending.indexOf('\n')
    }
    if (Buffer.byteLength(this.pending, 'utf8') > this.maxPendingBytes) {
      this.pending = ''
      this.discardingOversizedRecord = true
      emitted += this.retain(this.oversizedReplacement())
    }
    return emitted
  }

  private oversizedReplacement(): string {
    this.oversizedRecords += 1
    this.wasTruncated = true
    return '<redacted oversized unterminated diagnostic record>\n'
  }

  private retain(value: string): string {
    if (value.length === 0 || this.retainedBytes >= this.maxRetainedBytes) {
      if (value.length > 0) this.wasTruncated = true
      return ''
    }
    const bytes = Buffer.from(value)
    const remaining = this.maxRetainedBytes - this.retainedBytes
    const accepted = bytes.length <= remaining ? bytes : bytes.subarray(0, remaining)
    if (accepted.length < bytes.length) this.wasTruncated = true
    this.retained.push(accepted)
    this.retainedBytes += accepted.length
    return accepted.toString('utf8')
  }
}

function positiveLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer.`)
  return value
}
