export function errorPayload(error: unknown): { error: string; report?: unknown; recovery?: unknown } {
  const record = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : undefined
  return {
    error: error instanceof Error ? error.message : String(error),
    ...(record?.report !== undefined ? { report: record.report } : {}),
    ...(record?.recovery !== undefined ? { recovery: record.recovery } : {})
  }
}

/** Run a subcommand and report a failure the way every `sf agents` command does: JSON on stdout with --json, text on stderr otherwise. */
export async function runAgentsSubcommand(options: { json?: boolean }, action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error) {
    const payload = errorPayload(error)
    if (options.json) process.stdout.write(JSON.stringify(payload) + '\n')
    else {
      process.stderr.write(`Error: ${payload.error}\n`)
      if (payload.report !== undefined) process.stderr.write(`Report: ${JSON.stringify(payload.report, null, 2)}\n`)
      if (payload.recovery !== undefined) process.stderr.write(`Recovery: ${JSON.stringify(payload.recovery, null, 2)}\n`)
    }
    process.exitCode = 1
  }
}

/** Positive integer from a command-line value, or a message that names the option. */
export function parsePositiveInteger(value: string | undefined, option: string): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value.replace(/^#/, ''))
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${option} must be a positive integer, got '${value}'.`)
  return parsed
}

export function parseNonNegativeInteger(value: string | undefined, option: string): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${option} must be a non-negative integer, got '${value}'.`)
  return parsed
}

export function parseList(value: string | undefined): string[] | undefined {
  return value === undefined
    ? undefined
    : value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
}
