import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import ignore, { Ignore } from 'ignore'

import { getSrsBackend, listSrsBackends, SrsConfigError, SrsManifestSubset } from '../index'
import { CodebaseScanner, CodebaseScannerContext, ScannerFinding } from '../scanners/types'

export interface DraftFromCodebaseOptions {
  scanPath: string
  manifestPath: string
}

export interface DraftFromCodebaseOutput {
  source: 'codebase'
  findings: ScannerFinding[]
}

const HARD_EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', '.vitepress/cache'])
const HARD_EXCLUDE_DIR_SEGMENTS = ['node_modules', 'dist', 'coverage', '.git']
const HARD_EXCLUDE_PATH_FRAGMENTS = ['.vitepress/cache']

const SCANNERS: CodebaseScanner[] = []

function parseManifest(path: string): SrsManifestSubset {
  const raw = readFileSync(path, 'utf8')
  try {
    return JSON.parse(raw) as SrsManifestSubset
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`draft-from-codebase: failed to parse ${path} as JSON — ${message}`)
  }
}

function loadGitignore(scanRoot: string): Ignore {
  const ig = ignore()
  const gitignorePath = join(scanRoot, '.gitignore')
  if (existsSync(gitignorePath)) {
    try {
      ig.add(readFileSync(gitignorePath, 'utf8'))
    } catch {
      // If .gitignore is unreadable, fall through with hard-coded excludes only.
    }
  }
  return ig
}

function isHardExcluded(relPath: string): boolean {
  const segments = relPath.split('/')
  if (segments.some((seg) => HARD_EXCLUDE_DIR_SEGMENTS.includes(seg))) return true
  return HARD_EXCLUDE_PATH_FRAGMENTS.some((fragment) => relPath.includes(fragment))
}

function collectFiles(scanRoot: string): string[] {
  const ig = loadGitignore(scanRoot)
  const results: string[] = []

  const walk = (absDir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(absDir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (HARD_EXCLUDE_DIRS.has(entry)) continue
      const absChild = join(absDir, entry)
      const relChild = relative(scanRoot, absChild)
      if (relChild.length === 0) continue
      if (isHardExcluded(relChild)) continue
      const relForIgnore = relChild.split('\\').join('/')
      let stat
      try {
        stat = statSync(absChild)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        if (ig.ignores(`${relForIgnore}/`)) continue
        walk(absChild)
      } else if (stat.isFile()) {
        if (ig.ignores(relForIgnore)) continue
        results.push(relForIgnore)
      }
    }
  }

  walk(scanRoot)
  return results.sort()
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
  let manifest: SrsManifestSubset
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

    const files = collectFiles(scanRoot)
    const context: CodebaseScannerContext = { scanRoot, files }

    const findings: ScannerFinding[] = []
    for (const scanner of SCANNERS) {
      const batch = await scanner.collect(context)
      findings.push(...batch)
    }

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
