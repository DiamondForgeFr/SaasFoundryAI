import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { getSrsBackend, listSrsBackends, SrsConfigError, SrsManifestSubset } from '../index'
import { ScannerFinding } from '../scanners/types'
import { collectFindings } from './codebase-scan'

interface CodebaseManifest extends SrsManifestSubset {
  structure?: 'monorepo' | 'multirepo'
}

export interface DraftFromCodebaseOptions {
  scanPath: string
  manifestPath: string
}

export interface DraftFromCodebaseOutput {
  source: 'codebase'
  findings: ScannerFinding[]
}

function parseManifest(path: string): CodebaseManifest {
  const raw = readFileSync(path, 'utf8')
  try {
    return JSON.parse(raw) as CodebaseManifest
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`draft-from-codebase: failed to parse ${path} as JSON — ${message}`)
  }
}

export async function runDraftFromCodebase(options: DraftFromCodebaseOptions): Promise<number> {
  const scanRootInput = options.scanPath && options.scanPath.trim().length > 0 ? options.scanPath : process.cwd()
  const scanRoot = resolve(scanRootInput)
  if (!existsSync(scanRoot)) {
    process.stderr.write(`draft-from-codebase: --path does not exist: ${scanRoot}\n`)
    return 2
  }
  try {
    const stat = statSync(scanRoot)
    if (!stat.isDirectory()) {
      process.stderr.write(`draft-from-codebase: --path is not a directory: ${scanRoot}\n`)
      return 2
    }
  } catch {
    process.stderr.write(`draft-from-codebase: --path is not accessible: ${scanRoot}\n`)
    return 2
  }

  const manifestPath = resolve(options.manifestPath)
  let manifest: CodebaseManifest
  try {
    manifest = parseManifest(manifestPath)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }

  try {
    const backend = manifest.tools?.srs?.backend
    if (!backend) {
      throw new SrsConfigError('missing', 'draft-from-codebase: `.saasfoundry.json → tools.srs.backend` is not set.')
    }
    if (!getSrsBackend(backend)) {
      const available = listSrsBackends()
      const hint = available.length > 0 ? available.join(', ') : '<none registered>'
      throw new SrsConfigError('unknown', `draft-from-codebase: unknown SRS backend "${backend}". Available: ${hint}.`)
    }
    void manifest

    const findings: ScannerFinding[] = await collectFindings(scanRoot, manifest.structure)

    const output: DraftFromCodebaseOutput = { source: 'codebase', findings }
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    return 0
  } catch (error) {
    if (error instanceof SrsConfigError) {
      process.stderr.write(`✗ ${error.message}\n`)
      return error.code === 'missing' ? 3 : 4
    }
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`✗ draft-from-codebase failed — ${message}\n`)
    return 5
  }
}

function parseArgs(argv: string[]): { scanPath: string; manifestPath: string; unknown?: string } {
  let scanPath = ''
  let manifestPath = '.saasfoundry.json'
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--path' || arg === '-p') scanPath = argv[++i] ?? ''
    else if (arg.startsWith('--path=')) scanPath = arg.slice('--path='.length)
    else if (arg === '--manifest' || arg === '-m') manifestPath = argv[++i] ?? manifestPath
    else if (arg.startsWith('--manifest=')) manifestPath = arg.slice('--manifest='.length)
    else if (arg.startsWith('-')) return { scanPath, manifestPath, unknown: arg }
    else if (!scanPath) scanPath = arg
  }
  return { scanPath, manifestPath }
}

if (require.main === module) {
  const { scanPath, manifestPath, unknown } = parseArgs(process.argv.slice(2))
  if (unknown) {
    process.stderr.write(`draft-from-codebase: unknown flag ${unknown}\n`)
    process.exit(2)
  }
  runDraftFromCodebase({ scanPath, manifestPath })
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`draft-from-codebase: unexpected error — ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    })
}
