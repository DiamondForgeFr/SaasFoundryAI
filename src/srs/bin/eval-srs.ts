import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { SrsAdapter } from '../../builders/srs/types'
import { buildSrsInventory } from '../eval/inventory'
import { matchSrsAgainstScanners } from '../eval/matcher'
import { formatHumanReport, formatJsonReport } from '../eval/report'
import { buildReviewPacket } from '../eval/review-packet'
import { createSrsAdapter, SrsConfigError, SrsManifestSubset } from '../index'
import { collectFindings } from './codebase-scan'

interface EvalManifest extends SrsManifestSubset {
  structure?: 'monorepo' | 'multirepo' | 'cli'
  tools?: {
    srs?: {
      backend?: string
      rootPage?: { id?: string }
      scan?: { exclude?: string[] }
    }
  }
}

export interface EvalSrsOptions {
  scanPath: string
  manifestPath: string
  rootPageId?: string
  thresholdPct: number
  output: 'human' | 'json'
  fixtureInventoryPath?: string
  fixtureFindingsPath?: string
  reviewPacketPath?: string
}

export interface EvalSrsIO {
  stdout: (chunk: string) => void
  stderr: (chunk: string) => void
}

function defaultIo(): EvalSrsIO {
  return {
    stdout: (chunk) => process.stdout.write(chunk),
    stderr: (chunk) => process.stderr.write(chunk)
  }
}

function parseManifest(path: string): EvalManifest {
  const raw = readFileSync(path, 'utf8')
  try {
    return JSON.parse(raw) as EvalManifest
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`eval: failed to parse ${path} as JSON — ${message}`)
  }
}

export async function runEvalSrs(options: EvalSrsOptions, io: EvalSrsIO = defaultIo()): Promise<number> {
  const scanRoot = resolve(options.scanPath && options.scanPath.trim().length > 0 ? options.scanPath : process.cwd())
  if (!existsSync(scanRoot) || !statSync(scanRoot).isDirectory()) {
    io.stderr(`eval: --path must be an existing directory (got ${scanRoot})\n`)
    return 2
  }

  const manifestPath = resolve(options.manifestPath)
  let manifest: EvalManifest
  try {
    manifest = parseManifest(manifestPath)
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }

  const rootPageId = options.rootPageId ?? manifest.tools?.srs?.rootPage?.id
  if (!rootPageId || rootPageId.trim().length === 0) {
    io.stderr('eval: --root-page is required (or set tools.srs.rootPage.id in the manifest)\n')
    return 2
  }

  try {
    let inventory
    let findings
    if (options.fixtureInventoryPath && options.fixtureFindingsPath) {
      inventory = JSON.parse(readFileSync(resolve(options.fixtureInventoryPath), 'utf8'))
      findings = JSON.parse(readFileSync(resolve(options.fixtureFindingsPath), 'utf8'))
    } else {
      const adapter: SrsAdapter = await createSrsAdapter(manifest)
      await adapter.init()
      inventory = await buildSrsInventory(adapter, rootPageId)
      const exclusions = { exclude: manifest.tools?.srs?.scan?.exclude }
      findings = await collectFindings(scanRoot, manifest.structure === 'monorepo' || manifest.structure === 'multirepo' ? manifest.structure : undefined, exclusions)
    }

    const report = matchSrsAgainstScanners(inventory, findings, { thresholdPct: options.thresholdPct })
    if (options.reviewPacketPath) {
      const packet = buildReviewPacket(inventory, findings, report)
      const packetPath = resolve(options.reviewPacketPath)
      writeFileSync(packetPath, JSON.stringify(packet, null, 2) + '\n', 'utf8')
      io.stderr(`review packet written → ${packetPath}\n`)
    }
    io.stdout(options.output === 'json' ? formatJsonReport(report) : formatHumanReport(report))
    return report.overall.status === 'fresh' ? 0 : 1
  } catch (error) {
    if (error instanceof SrsConfigError) {
      io.stderr(`✗ ${error.message}\n`)
      return error.code === 'missing' ? 3 : 4
    }
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(`✗ eval failed — ${message}\n`)
    return 5
  }
}

export function parseArgs(argv: string[]): EvalSrsOptions {
  let scanPath = ''
  let manifestPath = '.saasfoundry.json'
  let rootPageId: string | undefined
  let thresholdPct = 80
  let output: 'human' | 'json' = 'human'
  let fixtureInventoryPath: string | undefined
  let fixtureFindingsPath: string | undefined
  let reviewPacketPath: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--path' || arg === '-p') scanPath = argv[++i] ?? ''
    else if (arg.startsWith('--path=')) scanPath = arg.slice('--path='.length)
    else if (arg === '--manifest' || arg === '-m') manifestPath = argv[++i] ?? manifestPath
    else if (arg.startsWith('--manifest=')) manifestPath = arg.slice('--manifest='.length)
    else if (arg === '--root-page') rootPageId = argv[++i]
    else if (arg.startsWith('--root-page=')) rootPageId = arg.slice('--root-page='.length)
    else if (arg === '--threshold') thresholdPct = Number(argv[++i] ?? thresholdPct)
    else if (arg.startsWith('--threshold=')) thresholdPct = Number(arg.slice('--threshold='.length))
    else if (arg === '--json') output = 'json'
    else if (arg === '--fixture-inventory') fixtureInventoryPath = argv[++i]
    else if (arg === '--fixture-findings') fixtureFindingsPath = argv[++i]
    else if (arg === '--review-packet') reviewPacketPath = argv[++i]
    else if (arg.startsWith('--review-packet=')) reviewPacketPath = arg.slice('--review-packet='.length)
  }
  return { scanPath, manifestPath, rootPageId, thresholdPct, output, fixtureInventoryPath, fixtureFindingsPath, reviewPacketPath }
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2))
  runEvalSrs(options)
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`eval: unexpected error — ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    })
}
