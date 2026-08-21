import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { renderStoryTicketBody } from '../../builders/srs/templates/tickets/story.tpl'
import { FrItem, PageRef, StoryTicketBodySpec } from '../../builders/srs/types'
import { createSrsAdapter, SrsConfigError, SrsManifestSubset } from '../index'
import { parseFrPageTitle } from '../tree/fr-title'

export interface SpawnOptions {
  ticket: string
  epic: string
  /**
   * Title, id or URL of a version page under `--epic`. Required when the feature
   * is versioned: a batch of tickets belongs to one version, never to the whole
   * feature, because `Epic = feature + version`.
   */
  version?: string
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
    } else if (a === '--version') {
      opts.version = takeValue(argv, i, '--version')
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

// The FR title parser lives in `src/srs/tree/fr-title.ts` and is shared with the
// inventory walk. This file used to carry a second one matching `FR-\d+` only, so
// every real id like FR-LIVE-007 failed it and got fabricated into a ticket from
// its raw title. One grammar, one parser.

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

/**
 * Picks the version to spawn from, or explains why it cannot.
 *
 * A batch of tickets belongs to one version and never to the whole feature, so
 * pointing spawn at a versioned feature is an error — not a licence to guess. The
 * previous behaviour did guess: it created one ticket per version page, named
 * after the page, and none for the real FRs.
 */
async function selectVersion(
  adapter: { listChildren: (id: string) => Promise<PageRef[]> },
  versions: PageRef[],
  requested: string | undefined,
  featureTitle: string,
  io: SpawnIO
): Promise<{ version: PageRef; frPages: PageRef[] } | null> {
  const frPagesByVersion = new Map<string, PageRef[]>()
  for (const version of versions) {
    const children = await adapter.listChildren(version.id)
    frPagesByVersion.set(version.id, children)
  }

  const listVersions = (): void => {
    for (const version of versions) {
      const count = (frPagesByVersion.get(version.id) ?? []).filter((page) => parseFrPageTitle(page.title) !== null).length
      io.stderr(`    ${version.title}${' '.repeat(Math.max(1, 36 - version.title.length))}(${count} FR)  ${version.url}\n`)
    }
  }

  if (!requested) {
    io.stderr(`✗ spawn: « ${featureTitle} » is a versioned feature, not an Epic.\n`)
    io.stderr(`  Pick the version to spawn:\n\n`)
    listVersions()
    io.stderr(`\n  → sf srs spawn --ticket <n> --epic <url> --version "${versions[0].title}"\n`)
    return null
  }

  const needle = requested.trim().toLowerCase()
  const match = versions.find((version) => version.title.trim().toLowerCase() === needle || version.id === requested || (version.url ?? '').includes(requested))

  if (!match) {
    io.stderr(`✗ spawn: no version "${requested}" under « ${featureTitle} ». Available:\n\n`)
    listVersions()
    return null
  }

  return { version: match, frPages: frPagesByVersion.get(match.id) ?? [] }
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
  let epicTitle: string
  let mainSpecUrl: string | undefined
  try {
    const resolved = await adapter.resolveParent(options.epic)
    epicPageId = resolved.id
    epicTitle = resolved.name
    mainSpecUrl = resolved.url
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(`✗ spawn: could not resolve epic "${options.epic}" — ${message}\n`)
    return 6
  }

  let children: PageRef[]
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

  // Classify by position, exactly as the inventory walk does: under a feature, a
  // page that is not an FR is a version. The level is never read from the title —
  // a version is called MVP, V1 or "v2 — Titre" depending on who wrote it.
  const versionCandidates = children.filter((child) => parseFrPageTitle(child.title) === null)

  let holderTitle = epicTitle
  let holderPageUrl = mainSpecUrl

  if (versionCandidates.length > 0) {
    // A feature carrying both loose FRs and version pages is ambiguous: spawning
    // would silently pick one shape over the other.
    if (versionCandidates.length < children.length) {
      io.stderr(`✗ spawn: « ${epicTitle} » mixes ${children.length - versionCandidates.length} loose FR page(s) with ${versionCandidates.length} version page(s).\n`)
      io.stderr(`  Those FRs belong to no version. Run 'sf srs normalize --feature <url>' first, then spawn a version.\n`)
      return 2
    }

    const selected = await selectVersion(adapter, versionCandidates, options.version, epicTitle, io)
    if (!selected) return 2

    holderTitle = `${epicTitle} - ${selected.version.title}`
    holderPageUrl = selected.version.url
    children = selected.frPages
  } else if (options.version) {
    io.stderr(`✗ spawn: « ${epicTitle} » is not versioned — it holds its FR pages directly, so --version has nothing to select.\n`)
    return 2
  }

  // Never fabricate. At this point every child must be an FR: either the feature
  // holds them directly, or we descended into the selected version.
  const planned: PlannedCreation[] = []
  for (const child of children) {
    const parsed = parseFrPageTitle(child.title)
    if (!parsed) {
      io.stderr(`✗ spawn: page "${child.title}" under « ${holderTitle} » is neither an FR nor a version page.\n`)
      io.stderr(`  Nothing was created. Producing a ticket from a raw title is worse than failing: it looks planned and is empty.\n`)
      return 2
    }
    const fr: FrItem = { id: parsed.id, title: parsed.title }
    const spec: StoryTicketBodySpec = { fr, frPageUrl: child.url, mainSpecUrl: holderPageUrl }
    planned.push({ frId: fr.id, title: `${fr.id}: ${fr.title}`, frPageUrl: child.url, body: renderStoryTicketBody(spec) })
  }

  io.stdout(`spawn: Epic « ${holderTitle} » — ${planned.length} FR page(s), planning Story tickets under parent #${options.ticket}\n`)
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
    process.stderr.write(`\nUsage: spawn.ts --ticket <ticket-number> --epic <page-url-or-id> [--version <title-url-or-id>] [--dry-run] [--manifest <path>] [--bypass-reason <text>]\n`)
    process.exit(1)
  }
  runSpawn(options)
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`spawn: unexpected error — ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    })
}
