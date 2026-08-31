import { createServer, Socket } from 'net'

import { run } from './run'

/**
 * Choosing the ports a generated project will run on.
 *
 * A taken port used to be a dead end: `sf new` stopped and told the user to shut the
 * other project down. Running two generated projects side by side is the whole point
 * of a scaffold generator, so the second `sf new` of the day failed by design (#584).
 *
 * Two rules govern everything below:
 *
 *   - an explicit flag is never overridden. The user said what they wanted; moving them
 *     off it silently is the tool disagreeing without saying so.
 *   - only defaults scan forward, and they scan around whatever the flags already claimed.
 */

/**
 * MinIO publishes two ports, and both were outside this file until #623.
 *
 * Epic #582 taught db, api and web to move when their default was taken. The S3 block was
 * left copying `9000:9000` and `9001:9001` straight out of the template, so a machine
 * already running another project's MinIO — the ordinary case this whole mechanism exists
 * for — got a container that could not bind and a console URL printed as a literal.
 */
export const DEFAULT_PORTS = { db: 5435, api: 3500, web: 5173, s3: 9000, s3Console: 9001 } as const

const MAX_PORT = 65535

export type PortName = keyof typeof DEFAULT_PORTS

/** The ports every project has, whatever it was configured with. */
export type AlwaysPortName = 'db' | 'api' | 'web'

/** Ports that exist only when the project hosts its own object storage. */
export type StoragePortName = 's3' | 's3Console'

export interface ResolvedPort {
  port: number
  /** The default this port was moved off, when it was chosen by scanning. Absent when nothing moved. */
  movedFrom?: number
}

/**
 * The storage ports are optional rather than always present: a project on `--s3-setup
 * credentials` points at somebody else's bucket, and inventing a local port for it would
 * be the same lie #584 removed from the database line.
 */
export type ResolvedPorts = Record<AlwaysPortName, ResolvedPort> & Partial<Record<StoragePortName, ResolvedPort>>

export interface ResolvePortsParams {
  /** Only a `docker` database owns a local port. Under `credentials`/`manual` it belongs to someone else's server. */
  dbSetup: 'docker' | 'credentials' | 'manual'
  /** Same rule for storage: only a `docker` MinIO publishes ports on this machine. */
  s3Setup?: 'docker' | 'credentials' | 'manual'
  /** Raw `--db-port` / `--api-port` / `--web-port` values, before any defaulting. */
  requested?: Partial<Record<PortName, string>>
  /** How far a default may walk before giving up. */
  scanLimit?: number
  /** Starting points for the scan. Production uses `DEFAULT_PORTS`; tests pin a quiet range. */
  defaults?: Partial<Record<PortName, number>>
}

/** The name of the container publishing this port, or null when no container does. */
export function containerOnPort(port: number): string | null {
  const result = run(`docker ps --format '{{.Names}}\t{{.Ports}}'`)
  if (result.code !== 0) return null
  for (const line of result.stdout.split('\n')) {
    const [name, ports] = line.split('\t')
    if (name && ports && ports.includes(`:${port}->`)) return name
  }
  return null
}

/**
 * The addresses a local server plausibly binds, and which a probe must therefore try.
 *
 * No single one of them is enough, measured on a real machine: a dev server on
 * `[::1]:5173` is invisible to a `0.0.0.0` bind, and a dual-stack listener on `:::3500`
 * is invisible to a `127.0.0.1` one. Node sets SO_REUSEADDR, so binding a wildcard while
 * a specific address is held succeeds — the wildcard alone under-reports.
 */
const PROBE_HOSTS = ['0.0.0.0', '127.0.0.1', '::', '::1'] as const

type ProbeResult = 'free' | 'taken' | 'unavailable'

function probe(port: number, host: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', (error: NodeJS.ErrnoException) => {
      // Only "someone already has it" means taken. Any other failure — most often no IPv6
      // on this machine — says the address family is absent, not that the port is held.
      // Reading those as taken would make every port look occupied and every scan fail.
      resolve(error.code === 'EADDRINUSE' || error.code === 'EACCES' ? 'taken' : 'unavailable')
    })
    server.once('listening', () => server.close(() => resolve('free')))
    server.listen(port, host)
  })
}

/**
 * Whether the port can actually be taken, asked by trying to take it.
 *
 * `docker ps` only answers "does a container publish this". A colleague's `npm run dev`,
 * a system Postgres or another dev server hold a port just as effectively and appear
 * nowhere in that list — the bind is what catches them.
 */
