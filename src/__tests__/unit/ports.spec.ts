import { createServer, Server } from 'node:net'

import { DEFAULT_PORTS, isPortFree, resolvePorts } from '../../ports'

/**
 * #584 — a taken port stopped `sf new` and told the user to shut the other project down.
 *
 * The tests below hold real ports rather than mocking the probe: the thing being checked
 * is whether a port can be taken, and a stub that answers that question is a stub of the
 * answer, not of the world. `run` is mocked only so `docker ps` never has to exist.
 */

jest.mock('../../run', () => ({ run: jest.fn(() => ({ code: 1, stdout: '', stderr: '' })) }))

const held: Server[] = []

/**
 * #963 — the ports used to be literals between 43500 and 49032. On Linux that is inside the
 * ephemeral range (32768–60999): any outgoing connection on a CI runner can hold one as its
 * local port, and a test failed with EADDRINUSE before asserting anything. Each test now
 * works in a run of ports the OS handed out and that was verified free just before.
 */
const RUN_LENGTH = 60

function canBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'EAFNOSUPPORT' || error.code === 'EADDRNOTAVAIL'))
    server.listen(port, host, () => server.close(() => resolve(true)))
  })
}

function osPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '0.0.0.0', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })
}

async function freeRun(length: number): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const start = await osPort()
    if (start + length > 65000) continue
    let free = true
    for (let port = start; port < start + length && free; port++) {
      free = (await canBind(port, '0.0.0.0')) && (await canBind(port, '::'))
    }
    if (free) return start
  }
  throw new Error(`No run of ${length} free ports found`)
}

// Every port a test touches is an offset from P, set before each test.
let P = 0
let BASE = { db: 0, api: 0, web: 0 }

beforeEach(async () => {
  P = await freeRun(RUN_LENGTH)
  BASE = { db: P, api: P + 10, web: P + 20 }
})

function hold(port: number, host = '0.0.0.0'): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, host, () => {
      held.push(server)
      resolve()
    })
  })
}

afterEach(async () => {
  await Promise.all(held.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))))
})

const resolve = (params: Partial<Parameters<typeof resolvePorts>[0]> = {}) => resolvePorts({ dbSetup: 'docker', defaults: BASE, ...params })

describe('a free default is kept as it is', () => {
  it('returns the defaults untouched, and says nothing moved', async () => {
    const ports = await resolve()

    expect(ports.db.port).toBe(BASE.db)
    expect(ports.api.port).toBe(BASE.api)
    expect(ports.web.port).toBe(BASE.web)
    expect(ports.db.movedFrom).toBeUndefined()
    expect(ports.api.movedFrom).toBeUndefined()
    expect(ports.web.movedFrom).toBeUndefined()
  })

  it('starts from 5435 / 3500 / 5173 when nothing overrides them', () => {
    // MinIO's two ports joined in #623: they were the only published ports still copied
    // out of the template untouched.
    expect(DEFAULT_PORTS).toEqual({ db: 5435, api: 3500, web: 5173, s3: 9000, s3Console: 9001 })
  })
})

describe('a taken default moves to the next free port', () => {
  it('walks forward and reports what it moved off', async () => {
    await hold(BASE.api)

    const ports = await resolve()

    expect(ports.api.port).toBe(BASE.api + 1)
    expect(ports.api.movedFrom).toBe(BASE.api)
    // The others were free and must not have drifted along with it.
    expect(ports.db.port).toBe(BASE.db)
    expect(ports.web.port).toBe(BASE.web)
  })

  it('walks past a run of taken ports', async () => {
    await hold(BASE.web)
    await hold(BASE.web + 1)
    await hold(BASE.web + 2)

    const { web } = await resolve()

    expect(web.port).toBe(BASE.web + 3)
    expect(web.movedFrom).toBe(BASE.web)
  })

  it('gives up loudly rather than scanning forever', async () => {
    await hold(BASE.web)
    await hold(BASE.web + 1)

    await expect(resolve({ scanLimit: 2 })).rejects.toThrow(new RegExp(`Could not find a free web port between ${BASE.web} and ${BASE.web + 1}`))
  })
})

describe('an explicit flag is honoured or refused, never moved', () => {
  it('uses the requested port when it is free', async () => {
    const { api } = await resolve({ requested: { api: String(P + 30) } })

    expect(api.port).toBe(P + 30)
    expect(api.movedFrom).toBeUndefined()
  })

  it('fails instead of quietly picking another one', async () => {
    await hold(P + 30)

    await expect(resolve({ requested: { api: String(P + 30) } })).rejects.toThrow(new RegExp(`Port ${P + 30} is already in use by another process`))
    await expect(resolve({ requested: { api: String(P + 30) } })).rejects.toThrow(/requested explicitly with --api-port, so it will not be moved/)
  })

  it('rejects a value that is not a port', async () => {
    await expect(resolve({ requested: { web: 'quatre-mille' } })).rejects.toThrow(/--web-port must be a port number between 1 and 65535/)
    await expect(resolve({ requested: { web: '70000' } })).rejects.toThrow(/--web-port must be a port number between 1 and 65535/)
  })
})

describe('the three ports are resolved against each other', () => {
  it('a scanning default never lands on a port a flag already claimed', async () => {
    await hold(BASE.api)

    // The api default is taken and would walk onto BASE.api + 1 — which the web flag holds.
    const ports = await resolve({ requested: { web: String(BASE.api + 1) } })

    expect(ports.web.port).toBe(BASE.api + 1)
    expect(ports.api.port).toBe(BASE.api + 2)
    expect(ports.api.movedFrom).toBe(BASE.api)
  })
})

