import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { DsItem, FrSpec, PageBlock, PageContent, PageRef, SrsAdapter, TcItem, UrItem } from '../../builders/srs/types'
import { createSrsAdapter, SrsConfigError, SrsManifestSubset } from '../index'

// The conversational eval hook (SUB-10 / #170) lives inside SKILL.md as
// Claude-side heuristics — it has no message parser. When Claude decides an
// utterance describes a new UR / FR / DS / TC and the user approves the
// proposed diff, this bin applies the ADD to the configured SRS backend.
//
// Scope : ADD-only. Modifying an existing UR / FR / DS / TC is out of scope
// because `SrsAdapter.updatePage` is append-only on Notion (block-level
// replace / delete is not available through the current contract).
// Modifications are tracked as a follow-up SUB.
export type SrsUpdateKind = 'add-ur' | 'add-fr' | 'add-ds' | 'add-tc'

export interface SrsUpdatePatch {
  kind: SrsUpdateKind
  pageId: string
  item: UrItem | DsItem | TcItem | FrSpec
  note?: string
}

export interface ApplyResult {
  kind: SrsUpdateKind
  targetPageId: string
  newPage?: PageRef
}

export interface ApplyIO {
  stdout: (chunk: string) => void
  stderr: (chunk: string) => void
  readStdin: () => string
}

function defaultIO(): ApplyIO {
  return {
    stdout: (chunk) => process.stdout.write(chunk),
    stderr: (chunk) => process.stderr.write(chunk),
    readStdin: () => readFileSync(0, 'utf8')
  }
}

export interface ApplyOptions {
  patchPath: string
  manifestPath: string
}

export function parseArgs(argv: string[]): ApplyOptions {
  const opts: ApplyOptions = { patchPath: '', manifestPath: '.saasfoundry.json' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--patch') {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) throw new Error('apply-srs-update: --patch requires a value')
      opts.patchPath = next
      i++
    } else if (arg.startsWith('--patch=')) {
      const value = arg.slice('--patch='.length)
      if (!value) throw new Error('apply-srs-update: --patch= requires a value')
      opts.patchPath = value
    } else if (arg === '--manifest') {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) throw new Error('apply-srs-update: --manifest requires a value')
      opts.manifestPath = next
      i++
    } else if (arg.startsWith('--manifest=')) {
      const value = arg.slice('--manifest='.length)
      if (!value) throw new Error('apply-srs-update: --manifest= requires a value')
      opts.manifestPath = value
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
  if (kind !== 'add-ur' && kind !== 'add-fr' && kind !== 'add-ds' && kind !== 'add-tc') {
    throw new Error(`apply-srs-update: unknown kind="${String(kind)}" (expected add-ur | add-fr | add-ds | add-tc)`)
  }
  if (!patch.pageId || typeof patch.pageId !== 'string') throw new Error('apply-srs-update: patch is missing `pageId`')
  if (!patch.item || typeof patch.item !== 'object') throw new Error('apply-srs-update: patch is missing `item`')
}

export function renderAppendBlocks(patch: SrsUpdatePatch): PageBlock[] {
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
  }
  if (patch.note) blocks.push({ kind: 'paragraph', text: `Note: ${patch.note}` })
  return blocks
}

export async function runApplyUpdate(options: ApplyOptions, io: ApplyIO = defaultIO()): Promise<number> {
  const manifestPath = resolve(options.manifestPath)
  let manifest: SrsManifestSubset
  let patch: SrsUpdatePatch
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as SrsManifestSubset
    const raw = options.patchPath ? readFileSync(resolve(options.patchPath), 'utf8') : io.readStdin()
    patch = parsePatchJson(raw)
    assertPatchShape(patch)
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`)
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

  const result: ApplyResult = { kind: patch.kind, targetPageId: patch.pageId }
  try {
    if (patch.kind === 'add-fr') {
      const spec = patch.item as FrSpec
      if (!spec.fr || !spec.fr.id || !spec.fr.title) throw new Error('apply-srs-update: add-fr requires item.fr.id and item.fr.title')
      if (!spec.parentEpicPageId) spec.parentEpicPageId = patch.pageId
      const page = await adapter.createFrPage(spec)
      result.newPage = page
    } else {
      const blocks = renderAppendBlocks(patch)
      const content: PageContent = { blocks }
      await adapter.updatePage(patch.pageId, content)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(`✗ apply-srs-update: failed to apply patch — ${message}\n`)
    return 5
  }

  io.stdout(`${JSON.stringify(result, null, 2)}\n`)
  return 0
}

if (require.main === module) {
  let options: ApplyOptions
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.stderr.write('\nUsage: apply-srs-update.ts [--patch <path>] [--manifest <path>]\n(Patch JSON is read from stdin when --patch is omitted.)\n')
    process.exit(1)
  }
  runApplyUpdate(options)
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`apply-srs-update: unexpected error — ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    })
}
