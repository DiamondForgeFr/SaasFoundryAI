import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { PageRef } from '../../builders/srs/types'
import { createSrsAdapter, SrsConfigError, SrsManifestSubset } from '../index'

export interface BrowseTreeOptions {
  parentId: string
  manifestPath: string
}

export interface BrowseTreeOutput {
  parentId: string
  children: PageRef[]
}

function parseManifest(path: string): SrsManifestSubset {
  const raw = readFileSync(path, 'utf8')
  try {
    return JSON.parse(raw) as SrsManifestSubset
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`browse-tree: failed to parse ${path} as JSON — ${message}`)
  }
}

export async function runBrowseTree(options: BrowseTreeOptions): Promise<number> {
  if (!options.parentId || options.parentId.trim().length === 0) {
    process.stderr.write('browse-tree: --parent <id> is required.\n')
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
    const children = await adapter.listChildren(options.parentId.trim())
    const output: BrowseTreeOutput = { parentId: options.parentId.trim(), children }
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    return 0
  } catch (error) {
    if (error instanceof SrsConfigError) {
      process.stderr.write(`✗ ${error.message}\n`)
      return error.code === 'missing' ? 3 : 4
    }
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`✗ browse-tree failed — ${message}\n`)
    return 5
  }
}

export function parseArgs(argv: string[]): { parentId: string; manifestPath: string } {
  let parentId = ''
  let manifestPath = '.saasfoundry.json'
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--parent' || arg === '-p') parentId = argv[++i] ?? ''
    else if (arg.startsWith('--parent=')) parentId = arg.slice('--parent='.length)
    else if (arg === '--manifest' || arg === '-m') manifestPath = argv[++i] ?? manifestPath
    else if (arg.startsWith('--manifest=')) manifestPath = arg.slice('--manifest='.length)
    else if (!arg.startsWith('-') && !parentId) parentId = arg
  }
  return { parentId, manifestPath }
}

if (require.main === module) {
  const { parentId, manifestPath } = parseArgs(process.argv.slice(2))
  runBrowseTree({ parentId, manifestPath })
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`browse-tree: unexpected error — ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    })
}
