import { spawn } from 'node:child_process'
import { Socket } from 'node:net'
import { join } from 'node:path'

import { redactText, StreamingRedactor, stripAnsi } from './redaction'
import type { LifecycleFatalEvent, SupervisedCommandSpec, SupervisedProcessHandle, SupervisedProcessResult } from './types'
import { combinePrimaryAndCleanup, errorMessage, LifecycleRuntimeError } from './types'

export const DEFAULT_INHERITED_ENVIRONMENT = ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'COMSPEC', 'PATHEXT'] as const

const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_INPUT_BYTES = 8 * 1024 * 1024
const DEFAULT_TERM_GRACE_MS = 1_500
const DEFAULT_KILL_GRACE_MS = 3_000
const DEFAULT_VERIFICATION_TIMEOUT_MS = 3_000

export function buildLifecycleEnvironment(
  explicit: Readonly<NodeJS.ProcessEnv> = {},
  ambient: Readonly<NodeJS.ProcessEnv> = process.env,
  inheritedEnvironment: readonly string[] = DEFAULT_INHERITED_ENVIRONMENT
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const name of inheritedEnvironment) {
    assertEnvironmentName(name)
    if (!(DEFAULT_INHERITED_ENVIRONMENT as readonly string[]).includes(name)) {
      throw new LifecycleRuntimeError('process-spawn', `Ambient environment key is not in the lifecycle allowlist: ${name}`)
    }
    if (ambient[name] !== undefined) env[name] = assertEnvironmentValue(ambient[name], name)
  }
  for (const [name, value] of Object.entries(explicit)) {
    assertEnvironmentName(name)
    if (value !== undefined) env[name] = assertEnvironmentValue(value, name)
  }
  env.CI = explicit.CI ?? 'true'
  env.HUSKY = explicit.HUSKY ?? '0'
  env.NO_COLOR = explicit.NO_COLOR ?? '1'
  env.FORCE_COLOR = explicit.FORCE_COLOR ?? '0'
  return env
}

