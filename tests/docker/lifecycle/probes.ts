export interface HttpProbeOptions {
  label: string
  url: string
  deadline: number
  signal?: AbortSignal
  intervalMs?: number
  requestTimeoutMs?: number
  maxBodyBytes?: number
  fetch?: typeof fetch
  validate: (response: Response, body: string) => void | Promise<void>
}

export interface HttpProbeResult {
  attempts: number
  elapsedMs: number
  status: number
}

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error('Lifecycle probe aborted.')
}

async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError(signal)
  await new Promise<void>((resolve, reject) => {
    const finish = (operation: () => void) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      operation()
    }
    const timer = setTimeout(() => finish(resolve), ms)
    const abort = () => {
      finish(() => reject(abortError(signal)))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

async function fetchBounded(fetchImpl: typeof fetch, url: string, timeoutMs: number, parent?: AbortSignal): Promise<Response> {
  const controller = new AbortController()
  const abort = () => controller.abort(abortError(parent))
  parent?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error(`Request to ${url} timed out.`)), timeoutMs)
  try {
    return await fetchImpl(url, { signal: controller.signal, redirect: 'error', cache: 'no-store' })
  } finally {
    clearTimeout(timer)
    parent?.removeEventListener('abort', abort)
  }
}

export async function waitForHttpProbe(options: HttpProbeOptions): Promise<HttpProbeResult> {
  const started = Date.now()
  const fetchImpl = options.fetch ?? fetch
  const intervalMs = options.intervalMs ?? 250
  const requestTimeoutMs = options.requestTimeoutMs ?? 2_000
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024
  const target = new URL(options.url)
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') throw new Error(`${options.label} probe must use an explicit http://127.0.0.1 loopback URL.`)
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) throw new Error('Probe body limit must be a positive safe integer.')
  let attempts = 0
  let lastFailure = 'no request completed'

  while (Date.now() < options.deadline) {
    if (options.signal?.aborted) throw abortError(options.signal)
    attempts += 1
    try {
      const response = await fetchBounded(fetchImpl, options.url, Math.min(requestTimeoutMs, Math.max(1, options.deadline - Date.now())), options.signal)
      const body = await readBoundedBody(response, maxBodyBytes)
      await options.validate(response, body)
      return { attempts, elapsedMs: Date.now() - started, status: response.status }
    } catch (error) {
      if (options.signal?.aborted) throw abortError(options.signal)
      lastFailure = error instanceof Error ? error.message : String(error)
    }
    const remaining = options.deadline - Date.now()
    if (remaining > 0) await wait(Math.min(intervalMs, remaining), options.signal)
  }
  throw new Error(`${options.label} did not become ready before its deadline (${lastFailure}).`)
}

async function readBoundedBody(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) throw new Error(`Probe response declared more than ${limit} bytes.`)
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) throw new Error(`Probe response exceeded the ${limit}-byte body limit.`)
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export function validateApiHealth(response: Response, body: string): void {
  if (response.status !== 200) throw new Error(`API health returned HTTP ${response.status}.`)
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    throw new Error('API health did not return JSON.')
  }
  const health = value as { status?: unknown; info?: { app?: { status?: unknown } } }
  if (!value || typeof value !== 'object' || health.status !== 'ok') throw new Error('API health did not report status=ok.')
  if (health.info?.app?.status !== 'up') throw new Error('API health did not report info.app.status=up.')
}

export function validateWebDocument(response: Response, body: string): void {
  if (response.status !== 200) throw new Error(`Web root returned HTTP ${response.status}.`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('text/html')) throw new Error(`Web root returned ${contentType || 'no content type'} instead of HTML.`)
  if (!/<(?:html|div\s+id=["']root["'])/i.test(body)) throw new Error('Web root did not contain an application document.')
}
