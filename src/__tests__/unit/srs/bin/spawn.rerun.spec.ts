import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EpicSpec, FrSpec, PageContent, PageRef, RawContent, ResolvedParent, SrsAdapter } from '../../../../builders/srs/types'
import { runSpawn, SpawnIO, SpawnOptions } from '../../../../srs/bin/spawn'
import { canonicalSrsIdentity, ExistingSrsTicket, ReconciliationRequirement } from '../../../../srs/spawn/reconciliation'
import { registerSrsBackend, unregisterSrsBackend } from '../../../../srs'

/**
 * #986 — spawn a version, add an FR to it, spawn again. The second run must plan and create the
 * new FR's Story alone, and report the Stories that already exist, without a reconciliation plan.
 *
 * Nothing here talks to GitHub or Notion: the SRS is an in-memory tree, and the board is a fake
 * that keeps what spawn creates and answers `inspectTickets` the way `inspect-srs-tickets` does —
 * native children of the parent, plus every issue whose title or body names a requested FR id or
 * canonical page identity. The tickets matched on the re-run are the bodies the first run wrote.
 */

const notionUrl = (slug: string, hex: string): string => `https://www.notion.so/${slug}-${hex}`

const FEATURE = { id: 'feature', name: 'Projects', url: notionUrl('Projects', 'f'.repeat(32)) } satisfies ResolvedParent
const VERSION_URL = notionUrl('v1-Nouveau-projet', 'a'.repeat(32))

const frPage = (n: number, title: string): PageRef => ({
  id: `fr${n}`,
  url: notionUrl(`FR-PROJ-00${n}-${title.replace(/\s+/g, '-')}`, `${n}`.repeat(32)),
  title: `FR-PROJ-00${n} — ${title}`
})

class TreeAdapter implements SrsAdapter {
  constructor(private readonly tree: { version: PageRef; frs: PageRef[] }) {}
  async init(): Promise<void> {}
  async resolveParent(): Promise<ResolvedParent> {
    return FEATURE
  }
  async createPage(_parentPageId: string, title: string): Promise<PageRef> {
    return { id: 'page', url: '', title }
  }
  async createEpicPage(spec: EpicSpec): Promise<PageRef> {
    return { id: 'e', url: '', title: spec.title }
  }
  async createFrPage(spec: FrSpec): Promise<PageRef> {
    return { id: 'f', url: '', title: spec.fr.title }
  }
  async updatePage(pageId: string, content: PageContent): Promise<void> {
    void pageId
    void content
  }
  async fetchPage(pageId: string): Promise<RawContent> {
    return { pageId, title: '', url: '', blocks: [] }
  }
  async listChildren(parentPageId: string): Promise<PageRef[]> {
    return parentPageId === this.tree.version.id ? this.tree.frs : [this.tree.version]
  }
  async move(): Promise<void> {}
}

interface Issue {
  number: string
  title: string
  body: string
  issueType: 'sf-epic' | 'sf-story'
  parentNumber: string | null
}

/** The board spawn writes to, read back the way `inspect-srs-tickets` reads GitHub. */
class FakeBoard {
  readonly issues: Issue[] = []
  readonly out: string[] = []
  readonly err: string[] = []
  writes = 0
  private next = 10

  private add(issue: Omit<Issue, 'number'>): string {
    const number = String(this.next++)
    this.issues.push({ number, ...issue })
    this.writes++
    return number
  }

  storiesFor(frId: string): Issue[] {
    return this.issues.filter((issue) => issue.issueType === 'sf-story' && issue.title.startsWith(`${frId}:`))
  }

