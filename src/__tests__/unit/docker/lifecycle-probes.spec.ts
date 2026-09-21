import { validateApiHealth, validateWebDocument, waitForHttpProbe } from '../../../../tests/docker/lifecycle/probes'

describe('lifecycle HTTP probes', () => {
  it('retries until a strict API health document is ready', async () => {
    let calls = 0
    const fetch = jest.fn(async () => {
      calls += 1
      return calls === 1
        ? new Response('{"status":"error"}', { status: 503, headers: { 'content-type': 'application/json' } })
        : new Response('{"status":"ok","info":{"app":{"status":"up"}}}', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof globalThis.fetch

    const result = await waitForHttpProbe({ label: 'api', url: 'http://127.0.0.1:3500/api/health', deadline: Date.now() + 1_000, intervalMs: 1, fetch, validate: validateApiHealth })
    expect(result).toMatchObject({ attempts: 2, status: 200 })
  })

  it('rejects an HTML-shaped success for the API and a JSON-shaped success for the web app', () => {
    expect(() => validateApiHealth(new Response('<html></html>', { status: 200 }), '<html></html>')).toThrow(/JSON/)
    expect(() => validateWebDocument(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }), '{"ok":true}')).toThrow(/HTML/)
  })

  it('honors aborts while polling', async () => {
    const controller = new AbortController()
    controller.abort(new Error('phase cancelled'))
    await expect(
      waitForHttpProbe({ label: 'web', url: 'http://127.0.0.1:5173', deadline: Date.now() + 1_000, signal: controller.signal, fetch: jest.fn() as never, validate: validateWebDocument })
    ).rejects.toThrow('phase cancelled')
  })

  it('rejects non-loopback targets and bounds response bodies', async () => {
    await expect(waitForHttpProbe({ label: 'api', url: 'http://localhost:3500/api/health', deadline: Date.now() + 100, fetch: jest.fn() as never, validate: validateApiHealth })).rejects.toThrow(
      /127\.0\.0\.1/
    )

    const fetch = jest.fn(async () => new Response('{"status":"ok","padding":"xxxxxxxx"}', { status: 200 })) as unknown as typeof globalThis.fetch
    await expect(
      waitForHttpProbe({ label: 'api', url: 'http://127.0.0.1:3500/api/health', deadline: Date.now() + 20, intervalMs: 1, maxBodyBytes: 8, fetch, validate: validateApiHealth })
    ).rejects.toThrow(/body limit/)
  })
})
