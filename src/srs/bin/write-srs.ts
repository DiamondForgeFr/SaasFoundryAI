import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { titleCarriesOwnId } from '../../builders/srs/fr-title-format'
import { FEATURE_HEADINGS, VERSIONS_INTRO } from '../../builders/srs/templates/pages/epic.tpl'
import { DraftCandidate, EpicSpec, FrItem, FrSpec, PageBlock, PageRef, SectionAddition, SrsAdapter, VersionFrItem } from '../../builders/srs/types'
import { createSrsAdapter, SrsConfigError, SrsManifestSubset } from '../index'
import { rejectUnknownOption, runFromCommandLine } from './args'

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
  /** What an existing feature could not receive in place, for the operator to add by hand (#899). */
  notPlaced?: string[]
}

/**
 * A `parentId` naming a page that already exists rather than a logical id of the batch: a
 * Notion URL or page id. That is how a version is added to a feature written in an earlier
 * batch — the normal path for every version after the first (#899).
 */
export function isPageReference(value: string): boolean {
  return /^https?:\/\//i.test(value.trim()) || /^[0-9a-f]{32}$/i.test(value.trim().replace(/-/g, ''))
}

const normalizedPageId = (id: string): string => id.replace(/-/g, '').toLowerCase()

function readJson<T>(path: string, label: string): T {
  const raw = readFileSync(path, 'utf8')
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${label}: failed to parse ${path} as JSON — ${message}`)
  }
}

export function normalizeCandidates(input: unknown): DraftCandidate[] {
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

export interface SpecCheck {
  errors: string[]
  warnings: string[]
}

/**
 * Every check a spec can pass or fail without a backend: each candidate's shape, logical
 * parents declared earlier in the batch, FRs attached to a version rather than a feature.
 * `write` runs it before creating any page — a parent it could not resolve used to stop the
 * batch halfway, pages already written — and `sf srs validate --spec` runs it alone (#877).
 */
export function checkSpec(candidates: DraftCandidate[]): SpecCheck {
  const errors: string[] = []
  const warnings: string[] = []
  const levels = new Map<string, PageLevel>()
  candidates.forEach((candidate, index) => {
    try {
      assertCandidateShape(candidate, index)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
      return
    }
    warnOnDuplicatedFrId(candidate, index, (message) => warnings.push(message.trimEnd()))
    if (candidate.kind === 'epic') {
      const epic = candidate.epic!
      // A page reference names an existing feature; write resolves and checks it before writing anything
      if (epic.parentId !== undefined && !levels.has(epic.parentId) && !isPageReference(epic.parentId)) errors.push(unresolvedParent('epic', 'parentId', epic.parentId, levels, index))
      if (epic.id) levels.set(epic.id, epic.parentId === undefined ? 'feature' : 'version')
      return
    }
    const fr = candidate.fr!
    if (fr.parentEpicPageId) return
    if (!levels.has(fr.parentEpicId!)) errors.push(unresolvedParent('fr', 'parentEpicId', fr.parentEpicId!, levels, index))
    else {
      try {
        assertFrParentIsVersion(fr, levels, index)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
  })
  return { errors, warnings }
}

function unresolvedParent(kind: 'epic' | 'fr', field: string, logicalId: string, levels: Map<string, PageLevel>, index: number): string {
  const known = Array.from(levels.keys())
  const hint = known.length > 0 ? `Known logical IDs so far: ${known.join(', ')}.` : 'No page in this batch declared a logical "id" before this one.'
  return `write-srs: candidate #${index} (${kind}) references ${field}="${logicalId}" but no page with that logical id is declared before it. ${hint}${kind === 'epic' ? " To add a version to a feature written earlier, set parentId to that feature page's URL or id." : ''}`
}

/**
 * Resolves every `parentId` that names an existing page, before the first page is written,
 * and requires it to be a feature: a direct child of the SRS root. Returns the errors; on
 * success each reference maps to its page id and counts as a feature of the batch.
 */
