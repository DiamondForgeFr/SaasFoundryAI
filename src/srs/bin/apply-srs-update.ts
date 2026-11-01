import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { DsItem, FrSpec, NfrItem, PageBlock, PageContent, PageRef, SrsAdapter, TcItem, UrItem } from '../../builders/srs/types'
import { createSrsAdapter, SrsConfigError, SrsManifestSubset } from '../index'
import { ExistingSrsTicket, ReconciliationRequirement } from '../spawn/reconciliation'
import { applyUpdateFr, UpdateFrPatch, validateUpdateFrPatch } from '../update-fr'
import { locatePage, PageLocation, placeFrInExistingVersion, placeItemInFeature, readSrsTree, RequirementItem } from '../version-extension'
import { rejectUnknownOption, runFromCommandLine, SrsUsageError } from './args'

// The conversational eval hook (SUB-10 / #170) lives inside SKILL.md as
// Claude-side heuristics — it has no message parser. When Claude decides an
// utterance describes a new UR / FR / DS / TC, or a change to an FR, and the user
// approves the proposed diff, this bin applies it to the configured SRS backend.
//
// Two families of patch. `add-*` adds an item where `write` puts it (#917): a UR /
// DS / TC / NFR to its table on the feature page, with the version of the page it
// was added from; an FR added to an existing version to that version's FR table and
// change list, and to the feature's tables. Only when that cannot be done is it
// appended to the page under an "Added …" heading, and the result says so.
//
// `update-fr` (#945) changes an existing FR where it is listed — its page, its
// version's FR table, its feature's FR table — and adds one line to the version's
// change list. Nothing is appended. It needs an adapter that can amend a page; see
// `../update-fr.ts`. `--dry-run` shows what it would change and writes nothing.
export type SrsAddKind = 'add-ur' | 'add-fr' | 'add-ds' | 'add-tc' | 'add-nfr'
export type SrsUpdateKind = SrsAddKind | 'update-fr'

const ADD_KINDS: SrsAddKind[] = ['add-ur', 'add-fr', 'add-ds', 'add-tc', 'add-nfr']
const KINDS: SrsUpdateKind[] = [...ADD_KINDS, 'update-fr']

export interface SrsAddPatch {
  kind: SrsAddKind
  pageId: string
  item: UrItem | DsItem | TcItem | NfrItem | FrSpec
  note?: string
}

export type SrsUpdatePatch = SrsAddPatch | UpdateFrPatch

export interface ApplyResult {
  kind: SrsAddKind
  targetPageId: string
  newPage?: PageRef
  /** `tables`: in the canonical tables; `appended`: under an "Added …" heading at the end of the page. */
  placed?: 'tables' | 'appended'
  /** Why something was appended rather than placed, or what is left to add by hand. */
  notPlaced?: string[]
}

/** `SrsManifestSubset` does not carry `rootPage`; the tree walk needs it to locate the page. */
interface ApplyManifest extends SrsManifestSubset {
  tools?: { srs?: { backend?: string; rootPage?: { id?: string } } }
}

export interface ApplyIO {
  stdout: (chunk: string) => void
  stderr: (chunk: string) => void
  readStdin: () => string
  /** The tickets on the board that carry these FRs, to name the Story an amended FR leaves behind. Absent: the follow-up says to look for it. */
  inspectTickets?: (requirements: ReconciliationRequirement[]) => ExistingSrsTicket[]
}

function defaultIO(): ApplyIO {
  return {
    stdout: (chunk) => process.stdout.write(chunk),
    stderr: (chunk) => process.stderr.write(chunk),
    readStdin: () => readFileSync(0, 'utf8'),
    inspectTickets: (requirements) => {
      const output = execFileSync(
        '.claude/skills/sf-workflow/workflow-cli.sh',
        ['inspect-srs-tickets', '--no-parent', ...requirements.flatMap((requirement) => ['--fr', `${requirement.frId}=${requirement.frPageUrl}`])],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      )
      const parsed = JSON.parse(output) as unknown
      if (!Array.isArray(parsed)) throw new Error('inspect-srs-tickets returned a non-array response')
      return parsed as ExistingSrsTicket[]
    }
  }
}

export interface ApplyOptions {
  patchPath: string
  manifestPath: string
  /** `update-fr` only: print what would change and write nothing. */
  dryRun?: boolean
}