export async function isPortFree(port: number): Promise<boolean> {
  for (const host of PROBE_HOSTS) {
    if ((await probe(port, host)) === 'taken') return false
  }
  return true
}

/**
 * Whether something is listening, asked by connecting to it.
 *
 * The mirror of `isPortFree`, and the two must not be confused: a bind answers "may I take
 * this port", a connect answers "is a service there". Using the first to check a database
 * reports a running one as down and a stopped one as fine — exactly backwards.
 */
export function canConnect(port: number, timeoutMs = 600, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket()
    const settle = (answer: boolean) => {
      socket.destroy()
      resolve(answer)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => settle(true))
    socket.once('timeout', () => settle(false))
    socket.once('error', () => settle(false))
    socket.connect(port, host)
  })
}

/** Poll until the port answers, or give up. Bounded, never a sleep-and-hope. */
export async function waitForPort(port: number, timeoutSeconds: number): Promise<boolean> {
  const deadline = Date.now() + timeoutSeconds * 1000
  while (Date.now() < deadline) {
    if (await canConnect(port)) return true
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

function parsePort(value: string, flag: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw new Error(`${flag} must be a port number between 1 and ${MAX_PORT}, got "${value}".`)
  }
  return port
}

function takenBy(port: number): string {
  const container = containerOnPort(port)
  return container ? `container "${container}"` : 'another process'
}

/**
 * Resolve the three host ports a project will use, before a single file is written.
 *
 * Explicit flags are claimed first and never move, so a default scanning forward can
 * never land on a port another flag already asked for.
 */
export async function resolvePorts({ dbSetup, s3Setup, requested = {}, scanLimit = 50, defaults = {} }: ResolvePortsParams): Promise<ResolvedPorts> {
  const claimed = new Set<number>()
  const resolved = {} as ResolvedPorts

  // The storage ports are only resolved when this project publishes them. Under
  // `credentials` the bucket lives on someone else's host and has no local port to choose;
  // omitting them keeps every reader from printing a number that means nothing.
  const hostsStorage = s3Setup === 'docker'
  const names: PortName[] = hostsStorage ? ['db', 'api', 'web', 's3', 's3Console'] : ['db', 'api', 'web']

  // A database the project does not host is not ours to move: `--db-port 6543` against a
  // Supabase pooler is a remote port, and scanning forward from it would silently point
  // the project at a machine that has nothing to do with the one it named.
  const isLocal = (name: PortName) => name !== 'db' || dbSetup === 'docker'

  // Pass 1 — explicit flags. Taken means an error, never a move.
  for (const name of names) {
    const raw = requested[name]
    if (raw === undefined) continue

    const port = parsePort(raw, `--${name}-port`)
    resolved[name] = { port }

    // A remote database's port is not a local allocation. Reserving it would push the API
    // off a port nothing on this machine is holding, and make it announce a move that
    // never happened.
    if (!isLocal(name)) continue

    claimed.add(port)
    if (await isPortFree(port)) continue

    throw new Error(
      `Port ${port} is already in use by ${takenBy(port)}.\n` + `It was requested explicitly with --${name}-port, so it will not be moved.\n` + `Free that port, or ask for a different one.`
    )
  }

  // Pass 2 — defaults, which walk forward until they find room.
  for (const name of names) {
    if (resolved[name]) continue

    const start = defaults[name] ?? DEFAULT_PORTS[name]
    if (!isLocal(name)) {
      resolved[name] = { port: start }
      continue
    }

    // Stopping at MAX_PORT is not cosmetic: `listen(65536)` throws ERR_SOCKET_BAD_PORT
    // synchronously, so walking off the end would surface a socket error instead of the
    // "no free port in this range" this loop exists to report.
    const last = Math.min(start + scanLimit - 1, MAX_PORT)

    let chosen: number | undefined
    for (let port = start; port <= last; port++) {
      if (claimed.has(port)) continue
      if (!(await isPortFree(port))) continue
      chosen = port
      break
    }

    if (chosen === undefined) {
      throw new Error(`Could not find a free ${name} port between ${start} and ${last}.\n` + `Free one of them, or pass --${name}-port <port> to say which one to use.`)
    }

    resolved[name] = chosen === start ? { port: chosen } : { port: chosen, movedFrom: start }
    claimed.add(chosen)
  }

  return resolved
}
