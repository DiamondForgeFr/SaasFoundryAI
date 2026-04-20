import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { RawContent } from '../../builders/srs/types'
import { createSrsAdapter, SrsConfigError, SrsManifestSubset } from '../index'

export interface DraftFromNotionPagesOptions {
  pageIds: string[]
  manifestPath: string
}

export interface DraftFromNotionPagesOutput {
  source: 'notion-pages'
  pages: RawContent[]
}

function parseManifest(path: string): SrsManifestSubset {
  const raw = readFileSync(path, 'utf8')
  try {
    return JSON.parse(raw) as SrsManifestSubset
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`draft-from-notion-pages: failed to parse ${path} as JSON — ${message}`)
  }
}

export async function runDraftFromNotionPages(options: DraftFromNotionPagesOptions): Promise<number> {
  if (!options.pageIds || options.pageIds.length === 0) {
    process.stderr.write('draft-from-notion-pages: --ids <id1,id2,...> is required (at least one page).\n')
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
    const adapter = await createSrsAdapter(manifest)
    await adapter.init()
    const pages: RawContent[] = []
    for (const id of options.pageIds) {
      const trimmed = id.trim()
      if (!trimmed) continue
      pages.push(await adapter.fetchPage(trimmed))
    }
    const output: DraftFromNotionPagesOutput = { source: 'notion-pages', pages }
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    return 0
  } catch (error) {
    if (error instanceof SrsConfigError) {
      process.stderr.write(`✗ ${error.message}\n`)
      return error.code === 'missing' ? 3 : 4
    }
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`✗ draft-from-notion-pages failed — ${message}\n`)
    return 5
  }
}

function parseArgs(argv: string[]): { pageIds: string[]; manifestPath: string } {
  let pageIds: string[] = []
  let manifestPath = '.saasfoundry.json'
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--ids')
      pageIds = (argv[++i] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    else if (arg.startsWith('--ids='))
      pageIds = arg
        .slice('--ids='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    else if (arg === '--manifest' || arg === '-m') manifestPath = argv[++i] ?? manifestPath
    else if (arg.startsWith('--manifest=')) manifestPath = arg.slice('--manifest='.length)
  }
  return { pageIds, manifestPath }
}

if (require.main === module) {
  const { pageIds, manifestPath } = parseArgs(process.argv.slice(2))
  runDraftFromNotionPages({ pageIds, manifestPath })
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`draft-from-notion-pages: unexpected error — ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    })
}