export async function startSupervisedProcess(spec: SupervisedCommandSpec): Promise<SupervisedProcessHandle> {
  validateSpec(spec)
  if (spec.signal?.aborted) throw abortError(spec.label, spec.signal.reason)
  const maxOutputBytes = spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  const termGraceMs = spec.termGraceMs ?? DEFAULT_TERM_GRACE_MS
  const killGraceMs = spec.killGraceMs ?? DEFAULT_KILL_GRACE_MS
  const verificationTimeoutMs = spec.verificationTimeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS
  const environment = buildLifecycleEnvironment(spec.env, process.env, spec.inheritedEnvironment)
  const secrets = [...(spec.secrets ?? []), ...secretEnvironmentValues(environment)]
  const stdout = new StreamingRedactor({ secrets, maxRetainedBytes: maxOutputBytes })
  const stderr = new StreamingRedactor({ secrets, maxRetainedBytes: maxOutputBytes })
  const startedAt = new Date().toISOString()
  const fatalEvents: LifecycleFatalEvent[] = []

  const launch = processLaunch(spec.executable, spec.args, termGraceMs)
  const child = spawn(launch.executable, launch.args, {
    cwd: spec.cwd,
    env: environment,
    detached: process.platform !== 'win32',
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  await new Promise<void>((resolve, reject) => {
    const onSpawn = () => {
      child.off('error', onError)
      resolve()
    }
    const onError = (error: Error) => {
      child.off('spawn', onSpawn)
      reject(new LifecycleRuntimeError('process-spawn', `${spec.label} could not start: ${redactText(error.message, secrets)}`, { cause: error }))
    }
    child.once('spawn', onSpawn)
    child.once('error', onError)
  })
  const pid = child.pid
  if (pid === undefined) throw new LifecycleRuntimeError('process-spawn', `${spec.label} started without a process id.`)

  let outputBytes = 0
  let primaryFailure: unknown
  let termination: Promise<void> | undefined
  let closed = false
  let closeResult: SupervisedProcessResult | undefined

  const classify = (stream: 'stdout' | 'stderr', text: string): void => {
    if (!text || !spec.fatalPatterns?.length) return
    for (const line of stripAnsi(text).split(/\r?\n/)) {
      if (!line) continue
      for (const pattern of spec.fatalPatterns) {
        pattern.lastIndex = 0
        if (!pattern.test(line)) continue
        const event: LifecycleFatalEvent = {
          process: spec.label,
          stream,
          pattern: pattern.source,
          line,
          observedAt: new Date().toISOString()
        }
        fatalEvents.push(event)
        triggerFailure(new LifecycleRuntimeError('fatal-log', `${spec.label} emitted fatal ${stream}: ${line}`))
        break
      }
    }
  }

  const collect = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
    outputBytes += chunk.length
    const emitted = stream === 'stdout' ? stdout.push(chunk) : stderr.push(chunk)
    classify(stream, emitted)
    if (outputBytes > maxOutputBytes) triggerFailure(new LifecycleRuntimeError('output-limit', `${spec.label} exceeded the ${maxOutputBytes}-byte output limit.`))
  }

  child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk))
  child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk))

  const exited = new Promise<SupervisedProcessResult>((resolve) => {
    child.once('close', (status, signal) => {
      closed = true
      clearTimeout(deadlineTimer)
      spec.signal?.removeEventListener('abort', onAbort)
      classify('stdout', stdout.end())
      classify('stderr', stderr.end())
      const stdoutCapture = stdout.snapshot()
      const stderrCapture = stderr.snapshot()
      closeResult = {
        label: spec.label,
        pid,
        status,
        signal,
        stdout: stdoutCapture.text,
        stderr: stderrCapture.text,
        outputBytes,
        outputTruncated: outputBytes > maxOutputBytes || stdoutCapture.truncated || stderrCapture.truncated,
        fatalEvents: fatalEvents.map((event) => ({ ...event })),
        startedAt,
        finishedAt: new Date().toISOString()
      }
      resolve(closeResult)
    })
  })

  const terminateAndVerify = async (): Promise<void> => {
    if (!closed) {
      await requestProcessTreeTermination(pid, 'SIGTERM')
      if (!(await settlesWithin(exited, termGraceMs))) {
        await requestProcessTreeTermination(pid, 'SIGKILL')
        if (!(await settlesWithin(exited, killGraceMs))) {
          await signalProcessGroup(pid, 'SIGKILL')
          throw new LifecycleRuntimeError('teardown', `${spec.label} did not close after verified descendant SIGKILL.`)
        }
      }
    }
    if (process.platform !== 'win32' && isProcessGroupAlive(pid)) {
      await signalProcessGroup(pid, 'SIGTERM')
      if (!(await processGroupSettlesWithin(pid, termGraceMs))) {
        await signalProcessGroup(pid, 'SIGKILL')
        if (!(await processGroupSettlesWithin(pid, killGraceMs))) throw new LifecycleRuntimeError('teardown', `${spec.label} descendants survived SIGKILL.`)
      }
    }
    await verifyReleased(pid, spec.ports ?? [], verificationTimeoutMs)
  }

  function triggerFailure(error: unknown): void {
    if (primaryFailure === undefined) primaryFailure = error
    if (!termination) termination = terminateAndVerify()
    void termination.catch(() => undefined)
  }

  child.on('error', (error) => triggerFailure(new LifecycleRuntimeError('process-exit', `${spec.label} process error: ${redactText(error.message, secrets)}`, { cause: error })))

  const onAbort = (): void => triggerFailure(abortError(spec.label, spec.signal?.reason))
  spec.signal?.addEventListener('abort', onAbort, { once: true })
  if (spec.signal?.aborted) onAbort()
  const deadlineTimer = setTimeout(() => triggerFailure(new LifecycleRuntimeError('deadline', `${spec.label} exceeded its lifecycle deadline.`)), Math.max(1, spec.deadline - Date.now()))
  child.stdin.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') triggerFailure(new LifecycleRuntimeError('process-exit', `${spec.label} stdin error: ${redactText(error.message, secrets)}`, { cause: error }))
  })
  child.stdin.end(spec.stdin)

  const finish = async (stopRequested: boolean, callerFailure?: unknown): Promise<SupervisedProcessResult> => {
    if (callerFailure !== undefined && primaryFailure === undefined) primaryFailure = callerFailure
    if (stopRequested && !termination) termination = terminateAndVerify()

    const result = closeResult ?? (await exited)
    if (!stopRequested && result.status !== 0 && primaryFailure === undefined) {
      primaryFailure = new LifecycleRuntimeError('process-exit', describeExit(result), { cause: result })
    }
    // A successful short command can still leave a daemonized descendant behind.
    // Verification is part of ordinary completion, not only explicit stop.
    if (!termination) termination = terminateAndVerify()

    let cleanupFailure: unknown
    if (termination) {
      try {
        await termination
      } catch (error) {
        cleanupFailure = error
      }
    }
    if (cleanupFailure !== undefined) throw combinePrimaryAndCleanup(primaryFailure, cleanupFailure, `${spec.label} failed and teardown was incomplete.`)
    if (primaryFailure !== undefined) throw primaryFailure
    return result
  }

  return {
    label: spec.label,
    pid,
    child,
    exited,
    wait: () => finish(false),
    stop: (failure?: unknown) => finish(true, failure)
  }
}

