import chalk from 'chalk'
import { exec } from 'shelljs'

/**
 * Running a command and knowing whether it worked.
 *
 * `shelljs.exec` is synchronous and never throws — it returns `{ code, stdout, stderr }`.
 * Thirty call sites did `await exec(\`… > /dev/null 2>&1\`)` and read none of it: the
 * `await` on a non-Promise resolves at once, the exit code is dropped, and the output has
 * already been sent to /dev/null. `npm install`, `prisma generate`, `git commit` could
 * all fail with nothing to show for it.
 *
 * What it cost: a generated project whose dependencies were never installed and whose
 * Prisma client was never generated, presented to the user as ready. The first thing they
 * saw was 219 TypeScript errors about a missing module. See #592, and #589 for the failure
 * that made it visible.
 *
 * Two verbs, because two things are being asked:
 *
 *   runRequired    — the project is unusable without it. Failing stops the run, loudly.
 *   runBestEffort  — it may legitimately not work here. Say so once, carry on.
 *
 * Neither redirects to /dev/null. Output is captured, so it is still there when a failure
 * has to be explained.
 */

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export interface RunOptions {
  cwd?: string
  /** Let the command write to the terminal as it goes. Output is not captured then. */
  stream?: boolean
}

/** Runs a command and hands back its result. Never throws — the caller decides. */
export function run(command: string, options: RunOptions = {}): RunResult {
  const result = exec(command, { silent: !options.stream, ...(options.cwd ? { cwd: options.cwd } : {}) }) as unknown as RunResult
  return { code: result.code, stdout: result.stdout || '', stderr: result.stderr || '' }
}

/** The last lines of a command's output — enough to diagnose, short enough to read. */
function tail(text: string, lines = 12): string {
  const trimmed = text.trimEnd()
  if (!trimmed) return ''
  return trimmed.split('\n').slice(-lines).join('\n')
}

export class CommandFailedError extends Error {
  constructor(
    readonly label: string,
    readonly command: string,
    readonly code: number,
    readonly output: string
  ) {
    const detail = output ? `\n\n${output}` : ''
    super(`${label} failed (exit ${code}).\n  ${command}${detail}`)
    this.name = 'CommandFailedError'
  }
}

/**
 * Runs a command the project cannot do without. Throws with the command, its exit code and
 * its output when it fails — the three things needed to know what went wrong.
 */
export function runRequired(label: string, command: string, options: RunOptions = {}): RunResult {
  const result = run(command, options)
  if (result.code !== 0) {
    throw new CommandFailedError(label, command, result.code, tail(`${result.stdout}${result.stderr}`))
  }
  return result
}

/**
 * Runs a command that is allowed to fail — initialising git in a directory that is already
 * a repository, adding a remote nobody supplied, opening a browser on a headless machine.
 *
 * Returns whether it worked, and reports once through `onSkipped` rather than staying
 * silent. A step that may fail is not a step whose failure should be unknowable.
 */
export function runBestEffort(label: string, command: string, options: RunOptions & { onSkipped?: (message: string) => void } = {}): boolean {
  const result = run(command, options)
  if (result.code !== 0) {
    options.onSkipped?.(`${label} did not run (exit ${result.code}) — continuing.`)
    return false
  }
  return true
}

/**
 * How a skipped best-effort step is said. One shared voice: a step that may fail is not a
 * step whose failure should be unknowable, and thirty call sites should not each invent a
 * format for saying so.
 */
export const warn = (message: string): void => {
  console.warn(chalk.yellow(`  ⚠ ${message}`))
}
