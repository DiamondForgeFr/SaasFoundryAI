import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { nextFreeIds, nextVersionLabel, readFeatureRegister, REQUIREMENT_CATEGORIES } from '../feature-register'
import { createSrsAdapter, SrsConfigError, SrsManifestSubset } from '../index'
import { rejectUnknownOption, SrsUsageError } from './args'

/**
 * The next version number and the next free requirement ids of one feature, read from the
 * SRS itself (#919). Taking them from an earlier reading is how two sessions wrote the same
 * `v3` and the same ids a minute apart; `write` now refuses that, and this is how to renumber.
 */

export interface NextIdsOptions {
  manifestPath: string
  feature: string
  json: boolean
}

export interface NextIdsIO {
  stdout: (chunk: string) => void
  stderr: (chunk: string) => void
}

function defaultIO(): NextIdsIO {
  return { stdout: (chunk) => process.stdout.write(chunk), stderr: (chunk) => process.stderr.write(chunk) }
}

export function parseArgs(argv: string[]): NextIdsOptions {
  const opts: NextIdsOptions = { manifestPath: '.saasfoundry.json', feature: '', json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--feature' || a === '--manifest') {
      if (next === undefined || next.startsWith('--')) throw new SrsUsageError(`next-ids: ${a} requires a value`)
      if (a === '--feature') opts.feature = next
      else opts.manifestPath = next
      i++
    } else if (a === '--json') {
      opts.json = true
    } else {
      rejectUnknownOption('next-ids', a)
    }
  }
  if (!opts.feature) throw new SrsUsageError('next-ids: --feature <page id or URL> is required')
  return opts
}

export async function runNextIds(options: NextIdsOptions, io: NextIdsIO = defaultIO()): Promise<number> {
  let manifest: SrsManifestSubset
  try {
    manifest = JSON.parse(readFileSync(resolve(options.manifestPath), 'utf8')) as SrsManifestSubset
  } catch (error) {
    io.stderr(`next-ids: cannot read ${options.manifestPath} — ${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
  try {
    const adapter = await createSrsAdapter(manifest)
    await adapter.init()
    const feature = await adapter.resolveParent(options.feature)
    const register = await readFeatureRegister(adapter, feature.id)
    const next = nextFreeIds(register)
    const nextVersion = nextVersionLabel(register)
    if (options.json) {
      io.stdout(`${JSON.stringify({ feature: { id: feature.id, title: feature.name }, versions: register.versionTitles, nextVersion, next }, null, 2)}\n`)
    } else {
      io.stdout(`${feature.name}\n  next version: ${nextVersion}\n`)
      for (const category of REQUIREMENT_CATEGORIES) io.stdout(`  ${category.padEnd(3)}  ${next[category].length > 0 ? next[category].join(', ') : '— none yet'}\n`)
    }
    return 0
  } catch (error) {
    if (error instanceof SrsConfigError) {
      io.stderr(`✗ ${error.message}\n`)
      return error.code === 'missing' ? 3 : 4
    }
    io.stderr(`✗ next-ids: ${error instanceof Error ? error.message : String(error)}\n`)
    return 5
  }
}
