import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createSrsAdapter, SrsConfigError, SrsManifestSubset } from '../index'

interface ValidateOptions {
  manifestPath: string
}

function parseManifest(path: string): SrsManifestSubset {
  const raw = readFileSync(path, 'utf8')
  try {
    return JSON.parse(raw) as SrsManifestSubset
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`validate: failed to parse ${path} as JSON — ${message}`)
  }
}

export async function runValidate(options: ValidateOptions): Promise<number> {
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
    const backend = manifest.tools?.srs?.backend ?? '<unknown>'
    process.stdout.write(`✓ sf-srs backend "${backend}" is reachable (init OK)\n`)
    return 0
  } catch (error) {
    if (error instanceof SrsConfigError) {
      process.stderr.write(`✗ ${error.message}\n`)
      return error.code === 'missing' ? 3 : 4
    }
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`✗ sf-srs init failed — ${message}\n`)
    return 5
  }
}

if (require.main === module) {
  const manifestPath = process.argv[2] ?? '.saasfoundry.json'
  runValidate({ manifestPath })
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`validate: unexpected error — ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    })
}
