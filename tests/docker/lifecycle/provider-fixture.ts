import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'

const MAX_MESSAGES = 64
const MAX_BODY_BYTES = 128 * 1024

export interface CapturedMail {
  id: number
  to: string
  subject: string
  html: string
  text: string
  capturedAt: string
}

export interface ProviderFixture {
  readonly url: string
  readonly capability: string
  readonly messages: readonly CapturedMail[]
  reset(): void
  stop(): Promise<void>
}

export interface ProviderFixtureOptions {
  signal?: AbortSignal
}

export async function startProviderFixture(options: ProviderFixtureOptions = {}): Promise<ProviderFixture> {
  const capability = randomBytes(32).toString('hex')
  const messages: CapturedMail[] = []
  const server = createServer((request, response) => void handleRequest(request, response, capability, messages))
  server.maxHeadersCount = 32
  server.requestTimeout = 5_000
  server.headersTimeout = 5_000

  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => reject(error)
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', fail)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Lifecycle provider fixture did not expose a TCP address.')
  const abort = () => server.closeAllConnections()
  options.signal?.addEventListener('abort', abort, { once: true })
  let stopped = false

  return {
    url: `http://127.0.0.1:${address.port}`,
    capability,
    get messages() {
      return messages.map((message) => ({ ...message }))
    },
    reset: () => messages.splice(0),
    stop: async () => {
      if (stopped) return
      stopped = true
      options.signal?.removeEventListener('abort', abort)
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  }
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, capability: string, messages: CapturedMail[]): Promise<void> {
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  if (request.headers.authorization !== `Bearer ${capability}`) return send(response, 403, { error: 'forbidden' })
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')

  try {
    if (request.method === 'POST' && url.pathname === '/messages') {
      if (messages.length >= MAX_MESSAGES) return send(response, 429, { error: 'message-limit' })
      const value = assertMail(await readJson(request))
      const message: CapturedMail = { id: messages.length + 1, ...value, capturedAt: new Date().toISOString() }
      messages.push(message)
      return send(response, 201, { id: message.id })
    }
    if (request.method === 'GET' && url.pathname === '/messages') {
      const recipient = url.searchParams.get('to')
      const selected = recipient ? messages.filter((message) => message.to === recipient) : messages
      return send(response, 200, { messages: selected })
    }
    if (request.method === 'DELETE' && url.pathname === '/messages') {
      messages.splice(0)
      return send(response, 200, { reset: true })
    }
    return send(response, 404, { error: 'not-found' })
  } catch (error) {
    return send(response, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += value.byteLength
    if (bytes > MAX_BODY_BYTES) throw new Error('message-too-large')
    chunks.push(value)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function assertMail(value: unknown): Pick<CapturedMail, 'to' | 'subject' | 'html' | 'text'> {
  if (!value || typeof value !== 'object') throw new Error('invalid-message')
  const message = value as Record<string, unknown>
  const to = assertString(message.to, 'to', 320)
  const subject = assertString(message.subject, 'subject', 512)
  const html = assertString(message.html, 'html', MAX_BODY_BYTES)
  const text = assertString(message.text ?? '', 'text', MAX_BODY_BYTES)
  return { to, subject, html, text }
}

function assertString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`invalid-${name}`)
  return value
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status
  response.end(`${JSON.stringify(value)}\n`)
}