  inspect(parent: string | null, requirements: ReconciliationRequirement[]): ExistingSrsTicket[] {
    const terms = requirements.flatMap((requirement) => [requirement.frId.toLowerCase(), canonicalSrsIdentity(requirement.frPageUrl)])
    return this.issues
      .filter((issue) => issue.number !== parent)
      .filter((issue) => (parent !== null && issue.parentNumber === parent) || terms.some((term) => `${issue.title}\n${issue.body}`.toLowerCase().includes(term)))
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: 'OPEN',
        stateReason: null,
        boardStatus: 'Backlog',
        parentNumber: issue.parentNumber,
        issueType: issue.issueType,
        url: `https://github.test/issues/${issue.number}`,
        srsLinks: [...new Set((issue.body.match(/https?:\/\/[^\][()<>\s]+/g) ?? []).map((link) => link.replace(/[.,;]+$/, '')))],
        frIds: [...new Set((`${issue.title}\n${issue.body}`.replace(/https?:\/\/[^\][()<>\s]+/g, '').match(/FR-(?:[A-Za-z0-9]+-)+[0-9]+/gi) ?? []).map((id) => id.toUpperCase()))]
      }))
  }

  io(): SpawnIO {
    return {
      stdout: (chunk) => void this.out.push(chunk),
      stderr: (chunk) => void this.err.push(chunk),
      createEpic: (title, body) => ({ epicNumber: this.add({ title, body, issueType: 'sf-epic', parentNumber: null }) }),
      createSubtask: (parent, title, body) => ({ childNumber: this.add({ title, body, issueType: 'sf-story', parentNumber: parent }) }),
      inspectTickets: (parent, requirements) => this.inspect(parent, requirements),
      linkSubtask: (parent, child) => {
        this.writes++
        const issue = this.issues.find((candidate) => candidate.number === child)
        if (issue) issue.parentNumber = parent
      },
      addToProject: () => ({ action: 'kept', status: 'Backlog' }),
      ensureMilestone: () => ({ created: false }),
      assignMilestone: () => undefined,
      associateMilestone: () => undefined,
      setComplexity: () => undefined
    }
  }

  /** Output of the runs since the last call. */
  drain(): string {
    const text = this.out.join('')
    this.out.length = 0
    return text
  }
}

