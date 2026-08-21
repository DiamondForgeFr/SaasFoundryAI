import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { titleCarriesOwnId } from '../../builders/srs/fr-title-format'
import { DraftCandidate, EpicSpec, FrSpec, PageRef, SrsAdapter } from '../../builders/srs/types'
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

// A drafter may legitimately pass a title with or without its FR id. The renderer
// strips a duplicated prefix, so this never rejects — but a spec that carries the id
// twice is still a spec the drafter should fix at the source, and silence is how
// `FR-LIVE-011 — FR-LIVE-011 — …` reached two live Notion pages unnoticed.
function warnOnDuplicatedFrId(candidate: DraftCandidate, index: number, warn: (message: string) => void): void {
  if (candidate.kind !== 'fr' || !candidate.fr) return
  const { id, title } = candidate.fr.fr
  if (id && title && titleCarriesOwnId(id, title)) {
    warn(`write-srs: candidate #${index} (fr) — title already starts with "${id}"; the duplicate prefix is stripped when the page is rendered.\n`)
  }
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

/**
 * Level of a page written in this batch. A page with a `parentId` sits under a
 * feature, so it is a version; one without sits under the root, so it is a
 * feature. Position decides, never the title.
 */
type PageLevel = 'feature' | 'version'

async function applyCandidate(
  adapter: SrsAdapter,
  candidate: DraftCandidate,
  logicalIdMap: Map<string, string>,
  levels: Map<string, PageLevel>,
  versionsByFeature: Map<string, string[]>,
  index: number
): Promise<PageRef> {
  if (candidate.kind === 'epic') {
    const epic = resolveEpicParent(candidate.epic!, logicalIdMap, index)
    const level: PageLevel = epic.parentId === undefined ? 'feature' : 'version'
    const withIndex = level === 'feature' && epic.id ? { ...epic, versions: versionsByFeature.get(epic.id) } : epic
    const page = await adapter.createEpicPage(withIndex)
    if (epic.id) {
      logicalIdMap.set(epic.id, page.id)
      levels.set(epic.id, level)
    }
    return page
  }
  const fr = resolveFrParent(candidate.fr!, logicalIdMap, index)
  assertFrParentIsVersion(candidate.fr!, levels, index)
  return adapter.createFrPage(fr)
}

/** A version page is created under the feature its `parentId` names. */
function resolveEpicParent(epic: EpicSpec, logicalIdMap: Map<string, string>, index: number): EpicSpec {
  if (epic.parentId === undefined) return epic
  const resolved = logicalIdMap.get(epic.parentId)
  if (!resolved) {
    const known = Array.from(logicalIdMap.keys())
    const hint = known.length > 0 ? `Known logical IDs so far: ${known.join(', ')}.` : 'No page in this batch declared a logical "id" before this one.'
    throw new Error(`write-srs: candidate #${index} (epic) references parentId="${epic.parentId}" but no page with that logical id was created before it. ${hint}`)
  }
  return { ...epic, parentPageId: resolved }
}

/**
 * Refuses an FR written directly under a feature.
 *
 * Reading tolerates the flat shape because 25 real features are in it and their
 * FRs must not be lost. Writing does not: there is no reason to create a new
 * feature that already needs `sf srs normalize`.
 */
function assertFrParentIsVersion(fr: FrSpec, levels: Map<string, PageLevel>, index: number): void {
  const logicalId = fr.parentEpicId
  if (!logicalId) return
  if (levels.get(logicalId) !== 'feature') return
  throw new Error(
    `write-srs: candidate #${index} (fr) is attached to "${logicalId}", which is a feature, not a version.\n` +
      `  Epic = feature + version: an FR belongs to a version, so the batch must declare one.\n` +
      `  Add an epic candidate with parentId="${logicalId}" and point this FR at its logical id.`
  )
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

export function collectVersionsByFeature(candidates: DraftCandidate[]): Map<string, string[]> {
  const byFeature = new Map<string, string[]>()
  for (const candidate of candidates) {
    if (candidate.kind !== 'epic' || !candidate.epic?.parentId) continue
    const bucket = byFeature.get(candidate.epic.parentId) ?? []
    bucket.push(candidate.epic.title)
    byFeature.set(candidate.epic.parentId, bucket)
  }
  return byFeature
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

  candidates.forEach((candidate, index) => warnOnDuplicatedFrId(candidate, index, (message) => process.stderr.write(message)))

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
  const levels = new Map<string, PageLevel>()

  // A feature page is created before its versions exist, and `updatePage` appends
  // rather than replaces — so indexing the versions afterwards would duplicate the
  // list on every re-run. The batch already declares them, so read it up front.
  const versionsByFeature = collectVersionsByFeature(candidates)

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    try {
      const page = await applyCandidate(adapter, candidate, logicalIdMap, levels, versionsByFeature, i)
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
