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

// A quiet range, far from anything this machine is likely to be running.
const BASE = { db: 45435, api: 43500, web: 45173 }

const held: Server[] = []

function hold(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, '0.0.0.0', () => {
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
    expect(DEFAULT_PORTS).toEqual({ db: 5435, api: 3500, web: 5173 })
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

    await expect(resolve({ scanLimit: 2 })).rejects.toThrow(/Could not find a free web port between 45173 and 45174/)
  })
})

describe('an explicit flag is honoured or refused, never moved', () => {
  it('uses the requested port when it is free', async () => {
    const { api } = await resolve({ requested: { api: '43999' } })

    expect(api.port).toBe(43999)
    expect(api.movedFrom).toBeUndefined()
  })

  it('fails instead of quietly picking another one', async () => {
    await hold(43999)

    await expect(resolve({ requested: { api: '43999' } })).rejects.toThrow(/Port 43999 is already in use by another process/)
    await expect(resolve({ requested: { api: '43999' } })).rejects.toThrow(/requested explicitly with --api-port, so it will not be moved/)
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
    await hold(46543)

    const { db } = await resolve({ dbSetup, requested: { db: '46543' } })

    expect(db.port).toBe(46543)
    expect(db.movedFrom).toBeUndefined()
  })

  it('keeps the default without probing for it', async () => {
    await hold(BASE.db)

    const { db } = await resolve({ dbSetup: 'credentials' })

    expect(db.port).toBe(BASE.db)
    expect(db.movedFrom).toBeUndefined()
  })
})

describe('isPortFree answers by trying to take the port', () => {
  it('sees a listener that no container publishes', async () => {
    await hold(46000)

    expect(await isPortFree(46000)).toBe(false)
  })

  it('reports a quiet port as free, and does not keep it', async () => {
    expect(await isPortFree(46001)).toBe(true)
    expect(await isPortFree(46001)).toBe(true)
  })
})
