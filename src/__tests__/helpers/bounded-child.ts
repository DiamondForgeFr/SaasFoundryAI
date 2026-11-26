import childProcess from 'child_process'

/**
 * The synchronous child processes of the specs, always bounded (#1344).
 *
 * Jest's test timeout and the hang guard of a project are timers of the event loop: a synchronous call blocks that loop,
 * so neither can fire while it waits. On 2026-11-25 a `git hash-object -w --stdin` started with `execFileSync` never
 * finished, and the local CI held the shared runner for 13 hours. Each function here is the one of `child_process`,
 * same arguments and same result, with a `timeout` and a `killSignal` always set: a stuck child is killed and its call
 * throws (`execFileSync`, `execSync`) or returns an `error` whose `code` is `ETIMEDOUT` (`spawnSync`), so its test fails
 * in seconds instead of hanging the run.
 *
 * The guard in `src/__tests__/unit/ci/bounded-sync-child.spec.ts` refuses a spec or a helper that takes one of these three
 * from `child_process` instead.
 */

/** The bound when the caller sets none: the test budget of the Jest project (`globals.TEST_TIMEOUT`), which no child of a test can usefully outlive. */
export const DEFAULT_CHILD_TIMEOUT_MS = 60_000

/** SIGKILL, because SIGTERM can be caught or ignored, and the call then still waits for the child to exit. */
export const CHILD_KILL_SIGNAL: NodeJS.Signals = 'SIGKILL'

type Bounds = { timeout?: number; killSignal?: NodeJS.Signals | number }

function defaultTimeout(): number {
  const configured = (globalThis as { TEST_TIMEOUT?: unknown }).TEST_TIMEOUT
  return typeof configured === 'number' && configured > 0 ? configured : DEFAULT_CHILD_TIMEOUT_MS
}

/**
 * The options of a synchronous child with its bounds: the caller's own `timeout` when it is positive (Node reads `0` as
 * none), the project's test budget otherwise, and the caller's `killSignal` or SIGKILL.
 */
export function boundedOptions<T extends object>(options?: T | null): T & { timeout: number; killSignal: NodeJS.Signals | number } {
  const given = (options ?? {}) as T & Bounds
  const timeout = typeof given.timeout === 'number' && given.timeout > 0 ? given.timeout : defaultTimeout()
  return { ...given, timeout, killSignal: given.killSignal ?? CHILD_KILL_SIGNAL }
}

/** `(file, args, options)` or `(file, options)`, the two shapes Node accepts. */
function argvAndOptions(second: unknown, third: unknown): [readonly string[], object | undefined] {
  if (Array.isArray(second)) return [second as readonly string[], third as object | undefined]
  if (second === undefined || second === null) return [[], third as object | undefined]
  return [[], second as object]
}

// The module is read on every call, not once: a spec that spies on `child_process` sees these calls as it saw the direct ones.

export const execFileSync = ((file: string, second?: unknown, third?: unknown) => {
  const [args, options] = argvAndOptions(second, third)
  return childProcess.execFileSync(file, args, boundedOptions(options as childProcess.ExecFileSyncOptions))
}) as typeof childProcess.execFileSync

export const execSync = ((command: string, options?: childProcess.ExecSyncOptions) => childProcess.execSync(command, boundedOptions(options))) as typeof childProcess.execSync

export const spawnSync = ((command: string, second?: unknown, third?: unknown) => {
  const [args, options] = argvAndOptions(second, third)
  return childProcess.spawnSync(command, args, boundedOptions(options as childProcess.SpawnSyncOptions))
}) as typeof childProcess.spawnSync
