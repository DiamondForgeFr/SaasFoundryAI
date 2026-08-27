import { createServer } from 'net'

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

export const DEFAULT_PORTS = { db: 5435, api: 3500, web: 5173 } as const

export type PortName = keyof typeof DEFAULT_PORTS

export interface ResolvedPort {
  port: number
  /** The default this port was moved off, when it was chosen by scanning. Absent when nothing moved. */
  movedFrom?: number
}

export type ResolvedPorts = Record<PortName, ResolvedPort>

export interface ResolvePortsParams {
  /** Only a `docker` database owns a local port. Under `credentials`/`manual` it belongs to someone else's server. */
  dbSetup: 'docker' | 'credentials' | 'manual'
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
 * Whether the port can actually be taken, asked by trying to take it.
 *
 * `docker ps` only answers "does a container publish this". A colleague's `npm run dev`,
 * a system Postgres or another dev server hold a port just as effectively and appear
 * nowhere in that list — the bind is what catches them.
 */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '0.0.0.0')
  })
}

function parsePort(value: string, flag: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${flag} must be a port number between 1 and 65535, got "${value}".`)
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
export async function resolvePorts({ dbSetup, requested = {}, scanLimit = 50, defaults = {} }: ResolvePortsParams): Promise<ResolvedPorts> {
  const claimed = new Set<number>()
  const resolved = {} as ResolvedPorts

  const names: PortName[] = ['db', 'api', 'web']

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
    claimed.add(port)

    if (!isLocal(name)) continue
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

    let chosen: number | undefined
    for (let port = start; port < start + scanLimit; port++) {
      if (claimed.has(port)) continue
      if (!(await isPortFree(port))) continue
      chosen = port
      break
    }

    if (chosen === undefined) {
      throw new Error(`Could not find a free ${name} port between ${start} and ${start + scanLimit - 1}.\n` + `Free one of them, or pass --${name}-port <port> to say which one to use.`)
    }

    resolved[name] = chosen === start ? { port: chosen } : { port: chosen, movedFrom: start }
    claimed.add(chosen)
  }

  return resolved
}
