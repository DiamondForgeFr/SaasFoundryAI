import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createSrsAdapter, SrsConfigError, SrsManifestSubset } from '../index'
import { walkSrsTree } from '../tree/walk'

/**
 * Enumerates the versions the SRS declares, in the shape `plan-milestone`
 * consumes.
 *
 * The proposal engine ranks `srs-version` candidates FIRST and gives them the
 * only trigger that ignores the ticket-count threshold — because a version the
 * product has declared is a release scope somebody already decided, which is
 * strictly better evidence than a pile of tickets that happens to be large.
 *
 * It had no way to learn about them. `--srs-versions` existed as a flag with no
 * caller in the entire repository (#570), so the engine ran with `srsVersions:
 * []` forever and reported, truthfully and uselessly, that nothing could be
 * grouped by what the product declared.
 *
 * The traversal is #515's — one walk that knows `feature → version → FR` — so
 * this command never re-derives the shape by hand.
 */

/**
 * `SrsManifestSubset` does not carry `rootPage`; `eval-srs` widens it locally
 * for the same reason. Same shape, deliberately — one grammar for where the SRS
 * root lives.
 */
interface VersionsManifest extends SrsManifestSubset {
  tools?: {
    srs?: {
      backend?: string
      rootPage?: { id?: string }
      scan?: { exclude?: string[] }
    }
  }
}

export interface ListVersionsOptions {
  manifestPath: string
  rootPageId?: string
}

/** One version page, plus the feature it belongs to for a readable rationale. */
export interface SrsVersionRef {
  title: string
  url: string
  pageId: string
  feature: string
  frCount: number
}

export interface ListVersionsIO {
  stdout: (chunk: string) => void
  stderr: (chunk: string) => void
}

function defaultIO(): ListVersionsIO {
  return {
    stdout: (chunk) => process.stdout.write(chunk),
    stderr: (chunk) => process.stderr.write(chunk)
  }
}

function parseManifest(path: string): VersionsManifest {
  const raw = readFileSync(path, 'utf8')
  try {
    return JSON.parse(raw) as VersionsManifest
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`list-versions: failed to parse ${path} as JSON — ${message}`)
  }
}

export function parseArgs(argv: string[]): ListVersionsOptions {
  const opts: ListVersionsOptions = { manifestPath: '.saasfoundry.json' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--manifest') {
      if (next === undefined || next.startsWith('--')) throw new Error('list-versions: --manifest requires a value')
      opts.manifestPath = next
      i++
    } else if (a === '--root-page') {
      if (next === undefined || next.startsWith('--')) throw new Error('list-versions: --root-page requires a value')
      opts.rootPageId = next
      i++
    }
  }
  return opts
}

export async function runListVersions(options: ListVersionsOptions, io: ListVersionsIO = defaultIO()): Promise<number> {
  const manifestPath = resolve(options.manifestPath)
  let manifest: VersionsManifest
  try {
    manifest = parseManifest(manifestPath)
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }

  const rootPageId = options.rootPageId ?? manifest.tools?.srs?.rootPage?.id
  if (!rootPageId || rootPageId.trim().length === 0) {
    io.stderr('list-versions: --root-page is required (or set tools.srs.rootPage.id in the manifest)\n')
    return 2
  }

  try {
    const adapter = await createSrsAdapter(manifest)
    await adapter.init()
    const tree = await walkSrsTree(adapter, rootPageId.trim())

    const versions: SrsVersionRef[] = []
    for (const feature of tree.features) {
      for (const version of feature.versions) {
        versions.push({ title: version.title, url: version.url, pageId: version.pageId, feature: feature.title, frCount: version.frCount })
      }
    }

    io.stdout(`${JSON.stringify({ versions }, null, 2)}\n`)
    return 0
  } catch (error) {
    if (error instanceof SrsConfigError) {
      io.stderr(`✗ ${error.message}\n`)
      return error.code === 'missing' ? 3 : 4
    }
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(`✗ list-versions: ${message}\n`)
    return 5
  }
}
