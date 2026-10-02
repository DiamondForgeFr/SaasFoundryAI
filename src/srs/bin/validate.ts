import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createSrsAdapter, SrsConfigError, SrsManifestSubset } from '../index'
import { rejectUnknownOption, runFromCommandLine, SrsUsageError } from './args'
import { checkSpec, normalizeCandidates } from './write-srs'

export interface ValidateOptions {
  manifestPath: string
  /** A DraftCandidate spec to check offline instead of smoke-testing the backend. */
  specPath?: string
}

export function parseArgs(argv: string[]): ValidateOptions {
  const options: ValidateOptions = { manifestPath: '.saasfoundry.json' }
  let positional: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--manifest' || arg === '-m') options.manifestPath = valueOf(argv, ++i, arg)
    else if (arg.startsWith('--manifest=')) options.manifestPath = arg.slice('--manifest='.length)
    else if (arg === '--spec' || arg === '-s') options.specPath = valueOf(argv, ++i, arg)
    else if (arg.startsWith('--spec=')) options.specPath = arg.slice('--spec='.length)
    else if (arg.startsWith('-')) rejectUnknownOption('validate', arg)
    else if (positional === undefined) positional = arg
  }
  // `validate <manifest>` — the form srs-cli.sh and earlier versions use
  if (positional !== undefined) options.manifestPath = positional
  return options
}

function valueOf(argv: string[], i: number, flag: string): string {
  const value = argv[i]
  if (value === undefined || value.startsWith('-')) throw new SrsUsageError(`validate: ${flag} requires a value`)
  return value
}

function readJson(path: string): unknown {
  const raw = readFileSync(path, 'utf8')
  try {
    return JSON.parse(raw) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`validate: failed to parse ${path} as JSON — ${message}`)
  }
}

/** A DraftCandidate spec: an array of candidates, or an object holding one. */
function looksLikeSpec(value: unknown): boolean {
  return Array.isArray(value) || (value !== null && typeof value === 'object' && Array.isArray((value as { candidates?: unknown }).candidates))
}

/** The checks `write` runs before creating any page, without a backend or a manifest. */
function validateSpec(specPath: string): number {
  let candidates
  try {
    candidates = normalizeCandidates(readJson(resolve(specPath)))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
  if (candidates.length === 0) {
    process.stderr.write(`validate: ${specPath} contains zero candidates — nothing to write.\n`)
    return 2
  }
  const { errors, warnings } = checkSpec(candidates)
  for (const warning of warnings) process.stderr.write(`${warning}\n`)
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`✗ ${error}\n`)
    return 2
  }
  const epics = candidates.filter((candidate) => candidate.kind === 'epic').length
  process.stdout.write(`✓ ${specPath}: ${candidates.length} candidates (${epics} epic, ${candidates.length - epics} fr) can be written\n`)
  return 0
}

export async function runValidate(options: ValidateOptions): Promise<number> {
  if (options.specPath) return validateSpec(options.specPath)

  const manifestPath = resolve(options.manifestPath)
  let manifest: SrsManifestSubset
  try {
    const parsed = readJson(manifestPath)
    // A spec passed where the manifest goes used to read as "tools.srs.backend is not set" (#877)
    if (looksLikeSpec(parsed)) {
      process.stderr.write(`validate: ${options.manifestPath} is a DraftCandidate spec, not a manifest — check it with \`sf srs validate --spec ${options.manifestPath}\`.\n`)
      return 2
    }
    manifest = parsed as SrsManifestSubset
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }

  try {
    const adapter = await createSrsAdapter(manifest)
    await adapter.init()
    const backend = manifest.tools?.srs?.backend ?? '<unknown>'
    process.stdout.write(`✓ sf-srs backend "${backend}" is reachable (init OK)\n`)
    return 0
  } catch (error) {
    if (error instanceof SrsConfigError) {
      process.stderr.write(`✗ ${error.message}\n`)
      return error.code === 'missing' ? 3 : 4
    }
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`✗ sf-srs init failed — ${message}\n`)
    return 5
  }
}

if (require.main === module) {
  runFromCommandLine('validate', (argv) => runValidate(parseArgs(argv)), 'Usage: validate.ts [manifest] [--manifest <path>] [--spec <path>]')
}