/**
 * Linux commands run below a child subreaper so double-forked processes that
 * call setsid remain descendants of the wrapper and cannot escape teardown.
 * Windows relies on taskkill /T. Other POSIX hosts retain process-group and
 * declared-port verification, which cannot adopt a reparented session.
 */
function processLaunch(executable: string, args: readonly string[], termGraceMs: number): { executable: string; args: string[] } {
  if (process.platform !== 'linux') return { executable, args: [...args] }
  return {
    executable: '/usr/bin/python3',
    args: [join(__dirname, 'process-subtree.py'), String(Math.max(10, Math.floor(termGraceMs / 2))), executable, ...args]
  }
}

/** Compatibility name used by higher-level lifecycle components. */
export const superviseProcess = startSupervisedProcess

export async function runSupervisedProcess(spec: SupervisedCommandSpec): Promise<SupervisedProcessResult> {
  const process = await startSupervisedProcess(spec)
  return process.wait()
}

export async function waitForPortsReleased(ports: readonly number[], timeoutMs = DEFAULT_VERIFICATION_TIMEOUT_MS): Promise<void> {
  validatePorts(ports)
  const deadline = Date.now() + timeoutMs
  while (true) {
    const occupied = (await Promise.all(ports.map(async (port) => ((await canConnect(port)) ? port : undefined)))).filter((port): port is number => port !== undefined)
    if (occupied.length === 0) return
    if (Date.now() >= deadline) throw new LifecycleRuntimeError('teardown', `Lifecycle listeners remained open on ports: ${occupied.join(', ')}`)
    await delay(50)
  }
}

async function verifyReleased(pid: number, ports: readonly number[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const pidAlive = isPidAlive(pid)
    const groupAlive = process.platform === 'win32' ? false : isProcessGroupAlive(pid)
    const occupied = (await Promise.all(ports.map(async (port) => ((await canConnect(port)) ? port : undefined)))).filter((port): port is number => port !== undefined)
    if (!pidAlive && !groupAlive && occupied.length === 0) return
    if (Date.now() >= deadline) {
      const details = [pidAlive ? `pid ${pid}` : '', groupAlive ? `process group ${pid}` : '', occupied.length ? `ports ${occupied.join(', ')}` : ''].filter(Boolean).join(', ')
      throw new LifecycleRuntimeError('teardown', `Lifecycle teardown verification failed; still active: ${details}.`)
    }
    await delay(50)
  }
}

async function requestProcessTreeTermination(pid: number, signal: 'SIGTERM' | 'SIGKILL'): Promise<void> {
  if (process.platform === 'win32') {
    if (signal === 'SIGTERM') return
    await new Promise<void>((resolve, reject) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { shell: false, stdio: 'ignore', windowsHide: true })
      killer.once('error', reject)
      killer.once('close', (status) => (status === 0 || status === 128 ? resolve() : reject(new Error(`taskkill exited with status ${String(status)}`))))
    })
    return
  }
  if (process.platform === 'linux') {
    try {
      // Keep the subreaper alive while it signals, verifies, and reaps adopted
      // descendants. SIGUSR1 requests immediate descendant SIGKILL.
      process.kill(pid, signal === 'SIGTERM' ? 'SIGTERM' : 'SIGUSR1')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
    return
  }
  await signalProcessGroup(pid, signal)
}