export function parseArgs(argv: string[]): ApplyOptions {
  const opts: ApplyOptions = { patchPath: '', manifestPath: '.saasfoundry.json', dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      opts.dryRun = true
    } else if (arg === '--patch') {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) throw new SrsUsageError('apply-srs-update: --patch requires a value')
      opts.patchPath = next
      i++
    } else if (arg.startsWith('--patch=')) {
      const value = arg.slice('--patch='.length)
      if (!value) throw new SrsUsageError('apply-srs-update: --patch= requires a value')
      opts.patchPath = value
    } else if (arg === '--manifest') {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) throw new SrsUsageError('apply-srs-update: --manifest requires a value')
      opts.manifestPath = next
      i++
    } else if (arg.startsWith('--manifest=')) {
      const value = arg.slice('--manifest='.length)
      if (!value) throw new SrsUsageError('apply-srs-update: --manifest= requires a value')
      opts.manifestPath = value
    } else {
      rejectUnknownOption('apply-srs-update', arg)
    }
  }
  return opts
}

function parsePatchJson(raw: string): SrsUpdatePatch {
  try {
    return JSON.parse(raw) as SrsUpdatePatch
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`apply-srs-update: failed to parse patch JSON — ${message}`)
  }
}

export function assertPatchShape(patch: SrsUpdatePatch): void {
  if (!patch || typeof patch !== 'object') throw new Error('apply-srs-update: patch must be a JSON object')
  const kind = (patch as { kind?: unknown }).kind
  if (!KINDS.includes(kind as SrsUpdateKind)) {
    throw new Error(`apply-srs-update: unknown kind="${String(kind)}" (expected ${KINDS.join(' | ')})`)
  }
  if (patch.kind === 'update-fr') {
    validateUpdateFrPatch(patch)
    return
  }
  if (!patch.pageId || typeof patch.pageId !== 'string') throw new Error('apply-srs-update: patch is missing `pageId`')
  if (!patch.item || typeof patch.item !== 'object') throw new Error('apply-srs-update: patch is missing `item`')
}

export function renderAppendBlocks(patch: SrsAddPatch): PageBlock[] {
  const blocks: PageBlock[] = []
  if (patch.kind === 'add-ur') {
    const ur = patch.item as UrItem
    if (!ur.id || !ur.narrative) throw new Error('apply-srs-update: add-ur requires item.id and item.narrative')
    blocks.push({ kind: 'heading', level: 2, text: `Added User Requirement — ${ur.id}` })
    const suffix = ur.businessValue ? ` (value: ${ur.businessValue})` : ''
    blocks.push({ kind: 'bulleted_list', items: [`${ur.id}: ${ur.narrative}${suffix}`] })
  } else if (patch.kind === 'add-ds') {
    const ds = patch.item as DsItem
    if (!ds.id || !ds.title) throw new Error('apply-srs-update: add-ds requires item.id and item.title')
    blocks.push({ kind: 'heading', level: 2, text: `Added Design Item — ${ds.id}` })
    const suffix = ds.description ? ` — ${ds.description}` : ''
    blocks.push({ kind: 'bulleted_list', items: [`${ds.id}: ${ds.title}${suffix}`] })
  } else if (patch.kind === 'add-tc') {
    const tc = patch.item as TcItem
    if (!tc.id || !tc.title) throw new Error('apply-srs-update: add-tc requires item.id and item.title')
    blocks.push({ kind: 'heading', level: 2, text: `Added Test Case — ${tc.id}` })
    const suffix = tc.expectedResult ? ` → ${tc.expectedResult}` : ''
    blocks.push({ kind: 'bulleted_list', items: [`${tc.id}: ${tc.title}${suffix}`] })
    if (tc.steps && tc.steps.length > 0) blocks.push({ kind: 'numbered_list', items: tc.steps })
  } else if (patch.kind === 'add-nfr') {
    const nfr = patch.item as NfrItem
    if (!nfr.id || !nfr.title) throw new Error('apply-srs-update: add-nfr requires item.id and item.title')
    blocks.push({ kind: 'heading', level: 2, text: `Added Non-Functional Requirement — ${nfr.id}` })
    const suffix = nfr.target ? ` (target: ${nfr.target})` : ''
    blocks.push({ kind: 'bulleted_list', items: [`${nfr.id}: ${nfr.title}${suffix}`] })
  }
  if (patch.note) blocks.push({ kind: 'paragraph', text: `Note: ${patch.note}` })
  return blocks
}

