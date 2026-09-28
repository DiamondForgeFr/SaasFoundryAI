import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { SrsAdapter } from '../../builders/srs/types'
import { createSrsAdapter, SrsConfigError, SrsManifestSubset } from '../index'
import { SrsTreeFeature, walkSrsTree } from '../tree/walk'

// The shared subset does not carry rootPage; eval-srs widens it the same way.
interface NormalizeManifest extends SrsManifestSubset {
  tools?: {
    srs?: {
      backend?: string
      rootPage?: { id?: string }
    }
  }
}

export interface NormalizeOptions {
  manifestPath: string
  /** Restrict the run to one feature — page URL or id. */
  feature?: string
  /** Title given to the version page that gets created. */
  versionName: string
  /**
   * Writing is opt-in. A dry run is the default because the target is a
   * production SRS: the cost of an unintended 196-page sweep is not symmetric
   * with the cost of typing one more flag.
   */
  apply: boolean
  rootPageId?: string
}

export interface NormalizeIO {
  stdout: (chunk: string) => void
  stderr: (chunk: string) => void
}

export interface PlannedNormalization {
  featurePageId: string
  featureTitle: string
  frPageIds: string[]
  /** `FR-AREA-NN — Title`. The bare title is not enough to identify a page in a failure report. */
  frLabels: string[]
}

const DEFAULT_VERSION_NAME = 'MVP'

function takeValue(argv: string[], i: number, flag: string): string {
  const next = argv[i + 1]
  if (next === undefined || next.startsWith('--')) throw new Error(`normalize: ${flag} requires a value`)
  return next
}

export function parseArgs(argv: string[]): NormalizeOptions {
  const opts: NormalizeOptions = { manifestPath: '.saasfoundry.json', versionName: DEFAULT_VERSION_NAME, apply: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--feature') {
      opts.feature = takeValue(argv, i, '--feature')
      i++
    } else if (a === '--version-name') {
      opts.versionName = takeValue(argv, i, '--version-name')
      i++
    } else if (a === '--manifest') {
      opts.manifestPath = takeValue(argv, i, '--manifest')
      i++
    } else if (a === '--root-page') {
      opts.rootPageId = takeValue(argv, i, '--root-page')
      i++
    } else if (a === '--apply') {
      opts.apply = true
    } else if (a === '--dry-run') {
      // Accepted and ignored: a dry run is what happens without --apply. Taking
      // the flag means a script that spells out its intent still works.
      opts.apply = false
    }
  }
  return opts
}

function parseManifest(path: string): NormalizeManifest {
  const raw = readFileSync(path, 'utf8')
  try {
    return JSON.parse(raw) as NormalizeManifest
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`normalize: failed to parse ${path} as JSON — ${message}`)
  }
}

/**
 * Selects the features that need a version page.
 *
 * A feature already holding its FRs under a version is left untouched, and a
 * feature carrying no FR at all is skipped rather than given an empty version
 * page — three real features are in that state, and an empty version would be a
 * level with nothing under it.
 */
export function planNormalization(features: SrsTreeFeature[], frsByFeature: Map<string, Array<{ pageId: string; label: string }>>): PlannedNormalization[] {
  const planned: PlannedNormalization[] = []
  for (const feature of features) {
    if (feature.conforming) continue
    const frs = frsByFeature.get(feature.pageId) ?? []
    if (frs.length === 0) continue
    planned.push({
      featurePageId: feature.pageId,
      featureTitle: feature.title,
      frPageIds: frs.map((fr) => fr.pageId),
      frLabels: frs.map((fr) => fr.label)
    })
  }
  return planned
}