async function resolveExistingFeatures(
  adapter: SrsAdapter,
  candidates: DraftCandidate[],
  rootPageId: string | undefined,
  logicalIdMap: Map<string, string>,
  levels: Map<string, PageLevel>
): Promise<string[]> {
  const references = [
    ...new Set(candidates.flatMap((candidate) => (candidate.kind === 'epic' && candidate.epic?.parentId && isPageReference(candidate.epic.parentId) ? [candidate.epic.parentId] : [])))
  ]
  if (references.length === 0) return []
  if (!rootPageId) return ['write-srs: a version names an existing feature, but `.saasfoundry.json → tools.srs.rootPage.id` is not set, so that page cannot be checked to be a feature of this SRS.']
  const features = new Set((await adapter.listChildren(rootPageId)).map((page) => normalizedPageId(page.id)))
  const errors: string[] = []
  for (const reference of references) {
    try {
      const page = await adapter.resolveParent(reference)
      if (!features.has(normalizedPageId(page.id))) {
        errors.push(`write-srs: parentId "${reference}" is the page "${page.name}", which is not a feature of this SRS (a direct child of its root page). A version goes under a feature.`)
        continue
      }
      logicalIdMap.set(reference, page.id)
      levels.set(reference, 'feature')
    } catch (error) {
      errors.push(`write-srs: parentId "${reference}" could not be resolved — ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return errors
}

/**
 * Adds to a feature written in an earlier batch, in place, and returns what could not be
 * placed. A section the page lacks is appended at its end rather than lost.
 */
async function extendExistingFeature(adapter: SrsAdapter, featurePageId: string, additions: SectionAddition[], fallbackTitle: string): Promise<string[]> {
  if (additions.length === 0) return []
  if (!adapter.extendSections) return additions.map((addition) => `${fallbackTitle}: add to "${addition.heading}" by hand — this SRS backend cannot edit an existing page.`)
  const outcomes = await adapter.extendSections(featurePageId, additions)
  const unplaced = additions.filter((_, index) => outcomes[index] === 'unplaced')
  if (unplaced.length > 0) {
    await adapter.updatePage(featurePageId, {
      blocks: unplaced.flatMap((addition): PageBlock[] =>
        addition.kind === 'list-items'
          ? [
              { kind: 'heading', level: 2, text: addition.heading },
              { kind: 'bulleted_list', items: addition.items }
            ]
          : [
              { kind: 'heading', level: 2, text: `${addition.heading} — added by ${fallbackTitle}` },
              { kind: 'table', header: addition.layouts[0].header, rows: addition.layouts[0].rows }
            ]
      )
    })
  }
  return []
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
  frsByFeature: Map<string, VersionFrItem[]>,
  index: number,
  notPlaced: string[] = []
): Promise<PageRef> {
  if (candidate.kind === 'epic') {
    const epic = resolveEpicParent(candidate.epic!, logicalIdMap, index)
    const level: PageLevel = epic.parentId === undefined ? 'feature' : 'version'
    const withIndex = level === 'feature' && epic.id ? { ...epic, versions: versionsByFeature.get(epic.id), versionFrs: frsByFeature.get(epic.id) } : epic
    const page = await adapter.createEpicPage(withIndex)
    if (epic.id) {
      logicalIdMap.set(epic.id, page.id)
      levels.set(epic.id, level)
    }
    // A feature written in an earlier batch lists its versions too, which only it can show
    if (epic.parentId !== undefined && isPageReference(epic.parentId)) {
      const versions: SectionAddition = { kind: 'list-items', heading: FEATURE_HEADINGS.versions, items: [epic.title], createBefore: FEATURE_HEADINGS.traceability, intro: VERSIONS_INTRO }
      notPlaced.push(...(await extendExistingFeature(adapter, epic.parentPageId, [versions], epic.title)))
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

/**
 * The FRs of each feature's versions, from the batch: those a version lists in `frs`, and the
 * `fr` candidates attached to it (which carry the UR/DS references). Merged by FR id, the
 * candidate winning. An FR attached by page id rather than logical id cannot be traced to a
 * feature and is left out.
 */
export function collectFrsByFeature(candidates: DraftCandidate[]): Map<string, VersionFrItem[]> {
  const versionOf = new Map<string, { feature: string; title: string }>()
  for (const candidate of candidates) {
    const epic = candidate.kind === 'epic' ? candidate.epic : undefined
    if (epic?.id && epic.parentId) versionOf.set(epic.id, { feature: epic.parentId, title: epic.title })
  }
  const byFeature = new Map<string, Map<string, VersionFrItem>>()
  const add = (versionId: string, fr: FrItem, override: boolean): void => {
    const version = versionOf.get(versionId)
    if (!version || !fr.id) return
    const bucket = byFeature.get(version.feature) ?? new Map<string, VersionFrItem>()
    const known = bucket.get(fr.id)
    if (!known || override) bucket.set(fr.id, { ...known, ...fr, version: version.title })
    byFeature.set(version.feature, bucket)
  }
  for (const candidate of candidates) {
    const epic = candidate.kind === 'epic' ? candidate.epic : undefined
    if (epic?.id && epic.parentId) for (const fr of epic.frs ?? []) add(epic.id, fr, false)
  }
  for (const candidate of candidates) {
    if (candidate.kind === 'fr' && candidate.fr?.parentEpicId) add(candidate.fr.parentEpicId, candidate.fr.fr, true)
  }
  return new Map([...byFeature].map(([feature, frs]) => [feature, [...frs.values()]]))
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

  // Nothing is written unless the whole batch can be: an unresolved parent used to stop it halfway
  const check = checkSpec(candidates)
  for (const warning of check.warnings) process.stderr.write(`${warning}\n`)
  if (check.errors.length > 0) {
    for (const error of check.errors) process.stderr.write(`${error}\n`)
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
  const levels = new Map<string, PageLevel>()
  const notPlaced: string[] = []

  // A version under a feature written earlier: its page is checked before anything is written
  const referenceErrors = await resolveExistingFeatures(adapter, candidates, manifest.tools?.srs?.rootPage?.id, logicalIdMap, levels)
  if (referenceErrors.length > 0) {
    for (const error of referenceErrors) process.stderr.write(`${error}\n`)
    return 2
  }

  // A feature page is created before its versions exist, and `updatePage` appends
  // rather than replaces — so indexing the versions afterwards would duplicate the
  // list on every re-run. The batch already declares them, so read it up front.
  const versionsByFeature = collectVersionsByFeature(candidates)
  const frsByFeature = collectFrsByFeature(candidates)

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    try {
      const page = await applyCandidate(adapter, candidate, logicalIdMap, levels, versionsByFeature, frsByFeature, i, notPlaced)
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

  if (notPlaced.length > 0) {
    report.notPlaced = notPlaced
    for (const entry of notPlaced) process.stderr.write(`write-srs: ${entry}\n`)
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
    else if (arg.startsWith('-')) rejectUnknownOption('write-srs', arg, arg === '--dry-run' ? 'write has no dry run; check the spec offline with `sf srs validate --spec <path>`' : undefined)
  }
  return { specPath, manifestPath, clearPendingIngestion }
}

if (require.main === module) {
  runFromCommandLine('write-srs', (argv) => runWriteSrs(parseArgs(argv)), 'Usage: write-srs.ts --spec <path> [--manifest <path>] [--no-clear-pending]')
}