describe('sf srs spawn re-run after an FR is added (#986)', () => {
  let tmp: string
  let tree: { version: PageRef; frs: PageRef[] }
  let board: FakeBoard

  const run = (overrides: Partial<SpawnOptions> = {}): Promise<number> =>
    runSpawn(
      {
        epic: FEATURE.url,
        version: tree.version.title,
        milestone: 'v1.0.0',
        dryRun: false,
        manifestPath: join(tmp, '.saasfoundry.json'),
        bypassReason: 'spawned-from-srs',
        ...overrides
      },
      board.io()
    )

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-srs-spawn-rerun-'))
    writeFileSync(join(tmp, '.saasfoundry.json'), JSON.stringify({ tools: { srs: { backend: 'stub' } } }))
    tree = { version: { id: 'v1', url: VERSION_URL, title: 'v1 — Nouveau projet' }, frs: [frPage(1, 'Create a project'), frPage(2, 'Rename a project'), frPage(3, 'Archive a project')] }
    board = new FakeBoard()
    registerSrsBackend('stub', () => new TreeAdapter(tree))
  })

  afterEach(() => {
    unregisterSrsBackend('stub')
    rmSync(tmp, { recursive: true, force: true })
  })

  /** First spawn of the version, then one FR added to it: the everyday case the ticket reports. */
  async function spawnThenAddAnFr(): Promise<{ epic: string; stories: string[] }> {
    await expect(run()).resolves.toBe(0)
    const epic = board.issues.find((issue) => issue.issueType === 'sf-epic')!.number
    const stories = board.issues.filter((issue) => issue.issueType === 'sf-story').map((issue) => issue.number)
    expect(stories).toHaveLength(3)
    board.drain()
    tree.frs.push(frPage(4, 'Delete a project'))
    return { epic, stories }
  }

  it('previews the existing Stories as present and only the new FR as new, writing nothing', async () => {
    const { epic, stories } = await spawnThenAddAnFr()
    const writesBefore = board.writes

    await expect(run({ dryRun: true })).resolves.toBe(0)

    const out = board.drain()
    expect(out).toContain('4 FR page(s): 1 new, 3 already ticketed')
    expect(out).toContain(`under the existing Epic #${epic} «`)
    expect(out).toContain(`    FR-PROJ-001: exists #${stories[0]}, skipped\n`)
    expect(out).toContain(`    FR-PROJ-002: exists #${stories[1]}, skipped\n`)
    expect(out).toContain(`    FR-PROJ-003: exists #${stories[2]}, skipped\n`)
    expect(out).toContain('    FR-PROJ-004: new\n')
    // The list of Stories to create names the new FR alone
    expect(out).toMatch(/• FR-PROJ-004 →/)
    expect(out).not.toMatch(/• FR-PROJ-00[123] →/)
    expect(board.writes).toBe(writesBefore)
  })

  it('creates the new FR’s Story alone, under the Epic the first run created', async () => {
    const { epic } = await spawnThenAddAnFr()

    await expect(run()).resolves.toBe(0)

    expect(board.issues.filter((issue) => issue.issueType === 'sf-epic')).toHaveLength(1)
    for (const frId of ['FR-PROJ-001', 'FR-PROJ-002', 'FR-PROJ-003', 'FR-PROJ-004']) expect(board.storiesFor(frId)).toHaveLength(1)
    expect(board.storiesFor('FR-PROJ-004')[0].parentNumber).toBe(epic)
    expect(board.drain()).toContain(`created 1, reused 3, skipped 0 Story ticket(s) under #${epic}`)
  })

  it('creates nothing on a third run', async () => {
    await spawnThenAddAnFr()
    await expect(run()).resolves.toBe(0)
    const count = board.issues.length

    await expect(run()).resolves.toBe(0)

    expect(board.issues).toHaveLength(count)
    expect(board.drain()).toContain('4 FR page(s): 0 new, 4 already ticketed')
  })

  it('recognises its Epic by the version page link when the version page was renamed', async () => {
    const { epic } = await spawnThenAddAnFr()
    // Same page, new title: the `<feature> - <version>` title no longer matches the Epic
    tree.version = { ...tree.version, title: 'v1 — Projets' }

    await expect(run()).resolves.toBe(0)

    expect(board.err.join('')).toBe('')
    expect(board.issues.filter((issue) => issue.issueType === 'sf-epic')).toHaveLength(1)
    expect(board.storiesFor('FR-PROJ-004')).toHaveLength(1)
    expect(board.storiesFor('FR-PROJ-004')[0].parentNumber).toBe(epic)
  })

  it('does the same with --ticket naming the Epic', async () => {
    const { epic } = await spawnThenAddAnFr()

    await expect(run({ ticket: epic })).resolves.toBe(0)

    expect(board.issues.filter((issue) => issue.issueType === 'sf-epic')).toHaveLength(1)
    for (const frId of ['FR-PROJ-001', 'FR-PROJ-002', 'FR-PROJ-003', 'FR-PROJ-004']) expect(board.storiesFor(frId)).toHaveLength(1)
  })

  // #1117 — an existing Story that names the new FR's id in its body does not own it
  it('creates the new FR’s Story when another Story of the batch cites its id', async () => {
    const { epic, stories } = await spawnThenAddAnFr()
    const citing = board.issues.find((issue) => issue.number === stories[0])!
    citing.body += '\n\n## Dependencies\n\n- FR-PROJ-004 must land first'

    await expect(run()).resolves.toBe(0)

    expect(board.err.join('')).toBe('')
    expect(board.storiesFor('FR-PROJ-004')).toHaveLength(1)
    expect(board.storiesFor('FR-PROJ-004')[0].parentNumber).toBe(epic)
    expect(board.drain()).toContain(`created 1, reused 3, skipped 0 Story ticket(s) under #${epic}`)
  })

  it('points at --ticket instead of guessing when the Stories hang under an Epic it cannot recognise', async () => {
    const { epic } = await spawnThenAddAnFr()
    // An Epic made by hand: neither the version link nor the title spawn would give it
    const made = board.issues.find((issue) => issue.number === epic)!
    made.title = 'Projects, first version'
    made.body = 'Hand-written Epic'

    await expect(run({ dryRun: true })).resolves.toBe(10)

    expect(board.err.join('')).toContain(`already belongs to parent #${epic}`)
    expect(board.err.join('')).toContain(`pass --ticket ${epic} if that is this version's Epic`)
  })
})