export async function runNormalize(options: NormalizeOptions, io: NormalizeIO): Promise<number> {
  const manifestPath = resolve(options.manifestPath)
  let manifest: NormalizeManifest
  try {
    manifest = parseManifest(manifestPath)
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }

  const rootPageId = options.rootPageId ?? manifest.tools?.srs?.rootPage?.id
  if (!rootPageId) {
    io.stderr(`✗ normalize: no SRS root page — set tools.srs.rootPage.id in the manifest or pass --root-page.\n`)
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
    io.stderr(`✗ normalize: adapter init failed — ${error instanceof Error ? error.message : String(error)}\n`)
    return 5
  }

  let tree
  try {
    tree = await walkSrsTree(adapter, rootPageId)
  } catch (error) {
    io.stderr(`✗ normalize: could not walk the SRS — ${error instanceof Error ? error.message : String(error)}\n`)
    return 5
  }

  // FRs sitting directly under a feature are the ones that need a home.
  const frsByFeature = new Map<string, Array<{ pageId: string; label: string }>>()
  for (const fr of tree.frs) {
    if (fr.version !== undefined) continue
    const bucket = frsByFeature.get(fr.featurePageId) ?? []
    bucket.push({ pageId: fr.pageId, label: `${fr.id} — ${fr.title}` })
    frsByFeature.set(fr.featurePageId, bucket)
  }

  let features = tree.features
  if (options.feature) {
    const needle = options.feature.trim()
    const match = features.find((f) => f.pageId === needle || f.url === needle || f.title.trim().toLowerCase() === needle.toLowerCase())
    if (!match) {
      io.stderr(`✗ normalize: no feature matching "${options.feature}" under the root page.\n`)
      return 2
    }
    if (match.conforming) {
      io.stdout(`normalize: « ${match.title} » already holds its FRs under a version page — nothing to do.\n`)
      return 0
    }
    features = [match]
  }

  const planned = planNormalization(features, frsByFeature)

  if (planned.length === 0) {
    io.stdout(`normalize: every feature already conforms — nothing to do.\n`)
    return 0
  }

  const totalPages = planned.reduce((sum, p) => sum + p.frPageIds.length, 0)
  io.stdout(`normalize: ${planned.length} feature(s) to normalize, ${totalPages} FR page(s) to move.\n\n`)
  for (const p of planned) {
    io.stdout(`« ${p.featureTitle} »\n`)
    io.stdout(`  + create   « ${options.versionName} »\n`)
    io.stdout(`  → move ${p.frPageIds.length} FR page(s) under it\n`)
    for (const label of p.frLabels) io.stdout(`      ${label}\n`)
    io.stdout(`\n`)
  }

  const skipped = features.filter((f) => !f.conforming && (frsByFeature.get(f.pageId) ?? []).length === 0)
  for (const f of skipped) {
    io.stdout(`« ${f.title} » — no FR page, skipped rather than given an empty version.\n`)
  }

  if (!options.apply) {
    io.stdout(`\n[dry-run] Nothing was written. Re-run with --apply to perform the moves.\n`)
    return 0
  }

  // Notion has no transactional rollback, so a run that dies partway must leave
  // a precise account of what already moved. Anything less turns a partial
  // failure into a manual audit of 196 pages.
  const movedPages: string[] = []
  for (const p of planned) {
    let versionPageId: string
    try {
      const versionPage = await adapter.createPage(p.featurePageId, options.versionName)
      versionPageId = versionPage.id
      io.stdout(`✓ « ${p.featureTitle} » — created « ${options.versionName} »\n`)
    } catch (error) {
      io.stderr(`✗ « ${p.featureTitle} » — could not create the version page: ${error instanceof Error ? error.message : String(error)}\n`)
      reportProgress(io, movedPages)
      return 6
    }

    for (let i = 0; i < p.frPageIds.length; i++) {
      const pageId = p.frPageIds[i]
      try {
        await adapter.move(pageId, versionPageId)
        movedPages.push(pageId)
        io.stdout(`    → ${p.frLabels[i]}\n`)
      } catch (error) {
        io.stderr(`✗ « ${p.featureTitle} » — failed to move "${p.frLabels[i]}": ${error instanceof Error ? error.message : String(error)}\n`)
        reportProgress(io, movedPages)
        return 6
      }
    }
  }

  io.stdout(`\nnormalize: ${planned.length} feature(s) normalized, ${movedPages.length} FR page(s) moved.\n`)
  io.stdout(`Page ids and URLs are unchanged — the pages were moved, not recreated.\n`)
  return 0
}

function reportProgress(io: NormalizeIO, movedPages: string[]): void {
  if (movedPages.length === 0) {
    io.stderr(`  No page was moved before the failure.\n`)
    return
  }
  io.stderr(`  ${movedPages.length} page(s) were already moved and are left in place:\n`)
  for (const id of movedPages) io.stderr(`    ${id}\n`)
  io.stderr(`  Re-running is safe: a feature that now holds a version page is treated as conforming.\n`)
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2))
  const io: NormalizeIO = { stdout: (c) => process.stdout.write(c), stderr: (c) => process.stderr.write(c) }
  runNormalize(options, io)
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`normalize: unexpected error — ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    })
}