describe('a database the project does not host is not ours to move', () => {
  it.each(['credentials', 'manual'] as const)('leaves an explicit %s port alone even when something local holds it', async (dbSetup) => {
    await hold(P + 31)

    const { db } = await resolve({ dbSetup, requested: { db: String(P + 31) } })

    expect(db.port).toBe(P + 31)
    expect(db.movedFrom).toBeUndefined()
  })

  it('keeps the default without probing for it', async () => {
    await hold(BASE.db)

    const { db } = await resolve({ dbSetup: 'credentials' })

    expect(db.port).toBe(BASE.db)
    expect(db.movedFrom).toBeUndefined()
  })

  it('does not reserve it against the local ports', async () => {
    // A Supabase pooler that happens to sit on the API's default port is on another
    // machine. Reserving it would push the API to the next port and make it announce a
    // move that nothing local caused.
    const ports = await resolve({ dbSetup: 'credentials', requested: { db: String(BASE.api) } })

    expect(ports.db.port).toBe(BASE.api)
    expect(ports.api.port).toBe(BASE.api)
    expect(ports.api.movedFrom).toBeUndefined()
  })
})

describe('the scan stops at the end of the port range', () => {
  it('reports the range it searched rather than throwing a socket error', async () => {
    // `listen(65536)` throws ERR_SOCKET_BAD_PORT synchronously, so a scan that walked off
    // the end surfaced that instead of the message this loop exists to produce.
    await hold(65534)
    await hold(65535)

    await expect(resolve({ defaults: { web: 65534 }, scanLimit: 50 })).rejects.toThrow(/Could not find a free web port between 65534 and 65535/)
  })
})

describe('isPortFree answers by trying to take the port', () => {
  it('sees a listener that no container publishes', async () => {
    await hold(P + 32)

    expect(await isPortFree(P + 32)).toBe(false)
  })

  it('reports a quiet port as free, and does not keep it', async () => {
    expect(await isPortFree(P + 33)).toBe(true)
    expect(await isPortFree(P + 33)).toBe(true)
  })

  /**
   * Measured on a real machine, and the reason this probe is a loop rather than one bind:
   * a dev server on `[::1]:5173` was reported free by a `0.0.0.0` probe, and a dual-stack
   * listener on `:::3500` is reported free by a `127.0.0.1` one. Node sets SO_REUSEADDR,
   * so binding a wildcard while a specific address is held succeeds.
   */
  it.each([
    ['the IPv4 wildcard', '0.0.0.0'],
    ['IPv4 loopback only', '127.0.0.1'],
    ['the IPv6 wildcard', '::'],
    ['IPv6 loopback only', '::1']
  ])('sees a listener bound to %s', async (_label, host) => {
    try {
      await hold(P + 34, host)
    } catch {
      // No IPv6 on this machine — nothing to detect, and nothing this test can assert.
      return
    }

    expect(await isPortFree(P + 34)).toBe(false)
  })

  it('does not read a missing address family as a holder', async () => {
    // Every probe host must be attempted; an unbindable one contributes nothing either way.
    expect(await isPortFree(P + 35)).toBe(true)
  })
})

/**
 * #623 — Epic #582 moved db, api and web off a taken default and named the move. MinIO was
 * left out, so a machine already running another project's storage got `Bind for
 * 0.0.0.0:9000 failed: port is already allocated` and a console URL printed as a literal.
 *
 * Real listeners again, for the same reason as above: the question is whether a port can be
 * taken, and a stub of that answer is a stub of the world.
 */
describe('storage ports are resolved like every other published port (#623)', () => {
  it('is silent about storage when the project does not host it', async () => {
    const resolved = await resolvePorts({ dbSetup: 'docker', s3Setup: 'credentials', defaults: BASE })
    // A bucket on someone else's host has no local port to choose, and inventing one would
    // print a number that means nothing.
    expect(resolved.s3).toBeUndefined()
    expect(resolved.s3Console).toBeUndefined()
  })

  it('resolves both published ports when the project hosts its own MinIO', async () => {
    const resolved = await resolvePorts({ dbSetup: 'docker', s3Setup: 'docker', defaults: { ...BASE, s3: P + 40, s3Console: P + 41 } })
    expect(resolved.s3?.port).toBe(P + 40)
    expect(resolved.s3Console?.port).toBe(P + 41)
    expect(resolved.s3?.movedFrom).toBeUndefined()
  })

  it('moves off a taken storage port and says which default it left', async () => {
    await hold(P + 42)
    const resolved = await resolvePorts({ dbSetup: 'docker', s3Setup: 'docker', defaults: { ...BASE, s3: P + 42, s3Console: P + 44 } })
    expect(resolved.s3?.port).toBe(P + 43)
    expect(resolved.s3?.movedFrom).toBe(P + 42)
  })

  it('never lands the console on the port the S3 API just moved to', async () => {
    // The two defaults are adjacent, so a naive scan would hand 9001 to both.
    await hold(P + 50)
    const resolved = await resolvePorts({ dbSetup: 'docker', s3Setup: 'docker', defaults: { ...BASE, s3: P + 50, s3Console: P + 51 } })
    expect(resolved.s3?.port).toBe(P + 51)
    expect(resolved.s3Console?.port).not.toBe(resolved.s3?.port)
    expect(resolved.s3Console?.port).toBe(P + 52)
  })
})
