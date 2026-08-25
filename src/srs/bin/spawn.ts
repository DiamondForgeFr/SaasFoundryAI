import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { renderEpicTicketBody } from '../../builders/srs/templates/tickets/epic.tpl'
import { renderStoryTicketBody } from '../../builders/srs/templates/tickets/story.tpl'
import { FrItem, PageRef, StoryTicketBodySpec } from '../../builders/srs/types'
import { createSrsAdapter, SrsConfigError, SrsManifestSubset } from '../index'
import { parseFrPageTitle } from '../tree/fr-title'

export interface SpawnOptions {
  /**
   * Existing ticket to hang the Stories under. Omit it and spawn creates the
   * Epic itself, named `<feature> - <version>` — the one thing the agent used to
   * have to remember and got wrong.
   */
  ticket?: string
  epic: string
  /**
   * Title, id or URL of a version page under `--epic`. Required when the feature
   * is versioned: a batch of tickets belongs to one version, never to the whole
   * feature, because `Epic = feature + version`.
   */
  version?: string
  /**
   * Release the spawned tickets belong to. Given, the milestone is created or
   * reused, the version page is associated to it, and everything this run
   * creates joins it.
   *
   * The CLI will not derive it from the version page title. A milestone names a
   * RELEASE (`v1.0.0`), a version page names a feature's version (`v2 — Prise de
   * notes vivante`), and several of the latter may point at one of the former —
   * see #542 R2. Choosing a release name is a decision, which is the same reason
   * `plan-milestone` emits `name: null` on every candidate it proposes.
   */
  milestone?: string
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
  createEpic: (title: string, body: string, bypassReason: string) => { epicNumber: string }
  /**
   * Create the milestone, or report that it already existed. Reuse is the normal
   * case: re-spawning a version must not produce a second release.
   */
  ensureMilestone: (name: string) => { created: boolean }
  assignMilestone: (ticket: string, name: string) => void
  /** Link the SRS version page to the release. Already a no-op when repeated. */
  associateMilestone: (name: string, versionPageUrl: string) => void
}

function takeValue(argv: string[], i: number, flag: string): string {
  const next = argv[i + 1]
  if (next === undefined || next.startsWith('--')) {
    throw new Error(`spawn: ${flag} requires a value`)
  }
  return next
}

