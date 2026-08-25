import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EpicSpec, FrSpec, PageContent, PageRef, RawContent, ResolvedParent, SrsAdapter } from '../../../../builders/srs/types'
import { runSpawn, SpawnIO, SpawnOptions } from '../../../../srs/bin/spawn'
import { registerSrsBackend, unregisterSrsBackend } from '../../../../srs'

/**
 * #569 — spawning a version is when the release scope gets declared.
 *
 * The order is the contract: the milestone is ensured BEFORE any ticket exists,
 * so a failure there leaves an untouched board rather than tickets belonging to
 * a release nobody declared.
 */

const VERSION_PAGE_URL = 'https://example.test/v1'

class TreeAdapter implements SrsAdapter {
  constructor(private readonly tree: Record<string, PageRef[]>) {}

  async init(): Promise<void> {}
  async resolveParent(input: string): Promise<ResolvedParent> {
    return { id: 'feature', name: 'Réunion live', url: input }
  }
  async createPage(parentPageId: string, title: string): Promise<PageRef> {
    void parentPageId
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
    return this.tree[parentPageId] ?? []
  }
  async move(pageId: string, newParentPageId: string): Promise<void> {
    void pageId
    void newParentPageId
  }
}

interface TestIO extends SpawnIO {
  ensureMilestone: jest.Mock
  assignMilestone: jest.Mock
  associateMilestone: jest.Mock
  createSubtask: jest.Mock
  createEpic: jest.Mock
  stdoutBuffer: string[]
  stderrBuffer: string[]
}

function makeIO(overrides?: Partial<SpawnIO>): TestIO {
  const stdoutBuffer: string[] = []
  const stderrBuffer: string[] = []
  let nextNumber = 100
  return Object.assign(
    {
      stdout: jest.fn((chunk: string) => {
        stdoutBuffer.push(chunk)
      }),
      stderr: jest.fn((chunk: string) => {
        stderrBuffer.push(chunk)
      }),
      createSubtask: jest.fn(() => ({ childNumber: String(nextNumber++) })),
      createEpic: jest.fn(() => ({ epicNumber: String(nextNumber++) })),
      ensureMilestone: jest.fn(() => ({ created: true })),
      assignMilestone: jest.fn(() => undefined),
      associateMilestone: jest.fn(() => undefined),
      stdoutBuffer,
      stderrBuffer
    },
    overrides
  ) as TestIO
}

