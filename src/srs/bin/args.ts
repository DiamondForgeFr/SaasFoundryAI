/**
 * A command line an SRS bin cannot run: missing or unknown options. It exits 2, the shared
 * "bad input" code, before anything is read from or written to the backend.
 */
export class SrsUsageError extends Error {}

/**
 * Refuse an option the bin does not know. Ignoring them made `sf srs write --dry-run`
 * write a whole duplicate feature tree, the flag silently dropped (#877).
 */
export function rejectUnknownOption(label: string, arg: string, hint?: string): never {
  throw new SrsUsageError(`${label}: unknown option '${arg}'${hint ? ` — ${hint}` : ''}`)
}

/**
 * Run an SRS bin from its own command line (`node dist/srs/bin/<bin>.js`, which
 * `srs-cli.sh` does). A usage error exits 2 with its message and the bin's usage line;
 * any other failure exits 1.
 */
export function runFromCommandLine(label: string, main: (argv: string[]) => Promise<number>, usage?: string): void {
  const fail = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof SrsUsageError) {
      process.stderr.write(`${message}\n${usage ? `\n${usage}\n` : ''}`)
      process.exit(2)
    }
    process.stderr.write(`${label}: unexpected error — ${message}\n`)
    process.exit(1)
  }
  let pending: Promise<number>
  try {
    pending = main(process.argv.slice(2))
  } catch (error) {
    fail(error)
    return
  }
  pending.then((code) => process.exit(code), fail)
}