export function parseArgs(argv: string[]): SpawnOptions {
  const opts: SpawnOptions = { epic: '', dryRun: false, manifestPath: '.saasfoundry.json', bypassReason: 'spawned-from-srs' }
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
    } else if (a === '--milestone') {
      opts.milestone = takeValue(argv, i, '--milestone')
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
    },
    createEpic: (title, body, bypassReason) => {
      const output = execFileSync('.claude/skills/sf-workflow/workflow-cli.sh', ['create-epic', title, body, '--bypass-srs', bypassReason], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit']
      })
      const match = output.match(/Epic #(\d+) created/)
      return { epicNumber: match ? match[1] : '' }
    },
    // `milestone create` refuses a name that already exists on purpose — two
    // releases sharing one milestone is a scope error. So reuse is detected by
    // asking first, never by swallowing the refusal.
    ensureMilestone: (name) => {
      try {
        execFileSync('.claude/skills/sf-workflow/workflow-cli.sh', ['milestone', 'show', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
        return { created: false }
      } catch {
        execFileSync('.claude/skills/sf-workflow/workflow-cli.sh', ['milestone', 'create', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
        return { created: true }
      }
    },
    assignMilestone: (ticket, name) => {
      execFileSync('.claude/skills/sf-workflow/workflow-cli.sh', ['milestone', 'assign', ticket, name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
    },
    associateMilestone: (name, versionPageUrl) => {
      execFileSync('.claude/skills/sf-workflow/workflow-cli.sh', ['milestone', 'associate', name, versionPageUrl], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
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
  const frPagesOf = async (version: PageRef): Promise<PageRef[]> => {
    const cached = frPagesByVersion.get(version.id)
    if (cached) return cached
    const children = await adapter.listChildren(version.id)
    frPagesByVersion.set(version.id, children)
    return children
  }

  // Listing costs one call per version, so it happens only when a list is what the
  // caller gets — an error. The happy path touches the selected version alone.
  const listVersions = async (): Promise<void> => {
    for (const version of versions) {
      const count = (await frPagesOf(version)).filter((page) => parseFrPageTitle(page.title) !== null).length
      io.stderr(`    ${version.title}${' '.repeat(Math.max(1, 36 - version.title.length))}(${count} FR)  ${version.url}\n`)
    }
  }

  if (!requested) {
    io.stderr(`✗ spawn: « ${featureTitle} » is a versioned feature, not an Epic.\n`)
    io.stderr(`  Pick the version to spawn:\n\n`)
    await listVersions()
    io.stderr(`\n  → sf srs spawn --epic <url> --version "${versions[0].title}"\n`)
    return null
  }

  // Exact matches only. A substring match on the URL would let `--version v1` pick
  // a page whose URL merely contains "v1" — a silent wrong target on a command that
  // writes to the board. A near-miss falls through to the list, which is help.
  const needle = requested.trim().toLowerCase()
  const match = versions.find((version) => version.title.trim().toLowerCase() === needle || version.id === requested || version.url === requested)

  if (!match) {
    io.stderr(`✗ spawn: no version "${requested}" under « ${featureTitle} ». Available:\n\n`)
    await listVersions()
    return null
  }

  const frPages = await frPagesOf(match)
  if (frPages.length === 0) {
    io.stderr(`✗ spawn: version « ${match.title} » of « ${featureTitle} » holds no page — there is nothing to spawn.\n`)
    io.stderr(`  Creating an Epic with no Story would put a promise on the board that no page backs.\n`)
    return null
  }

  return { version: match, frPages }
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

  const parentLabel = options.ticket ? `#${options.ticket}` : `a new Epic « ${holderTitle} »`
  io.stdout(`spawn: Epic « ${holderTitle} » — ${planned.length} FR page(s), planning Story tickets under ${parentLabel}\n`)
  for (const p of planned) {
    io.stdout(`  • ${p.frId} → ${p.title} (${p.frPageUrl})\n`)
  }

  if (options.milestone) {
    io.stdout(`  release: « ${options.milestone} » — created or reused, and everything above joins it\n`)
  } else {
    // Said out loud rather than left to be discovered later. A version spawned
    // into no release is the state #542 exists to prevent, and the moment to
    // raise it is now — not when somebody asks what v1 contains.
    io.stdout(`  release: none — pass --milestone <name> to declare what these tickets ship in\n`)
  }

  if (options.dryRun) {
    io.stdout(`\n[dry-run] No tickets created. Re-run without --dry-run to apply.\n`)
    return 0
  }

  // Before anything is created, so a failure here leaves an untouched board.
  // The reverse order would put tickets on a board that belongs to a release
  // nobody declared, which is worse than not spawning at all.
  if (options.milestone) {
    try {
      const { created } = io.ensureMilestone(options.milestone)
      io.stdout(`  ✓ milestone « ${options.milestone} » ${created ? 'created' : 'reused'}\n`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      io.stderr(`✗ spawn: could not create or reuse milestone "${options.milestone}" — ${message}\n`)
      io.stderr(`  Nothing was created.\n`)
      return 8
    }
  }

  // Without --ticket, spawn owns the Epic too. Creating it here is what turns the
  // `<feature> - <version>` convention from something the agent has to remember
  // into something the tool guarantees.
  let parentTicket = options.ticket
  if (!parentTicket) {
    const body = renderEpicTicketBody({
      epic: { title: holderTitle, parentPageId: epicPageId, urs: [], frs: planned.map((p) => ({ id: p.frId, title: p.title })) },
      epicPageUrl: holderPageUrl,
      frPages: planned.map((p) => ({ frId: p.frId, frTitle: p.title, pageUrl: p.frPageUrl }))
    })
    try {
      const { epicNumber } = io.createEpic(holderTitle, body, options.bypassReason)
      if (!epicNumber) {
        io.stderr(`✗ spawn: could not determine the new Epic number from create-epic output\n`)
        return 8
      }
      parentTicket = epicNumber
      io.stdout(`  ✓ Epic #${epicNumber} « ${holderTitle} »\n`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      io.stderr(`✗ spawn: failed to create the Epic — ${message}\n`)
      return 8
    }
  }

  const created: string[] = []
  for (const p of planned) {
    try {
      const { childNumber } = io.createSubtask(parentTicket, p.title, p.body, options.bypassReason)
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

  io.stdout(`\nspawn: created ${created.length} Story ticket(s) under #${parentTicket}.\n`)

  if (options.milestone) {
    // The Epic joins too: a milestone read after the release should show the
    // grouping that composed it, not a flat list of Stories. It closes on its
    // own when its children do, so it never holds the percentage back.
    const toAssign = [parentTicket, ...created]
    const assigned: string[] = []
    for (const ticket of toAssign) {
      try {
        io.assignMilestone(ticket, options.milestone)
        assigned.push(ticket)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        io.stderr(`\n✗ spawn: #${ticket} could not join « ${options.milestone} » — ${message}\n`)
        io.stderr(`  The tickets exist. ${assigned.length} of ${toAssign.length} joined the release: ${assigned.map((t) => `#${t}`).join(', ') || 'none'}\n`)
        io.stderr(`  Finish with: workflow-cli.sh milestone assign <ticket> "${options.milestone}"\n`)
        return 9
      }
    }
    io.stdout(`spawn: ${assigned.length} ticket(s) joined « ${options.milestone} ».\n`)

    // Last because it is the only step that is idempotent on its own, so it is
    // the safe one to be retried by a re-run.
    if (holderPageUrl) {
      try {
        io.associateMilestone(options.milestone, holderPageUrl)
        io.stdout(`spawn: « ${options.milestone} » carries ${holderPageUrl}\n`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        io.stderr(`\n✗ spawn: could not link ${holderPageUrl} to « ${options.milestone} » — ${message}\n`)
        io.stderr(`  Tickets and milestone are correct; only the SRS link is missing.\n`)
        io.stderr(`  Finish with: workflow-cli.sh milestone associate "${options.milestone}" ${holderPageUrl}\n`)
        return 9
      }
    }
  }

  return 0
}

if (require.main === module) {
  let options: SpawnOptions
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.stderr.write(
      `\nUsage: spawn.ts --epic <page-url-or-id> [--ticket <ticket-number>] [--version <title-url-or-id>] [--milestone <name>] [--dry-run] [--manifest <path>] [--bypass-reason <text>]\n`
    )
    process.exit(1)
  }
  runSpawn(options)
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`spawn: unexpected error — ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    })
}