export async function runApplyUpdate(options: ApplyOptions, io: ApplyIO = defaultIO()): Promise<number> {
  const manifestPath = resolve(options.manifestPath)
  let manifest: ApplyManifest
  let patch: SrsUpdatePatch
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ApplyManifest
    const raw = options.patchPath ? readFileSync(resolve(options.patchPath), 'utf8') : io.readStdin()
    patch = parsePatchJson(raw)
    assertPatchShape(patch)
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }

  // An option that is ignored is worse than one that is refused (#877): an add patch written
  // while the caller asked for a preview
  if (options.dryRun && patch.kind !== 'update-fr') {
    io.stderr(`✗ apply-srs-update: --dry-run applies to an update-fr patch only; ${patch.kind} writes at once. Nothing was written.\n`)
    return 2
  }

  let adapter: SrsAdapter
  try {
    adapter = await createSrsAdapter(manifest)
    await adapter.init()
  } catch (error) {
    if (error instanceof SrsConfigError) {
      io.stderr(`✗ ${error.message}\n`)
      return error.code === 'missing' ? 3 : 4
    }
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(`✗ apply-srs-update: adapter init failed — ${message}\n`)
    return 5
  }

  if (patch.kind === 'update-fr') {
    try {
      const outcome = await applyUpdateFr(patch, {
        adapter,
        backend: manifest.tools?.srs?.backend,
        rootPageId: manifest.tools?.srs?.rootPage?.id,
        dryRun: options.dryRun === true,
        inspectTickets: io.inspectTickets
      })
      if (outcome.code === 0) {
        for (const entry of outcome.result.notPlaced ?? []) io.stderr(`apply-srs-update: ${entry}\n`)
        for (const entry of outcome.result.warnings ?? []) io.stderr(`apply-srs-update: warning — ${entry}\n`)
        io.stdout(`${JSON.stringify(outcome.result, null, 2)}\n`)
        return 0
      }
      io.stderr(outcome.message)
      if (outcome.code === 6) io.stdout(`${JSON.stringify(outcome.payload, null, 2)}\n`)
      return outcome.code
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      io.stderr(`✗ apply-srs-update: failed to apply patch — ${message}\n`)
      return 5
    }
  }

  const result: ApplyResult = { kind: patch.kind, targetPageId: patch.pageId }
  try {
    const location = await locate(adapter, manifest.tools?.srs?.rootPage?.id, patch.pageId)
    if (patch.kind === 'add-fr') {
      const spec = patch.item as FrSpec
      if (!spec.fr || !spec.fr.id || !spec.fr.title) throw new Error('apply-srs-update: add-fr requires item.fr.id and item.fr.title')
      if (!spec.parentEpicPageId) spec.parentEpicPageId = patch.pageId
      result.newPage = await adapter.createFrPage(spec)
      const notPlaced = location.found ? await placeFrInExistingVersion(adapter, location.found, spec) : [location.reason]
      result.placed = notPlaced.length === 0 ? 'tables' : undefined
      if (notPlaced.length > 0) result.notPlaced = notPlaced
    } else {
      const blocks = renderAppendBlocks(patch)
      const notPlaced = location.found ? await placeItemInFeature(adapter, location.found, requirementOf(patch)) : [location.reason]
      if (notPlaced.length === 0) {
        result.placed = 'tables'
      } else {
        const content: PageContent = { blocks }
        await adapter.updatePage(patch.pageId, content)
        result.placed = 'appended'
        result.notPlaced = notPlaced
      }
    }
    for (const entry of result.notPlaced ?? []) io.stderr(`apply-srs-update: ${entry}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(`✗ apply-srs-update: failed to apply patch — ${message}\n`)
    return 5
  }

  io.stdout(`${JSON.stringify(result, null, 2)}\n`)
  return 0
}

if (require.main === module) {
  runFromCommandLine(
    'apply-srs-update',
    (argv) => runApplyUpdate(parseArgs(argv)),
    'Usage: apply-srs-update.ts [--patch <path>] [--manifest <path>] [--dry-run]\n(Patch JSON is read from stdin when --patch is omitted. --dry-run applies to update-fr only.)'
  )
}

function requirementOf(patch: SrsAddPatch): RequirementItem {
  if (patch.kind === 'add-ur') return { kind: 'ur', item: patch.item as UrItem }
  if (patch.kind === 'add-ds') return { kind: 'ds', item: patch.item as DsItem }
  if (patch.kind === 'add-tc') return { kind: 'tc', item: patch.item as TcItem }
  return { kind: 'nfr', item: patch.item as NfrItem }
}

/** Where the patch's page sits, or why it cannot be placed in the tables. */
async function locate(adapter: SrsAdapter, rootPageId: string | undefined, pageId: string): Promise<{ found: PageLocation; reason?: undefined } | { found?: undefined; reason: string }> {
  if (!rootPageId) return { reason: 'tools.srs.rootPage.id is not set, so the page cannot be found in the SRS: appended under an "Added …" heading.' }
  const tree = await readSrsTree(adapter, rootPageId)
  const found = tree ? locatePage(tree, pageId) : undefined
  return found ? { found } : { reason: `page ${pageId} is not a feature, version or FR page of this SRS: appended under an "Added …" heading.` }
}