describe('spawn — declaring the release scope (#569)', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-spawn-ms-'))
    // feature → one version page → two FR pages
    registerSrsBackend(
      'tree',
      () =>
        new TreeAdapter({
          feature: [{ id: 'v1', url: VERSION_PAGE_URL, title: 'v1 — MVP' }],
          v1: [
            { id: 'fr1', url: 'https://example.test/fr1', title: 'FR-LIVE-001: Transcription' },
            { id: 'fr2', url: 'https://example.test/fr2', title: 'FR-LIVE-002: Notes' }
          ]
        })
    )
    writeFileSync(join(tmp, '.saasfoundry.json'), JSON.stringify({ tools: { srs: { backend: 'tree' } } }))
  })

  afterEach(() => {
    unregisterSrsBackend('tree')
    rmSync(tmp, { recursive: true, force: true })
  })

  const options = (overrides: Partial<SpawnOptions> = {}): SpawnOptions => ({
    epic: 'https://example.test/feature',
    version: 'v1 — MVP',
    dryRun: false,
    manifestPath: join(tmp, '.saasfoundry.json'),
    bypassReason: 'spawned-from-srs',
    ...overrides
  })

  it('creates the milestone, attaches the Epic and every Story, and links the version page', async () => {
    const io = makeIO()
    const code = await runSpawn(options({ milestone: 'v1.0.0' }), io)

    expect(code).toBe(0)
    expect(io.ensureMilestone).toHaveBeenCalledWith('v1.0.0')

    // The Epic joins too — a milestone read after the release should show the
    // grouping that composed it, not a flat list of Stories.
    const assigned = io.assignMilestone.mock.calls.map((c) => c[0])
    expect(assigned).toHaveLength(3)
    expect(io.assignMilestone.mock.calls.every((c) => c[1] === 'v1.0.0')).toBe(true)

    expect(io.associateMilestone).toHaveBeenCalledWith('v1.0.0', VERSION_PAGE_URL)
  })

  it('reuses an existing milestone instead of creating a second release', async () => {
    const io = makeIO({ ensureMilestone: jest.fn(() => ({ created: false })) })
    const code = await runSpawn(options({ milestone: 'v1.0.0' }), io)

    expect(code).toBe(0)
    expect(io.stdoutBuffer.join('')).toMatch(/milestone « v1\.0\.0 » reused/)
  })

  it('is idempotent across two identical runs — one milestone, one association per run', async () => {
    const io = makeIO()
    await runSpawn(options({ milestone: 'v1.0.0' }), io)

    const second = makeIO({ ensureMilestone: jest.fn(() => ({ created: false })) })
    const code = await runSpawn(options({ milestone: 'v1.0.0' }), second)

    expect(code).toBe(0)
    expect(second.ensureMilestone).toHaveBeenCalledTimes(1)
    expect(second.associateMilestone).toHaveBeenCalledTimes(1)
  })

  it('ensures the milestone BEFORE creating anything — a failure leaves an untouched board', async () => {
    const io = makeIO({
      ensureMilestone: jest.fn(() => {
        throw new Error('milestone backend unreachable')
      })
    })
    const code = await runSpawn(options({ milestone: 'v1.0.0' }), io)

    expect(code).toBe(8)
    expect(io.createEpic).not.toHaveBeenCalled()
    expect(io.createSubtask).not.toHaveBeenCalled()
    expect(io.stderrBuffer.join('')).toMatch(/Nothing was created/)
  })

  it('reports what actually joined when an assignment fails mid-way', async () => {
    let calls = 0
    const io = makeIO({
      assignMilestone: jest.fn(() => {
        calls += 1
        if (calls === 2) throw new Error('rate limited')
      })
    })
    const code = await runSpawn(options({ milestone: 'v1.0.0' }), io)

    expect(code).toBe(9)
    const err = io.stderrBuffer.join('')
    // The tickets exist; saying so is the whole point — a silent partial state
    // is what #562 was filed for.
    expect(err).toMatch(/The tickets exist\. 1 of 3 joined the release/)
    expect(err).toMatch(/milestone assign/)
  })

  it('says the version carries no release when --milestone is omitted', async () => {
    const io = makeIO()
    const code = await runSpawn(options(), io)

    expect(code).toBe(0)
    expect(io.ensureMilestone).not.toHaveBeenCalled()
    expect(io.assignMilestone).not.toHaveBeenCalled()
    expect(io.associateMilestone).not.toHaveBeenCalled()
    expect(io.stdoutBuffer.join('')).toMatch(/release: none — pass --milestone/)
  })

  it('creates nothing on a dry run, milestone included', async () => {
    const io = makeIO()
    const code = await runSpawn(options({ milestone: 'v1.0.0', dryRun: true }), io)

    expect(code).toBe(0)
    expect(io.ensureMilestone).not.toHaveBeenCalled()
    expect(io.stdoutBuffer.join('')).toMatch(/release: « v1\.0\.0 »/)
  })

  it('keeps the tickets when only the SRS link fails, and says which step is missing', async () => {
    const io = makeIO({
      associateMilestone: jest.fn(() => {
        throw new Error('description too long')
      })
    })
    const code = await runSpawn(options({ milestone: 'v1.0.0' }), io)

    expect(code).toBe(9)
    expect(io.assignMilestone).toHaveBeenCalledTimes(3)
    expect(io.stderrBuffer.join('')).toMatch(/only the SRS link is missing/)
  })
})
