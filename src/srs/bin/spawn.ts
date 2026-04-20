import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { renderStoryTicketBody } from '../../builders/srs/templates/tickets/story.tpl'
import { FrItem, StoryTicketBodySpec } from '../../builders/srs/types'
import { createSrsAdapter, SrsConfigError, SrsManifestSubset } from '../index'

export interface SpawnOptions {
  ticket: string
  epic: string
  dryRun: boolean
  manifestPath: string
  bypassReason: string
}

export interface PlannedCreation {
  frId: string
  title: string
  frPageUrl: string
  body: string
}

export interface SpawnIO {
  stdout: (chunk: string) => void
  stderr: (chunk: string) => void
  createSubtask: (parent: string, title: string, body: string, bypassReason: string) => { childNumber: string }
}

function takeValue(argv: string[], i: number, flag: string): string {
  const next = argv[i + 1]
  if (next === undefined || next.startsWith('--')) {
    throw new Error(`spawn: ${flag} requires a value`)
  }
  return next
}

export function parseArgs(argv: string[]): SpawnOptions {
  const opts: SpawnOptions = { ticket: '', epic: '', dryRun: false, manifestPath: '.saasfoundry.json', bypassReason: 'spawned-from-srs' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--ticket') {
      opts.ticket = takeValue(argv, i, '--ticket')
      i++
    } else if (a === '--epic') {
      opts.epic = takeValue(argv, i, '--epic')
      i++
    } else if (a === '--dry-run') {
      opts.dryRun = true
    } else if (a === '--manifest') {
      opts.manifestPath = takeValue(argv, i, '--manifest')
      i++
    } else if (a === '--bypass-reason') {
      opts.bypassReason = takeValue(argv, i, '--bypass-reason')
      i++
    }
  }
  if (!opts.ticket) throw new Error('spawn: missing --ticket <ticket-number>')
  if (!opts.epic) throw new Error('spawn: missing --epic <page-url-or-id>')
  return opts
}

function parseManifest(path: string): SrsManifestSubset {
  const raw = readFileSync(path, 'utf8')
  try {
    return JSON.parse(raw) as SrsManifestSubset
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`spawn: failed to parse ${path} as JSON — ${message}`)
  }
}

// Parse the SUB-3 page template convention ("FR-001 — Login flow" / "FR-001: Login flow").
// When the title doesn't match, hasFrId=false and the id/title are identical (the raw title);
// callers are expected to surface a warning and avoid rendering "title: title" duplicates.
export function parseFrTitle(pageTitle: string): { id: string; title: string; hasFrId: boolean } {
  const match = pageTitle.match(/^\s*(FR-\d+)\s*[—:\-]\s*(.+)$/i)
  if (match) return { id: match[1].toUpperCase(), title: match[2].trim(), hasFrId: true }
  const trimmed = pageTitle.trim()
  return { id: trimmed, title: trimmed, hasFrId: false }
}

export function extractFrId(title: string): string {
  return parseFrTitle(title).id
}

export function extractFrTitle(title: string): string {
  return parseFrTitle(title).title
}

function defaultIO(): SpawnIO {
  return {
    stdout: (chunk) => process.stdout.write(chunk),
    stderr: (chunk) => process.stderr.write(chunk),
    createSubtask: (parent, title, body, bypassReason) => {
      const output = execFileSync('.claude/skills/sf-workflow/workflow-cli.sh', ['create-subtask', parent, title, body, '--bypass-srs', bypassReason], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit']
      })
      const match = output.match(/#(\d+)\s+linked/)
      return { childNumber: match ? match[1] : '' }
    }
  }
}

export async function runSpawn(options: SpawnOptions, io: SpawnIO = defaultIO()): Promise<number> {
  const manifestPath = resolve(options.manifestPath)
  let manifest: SrsManifestSubset
  try {
    manifest = parseManifest(manifestPath)
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }

  let adapter
  try {
    adapter = await createSrsAdapter(manifest)
    await adapter.init()
  } catch (error) {
    if (error instanceof SrsConfigError) {
      io.stderr(`✗ ${error.message}\n`)
      return error.code === 'missing' ? 3 : 4
    }
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(`✗ spawn: adapter init failed — ${message}\n`)
    return 5
  }

  let epicPageId: string
  let mainSpecUrl: string | undefined
  try {
    const resolved = await adapter.resolveParent(options.epic)
    epicPageId = resolved.id
    mainSpecUrl = resolved.url
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(`✗ spawn: could not resolve epic "${options.epic}" — ${message}\n`)
    return 6
  }

  let children
  try {
    children = await adapter.listChildren(epicPageId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(`✗ spawn: listChildren failed — ${message}\n`)
    return 7
  }

  if (children.length === 0) {
    io.stdout(`spawn: epic has no child pages — nothing to spawn\n`)
    return 0
  }

  const planned: PlannedCreation[] = children.map((child) => {
    const parsed = parseFrTitle(child.title)
    if (!parsed.hasFrId) {
      io.stderr(`  ⚠ spawn: child page "${child.title}" does not match the "FR-### — Title" convention; using raw title as the ticket name.\n`)
    }
    const fr: FrItem = { id: parsed.id, title: parsed.title }
    const spec: StoryTicketBodySpec = { fr, frPageUrl: child.url, mainSpecUrl }
    const ticketTitle = parsed.hasFrId ? `${fr.id}: ${fr.title}` : fr.title
    return { frId: fr.id, title: ticketTitle, frPageUrl: child.url, body: renderStoryTicketBody(spec) }
  })

  io.stdout(`spawn: found ${planned.length} FR page(s) under the epic — planning Story tickets under parent #${options.ticket}\n`)
  for (const p of planned) {
    io.stdout(`  • ${p.frId} → ${p.title} (${p.frPageUrl})\n`)
  }

  if (options.dryRun) {
    io.stdout(`\n[dry-run] No tickets created. Re-run without --dry-run to apply.\n`)
    return 0
  }

  const created: string[] = []
  for (const p of planned) {
    try {
      const { childNumber } = io.createSubtask(options.ticket, p.title, p.body, options.bypassReason)
      if (!childNumber) {
        io.stderr(`  ✗ ${p.frId}: could not determine new ticket number from create-subtask output\n`)
        return 8
      }
      io.stdout(`  ✓ ${p.frId} → #${childNumber}\n`)
      created.push(childNumber)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      io.stderr(`  ✗ failed to create ${p.frId}: ${message}\n`)
      return 8
    }
  }

  io.stdout(`\nspawn: created ${created.length} Story ticket(s) under #${options.ticket}.\n`)
  return 0
}

if (require.main === module) {
  let options: SpawnOptions
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.stderr.write(`\nUsage: spawn.ts --ticket <ticket-number> --epic <page-url-or-id> [--dry-run] [--manifest <path>] [--bypass-reason <text>]\n`)
    process.exit(1)
  }
  runSpawn(options)
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`spawn: unexpected error — ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    })
}
