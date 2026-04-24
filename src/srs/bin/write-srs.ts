import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { DraftCandidate, FrSpec, PageRef, SrsAdapter } from '../../builders/srs/types'
import { createSrsAdapter, SrsConfigError, SrsManifestSubset } from '../index'

export interface WriteSrsOptions {
  specPath: string
  manifestPath: string
  clearPendingIngestion?: boolean
}

export interface WriteResultEntry {
  index: number
  kind: 'epic' | 'fr'
  page: PageRef
}

export interface WriteFailureEntry {
  index: number
  kind: 'epic' | 'fr'
  error: string
}

export interface WriteSrsReport {
  created: WriteResultEntry[]
  failed: WriteFailureEntry[]
  pendingIngestionCleared: boolean
  rollbackHint?: string
}

function readJson<T>(path: string, label: string): T {
  const raw = readFileSync(path, 'utf8')
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${label}: failed to parse ${path} as JSON — ${message}`)
  }
}

function normalizeCandidates(input: unknown): DraftCandidate[] {
  if (Array.isArray(input)) return input as DraftCandidate[]
  if (input && typeof input === 'object' && Array.isArray((input as { candidates?: unknown }).candidates)) {
    return (input as { candidates: DraftCandidate[] }).candidates
  }
  throw new Error('write-srs: spec file must be a JSON array of DraftCandidate or an object with a `candidates` array.')
}

function assertCandidateShape(candidate: DraftCandidate, index: number): void {
  if (candidate.kind === 'epic') {
    if (!candidate.epic) throw new Error(`write-srs: candidate #${index} has kind="epic" but the "epic" spec is missing.`)
    return
  }
  if (candidate.kind === 'fr') {
    if (!candidate.fr) throw new Error(`write-srs: candidate #${index} has kind="fr" but the "fr" spec is missing.`)
    if (!candidate.fr.parentEpicPageId && !candidate.fr.parentEpicId) {
      throw new Error(`write-srs: candidate #${index} (fr) must set either "parentEpicPageId" (explicit Notion page ID) or "parentEpicId" (logical ID of an Epic in the same batch).`)
    }
    return
  }
  throw new Error(`write-srs: candidate #${index} has an unknown kind="${String((candidate as { kind?: unknown }).kind)}" (expected "epic" or "fr").`)
}

function resolveFrParent(fr: FrSpec, logicalIdMap: Map<string, string>, index: number): FrSpec {
  if (fr.parentEpicPageId && fr.parentEpicPageId.length > 0) return fr
  const logicalId = fr.parentEpicId
  if (!logicalId) {
    throw new Error(`write-srs: candidate #${index} (fr) has no parent epic reference.`)
  }
  const resolved = logicalIdMap.get(logicalId)
  if (!resolved) {
    const known = Array.from(logicalIdMap.keys())
    const hint = known.length > 0 ? `Known logical IDs in this batch: ${known.join(', ')}.` : 'No Epic in this batch declared a logical "id" — did you set "epic.id" on the parent Epic candidate?'
    throw new Error(`write-srs: candidate #${index} (fr) references parentEpicId="${logicalId}" but no Epic with that logical id was created before it. ${hint}`)
  }
  return { ...fr, parentEpicPageId: resolved }
}

async function applyCandidate(adapter: SrsAdapter, candidate: DraftCandidate, logicalIdMap: Map<string, string>, index: number): Promise<PageRef> {
  if (candidate.kind === 'epic') {
    const page = await adapter.createEpicPage(candidate.epic!)
    if (candidate.epic!.id) logicalIdMap.set(candidate.epic!.id, page.id)
    return page
  }
  const fr = resolveFrParent(candidate.fr!, logicalIdMap, index)
  return adapter.createFrPage(fr)
}

function clearPendingIngestion(manifestPath: string): boolean {
  const raw = readFileSync(manifestPath, 'utf8')
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const tools = parsed.tools as Record<string, unknown> | undefined
  const srs = tools?.srs as Record<string, unknown> | undefined
  if (!srs || srs.pendingIngestion === undefined) return false
  delete srs.pendingIngestion
  writeFileSync(manifestPath, `${JSON.stringify(parsed, null, 2)}\n`)
  return true
}

export async function runWriteSrs(options: WriteSrsOptions): Promise<number> {
  if (!options.specPath) {
    process.stderr.write('write-srs: --spec <path> is required.\n')
    return 2
  }

  const manifestPath = resolve(options.manifestPath)
  let manifest: SrsManifestSubset
  let candidates: DraftCandidate[]
  try {
    manifest = readJson<SrsManifestSubset>(manifestPath, 'write-srs')
    candidates = normalizeCandidates(readJson<unknown>(resolve(options.specPath), 'write-srs'))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }

  if (candidates.length === 0) {
    process.stderr.write('write-srs: spec file contains zero candidates — nothing to write.\n')
    return 2
  }

  try {
    candidates.forEach((candidate, index) => assertCandidateShape(candidate, index))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }

  let adapter: SrsAdapter
  try {
    adapter = await createSrsAdapter(manifest)
    await adapter.init()
  } catch (error) {
    if (error instanceof SrsConfigError) {
      process.stderr.write(`✗ ${error.message}\n`)
      return error.code === 'missing' ? 3 : 4
    }
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`✗ write-srs init failed — ${message}\n`)
    return 5
  }

  const report: WriteSrsReport = { created: [], failed: [], pendingIngestionCleared: false }
  const logicalIdMap = new Map<string, string>()

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    try {
      const page = await applyCandidate(adapter, candidate, logicalIdMap, i)
      report.created.push({ index: i, kind: candidate.kind, page })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      report.failed.push({ index: i, kind: candidate.kind, error: message })
      report.rollbackHint =
        report.created.length > 0
          ? `Partial write: ${report.created.length} page(s) were created before the failure at candidate #${i}. Notion has no transactional rollback — archive these pages manually if you want to retry from scratch: ${report.created.map((c) => c.page.url || c.page.id).join(', ')}`
          : `Failure on the first candidate (#${i}). Nothing to roll back.`
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      return 6
    }
  }

  if (options.clearPendingIngestion !== false) {
    try {
      report.pendingIngestionCleared = clearPendingIngestion(manifestPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`write-srs: wrote ${report.created.length} page(s) but failed to clear pendingIngestion — ${message}\n`)
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      return 7
    }
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return 0
}

export function parseArgs(argv: string[]): { specPath: string; manifestPath: string; clearPendingIngestion: boolean } {
  let specPath = ''
  let manifestPath = '.saasfoundry.json'
  let clearPendingIngestion = true
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--spec' || arg === '-s') specPath = argv[++i] ?? ''
    else if (arg.startsWith('--spec=')) specPath = arg.slice('--spec='.length)
    else if (arg === '--manifest' || arg === '-m') manifestPath = argv[++i] ?? manifestPath
    else if (arg.startsWith('--manifest=')) manifestPath = arg.slice('--manifest='.length)
    else if (arg === '--no-clear-pending') clearPendingIngestion = false
  }
  return { specPath, manifestPath, clearPendingIngestion }
}

if (require.main === module) {
  const parsed = parseArgs(process.argv.slice(2))
  runWriteSrs(parsed)
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`write-srs: unexpected error — ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    })
}