async function signalProcessGroup(pid: number, signal: 'SIGTERM' | 'SIGKILL'): Promise<void> {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function isProcessGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket()
    const settle = (answer: boolean) => {
      socket.destroy()
      resolve(answer)
    }
    socket.setTimeout(100)
    socket.once('connect', () => settle(true))
    socket.once('timeout', () => settle(false))
    socket.once('error', () => settle(false))
    socket.connect(port, '127.0.0.1')
  })
}

function settlesWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    void promise.then(
      () => {
        clearTimeout(timer)
        resolve(true)
      },
      () => {
        clearTimeout(timer)
        resolve(true)
      }
    )
  })
}

async function processGroupSettlesWithin(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (isProcessGroupAlive(pid)) {
    if (Date.now() >= deadline) return false
    await delay(25)
  }
  return true
}

function describeExit(result: SupervisedProcessResult): string {
  const output = [result.stdout.trim() ? `stdout:\n${result.stdout.slice(-4_096)}` : '', result.stderr.trim() ? `stderr:\n${result.stderr.slice(-4_096)}` : ''].filter(Boolean).join('\n')
  return `${result.label} exited unsuccessfully (status=${String(result.status)}, signal=${String(result.signal)}).${output ? `\n${output}` : ''}`
}

function secretEnvironmentValues(env: Readonly<NodeJS.ProcessEnv>): string[] {
  return Object.entries(env).flatMap(([name, value]) => (value && /(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|AUTH|COOKIE|DATABASE_URL)/i.test(name) ? [value] : []))
}

function abortError(label: string, reason: unknown): LifecycleRuntimeError {
  const detail = reason === undefined ? '' : `: ${errorMessage(reason)}`
  return new LifecycleRuntimeError('aborted', `${label} was aborted${detail}`)
}

function validateSpec(spec: SupervisedCommandSpec): void {
  if (!spec.label || /[\u0000-\u001f\u007f]/.test(spec.label)) throw new LifecycleRuntimeError('process-spawn', 'Process label must be non-empty and contain no control characters.')
  if (!spec.executable || spec.executable.includes('\0')) throw new LifecycleRuntimeError('process-spawn', 'Process executable must be a non-empty literal path or command name.')
  if (!spec.cwd || spec.cwd.includes('\0')) throw new LifecycleRuntimeError('process-spawn', 'Process cwd must be a non-empty literal path.')
  for (const arg of spec.args) if (typeof arg !== 'string' || arg.includes('\0')) throw new LifecycleRuntimeError('process-spawn', 'Process argv values must be strings without NUL bytes.')
  if (spec.stdin !== undefined && typeof spec.stdin !== 'string' && !Buffer.isBuffer(spec.stdin)) {
    throw new LifecycleRuntimeError('process-spawn', 'Process stdin must be a string or Buffer.')
  }
  if (spec.stdin !== undefined && Buffer.byteLength(spec.stdin) > DEFAULT_MAX_INPUT_BYTES) {
    throw new LifecycleRuntimeError('process-spawn', `Process stdin exceeds the ${DEFAULT_MAX_INPUT_BYTES}-byte input limit.`)
  }
  if (!Number.isSafeInteger(spec.deadline)) throw new LifecycleRuntimeError('deadline', 'Process deadline must be an absolute millisecond timestamp.')
  for (const [name, value] of [
    ['maxOutputBytes', spec.maxOutputBytes],
    ['termGraceMs', spec.termGraceMs],
    ['killGraceMs', spec.killGraceMs],
    ['verificationTimeoutMs', spec.verificationTimeoutMs]
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new LifecycleRuntimeError('process-spawn', `${name} must be a positive safe integer.`)
  }
  validatePorts(spec.ports ?? [])
}

function validatePorts(ports: readonly number[]): void {
  if (new Set(ports).size !== ports.length || ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65_535)) {
    throw new LifecycleRuntimeError('teardown', 'Lifecycle ports must be distinct integers between 1 and 65535.')
  }
}

function assertEnvironmentName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new LifecycleRuntimeError('process-spawn', `Invalid environment key: ${JSON.stringify(name)}`)
}

function assertEnvironmentValue(value: string | undefined, name: string): string {
  if (value === undefined) return ''
  if (value.includes('\0')) throw new LifecycleRuntimeError('process-spawn', `Environment value contains NUL: ${name}`)
  return value
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
