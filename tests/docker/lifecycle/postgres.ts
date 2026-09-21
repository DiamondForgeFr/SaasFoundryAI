import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { runSupervisedProcess, startSupervisedProcess } from './process'
import type { SupervisedCommandSpec, SupervisedProcessHandle, SupervisedProcessResult } from './types'

const DATABASE_NAME = 'sf_lifecycle'
const DATABASE_ROLE = 'sf_lifecycle'

export interface LifecycleProcessApi {
  run(spec: SupervisedCommandSpec): Promise<SupervisedProcessResult>
  start(spec: SupervisedCommandSpec): Promise<SupervisedProcessHandle>
}

export const lifecycleProcessApi: LifecycleProcessApi = {
  run: runSupervisedProcess,
  start: startSupervisedProcess
}

export interface PrivatePostgresOptions {
  workspace: string
  deadline: number
  signal?: AbortSignal
  port?: number
  bindir?: string
  osUser?: string | null
  processApi?: LifecycleProcessApi
}

export interface PrivatePostgres {
  readonly root: string
  readonly port: number
  readonly databaseUrl: string
  readonly directUrl: string
  executeSql(sql: string, label?: string): Promise<SupervisedProcessResult>
  runSqlFile(path: string, label?: string): Promise<SupervisedProcessResult>
  stop(primaryFailure?: unknown): Promise<void>
}

export async function startPrivatePostgres(options: PrivatePostgresOptions): Promise<PrivatePostgres> {
  validatePort(options.port ?? 55432)
  await mkdir(options.workspace, { recursive: true })
  const root = await mkdtemp(join(options.workspace, '.sf-postgres-'))
  const data = join(root, 'data')
  const sockets = join(root, 'sockets')
  await mkdir(sockets, { mode: 0o700 })
  const api = options.processApi ?? lifecycleProcessApi
  const port = options.port ?? 55432
  const bindir = options.bindir ?? process.env.PG_BINDIR ?? '/usr/lib/postgresql/16/bin'
  const osUser = options.osUser === undefined ? (typeof process.getuid === 'function' && process.getuid() === 0 ? 'postgres' : null) : options.osUser
  let server: SupervisedProcessHandle | undefined

  const command = (executable: string, args: readonly string[]): Pick<SupervisedCommandSpec, 'executable' | 'args'> =>
    osUser ? { executable: 'runuser', args: ['--user', osUser, '--', executable, ...args] } : { executable, args }
  const run = (label: string, executable: string, args: readonly string[], cwd = root, stdin?: string | Buffer) =>
    api.run({ label, ...command(executable, args), cwd, stdin, deadline: options.deadline, signal: options.signal })

  try {
    if (osUser)
      await api.run({
        label: 'postgres workspace ownership',
        executable: 'chown',
        args: ['-R', `${osUser}:${osUser}`, root],
        cwd: options.workspace,
        deadline: options.deadline,
        signal: options.signal
      })
    await run('postgres initdb', join(bindir, 'initdb'), ['-D', data, '--username=postgres', '--auth-local=trust', '--auth-host=trust', '--encoding=UTF8', '--no-locale'])

    server = await api.start({
      label: 'private postgres',
      ...command(join(bindir, 'postgres'), ['-D', data, '-h', '127.0.0.1', '-p', String(port), '-k', sockets]),
      cwd: root,
      deadline: options.deadline,
      signal: options.signal,
      ports: [port],
      fatalPatterns: [/\bPANIC\b/, /\bFATAL:\s+(?!terminating connection due to administrator command)/]
    })
    await waitUntilReady(run, join(bindir, 'pg_isready'), port, options.deadline, options.signal)
    const adminArgs = ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
    await run('postgres create lifecycle role', join(bindir, 'psql'), [...adminArgs, '-c', `CREATE ROLE ${DATABASE_ROLE} LOGIN`])
    await run('postgres create lifecycle database', join(bindir, 'createdb'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-O', DATABASE_ROLE, DATABASE_NAME])
  } catch (error) {
    try {
      if (server) await server.stop(error)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
    throw error
  }

  const databaseUrl = `postgresql://${DATABASE_ROLE}@127.0.0.1:${port}/${DATABASE_NAME}`
  let stopped = false
  return {
    root,
    port,
    databaseUrl,
    directUrl: databaseUrl,
    executeSql: (sql, label = 'psql lifecycle statement') => run(label, join(bindir, 'psql'), ['-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl, '-c', sql]),
    runSqlFile: async (path, label = `psql ${path}`) => run(label, join(bindir, 'psql'), ['-v', 'ON_ERROR_STOP=1', '-d', databaseUrl, '-f', '-'], root, await readFile(path)),
    stop: async (primaryFailure?: unknown) => {
      if (stopped) return
      stopped = true
      try {
        await server!.stop(primaryFailure)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  }
}

async function waitUntilReady(
  run: (label: string, executable: string, args: readonly string[], cwd?: string) => Promise<SupervisedProcessResult>,
  pgIsReady: string,
  port: number,
  deadline: number,
  signal?: AbortSignal
): Promise<void> {
  let lastError: unknown
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('PostgreSQL startup aborted.')
    try {
      await run('postgres readiness', pgIsReady, ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-t', '1'])
      return
    } catch (error) {
      lastError = error
    }
    await delay(Math.min(100, Math.max(1, deadline - Date.now())), signal)
  }
  throw new Error(`Private PostgreSQL did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Private PostgreSQL port must be an integer between 1 and 65535.')
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms)
    const abort = () => done(() => reject(signal?.reason))
    function done(operation: () => void = resolve): void {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      operation()
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}
