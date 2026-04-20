import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EpicSpec, FrSpec, PageContent, PageRef, RawContent, ResolvedParent, SrsAdapter } from '../../../../builders/srs/types'
import { extractFrId, extractFrTitle, runSpawn, SpawnIO, SpawnOptions } from '../../../../srs/bin/spawn'
import { registerSrsBackend, unregisterSrsBackend } from '../../../../srs'

class StubAdapter implements SrsAdapter {
  constructor(
    private readonly children: PageRef[] = [],
    private readonly onInit: () => Promise<void> | void = () => undefined,
    private readonly onResolveParent: (input: string) => Promise<ResolvedParent> | ResolvedParent = (input) => ({ id: input, name: input, url: 'https://example.test/epic' }),
    private readonly onListChildren: ((parentId: string) => Promise<PageRef[]> | PageRef[]) | null = null
  ) {}

  async init(): Promise<void> {
    await this.onInit()
  }
  async resolveParent(input: string): Promise<ResolvedParent> {
    return this.onResolveParent(input)
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
    if (this.onListChildren) return this.onListChildren(parentPageId)
    return this.children
  }
}

interface TestIO extends SpawnIO {
  stdout: jest.Mock
  stderr: jest.Mock
  createSubtask: jest.Mock
  applyLabel: jest.Mock
  stdoutBuffer: string[]
  stderrBuffer: string[]
}

function makeIO(overrides?: Partial<SpawnIO>): TestIO {
  const stdoutBuffer: string[] = []
  const stderrBuffer: string[] = []
  let nextNumber = 100
  const stdout = jest.fn((chunk: string) => {
    stdoutBuffer.push(chunk)
  })
  const stderr = jest.fn((chunk: string) => {
    stderrBuffer.push(chunk)
  })
  const createSubtask = jest.fn((parent: string, title: string, body: string, reason: string) => {
    void parent
    void title
    void body
    void reason
    return { childNumber: String(nextNumber++) }
  })
  const applyLabel = jest.fn(() => undefined)
  return Object.assign({ stdout, stderr, createSubtask, applyLabel, stdoutBuffer, stderrBuffer }, overrides)
}

describe('extractFrId / extractFrTitle', () => {
  it('parses "FR-001 — Login flow"', () => {
    expect(extractFrId('FR-001 — Login flow')).toBe('FR-001')
    expect(extractFrTitle('FR-001 — Login flow')).toBe('Login flow')
  })

  it('parses "FR-042: Password reset"', () => {
    expect(extractFrId('FR-042: Password reset')).toBe('FR-042')
    expect(extractFrTitle('FR-042: Password reset')).toBe('Password reset')
  })

  it('uppercases the FR id', () => {
    expect(extractFrId('fr-009 — Something')).toBe('FR-009')
  })

  it('falls back to the raw title when no FR pattern is present', () => {
    expect(extractFrId('Ad hoc page')).toBe('Ad hoc page')
    expect(extractFrTitle('Ad hoc page')).toBe('Ad hoc page')
  })

  it('trims surrounding whitespace in the fallback', () => {
    expect(extractFrId('  FR-010 - Typed hyphen  ')).toBe('FR-010')
    expect(extractFrTitle('  FR-010 - Typed hyphen  ')).toBe('Typed hyphen')
  })
})

describe('runSpawn', () => {
  let tmp: string

  const baseOptions = (overrides: Partial<SpawnOptions> = {}): SpawnOptions => ({
    ticket: '42',
    epic: 'https://example.test/epic',
    dryRun: false,
    manifestPath: join(tmp, '.saasfoundry.json'),
    bypassReason: 'spawned-from-srs',
    ...overrides
  })

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-srs-spawn-'))
  })

  afterEach(() => {
    unregisterSrsBackend('stub')
    unregisterSrsBackend('explode-init')
    unregisterSrsBackend('explode-resolve')
    unregisterSrsBackend('explode-children')
    rmSync(tmp, { recursive: true, force: true })
  })

  const writeManifest = (body: unknown): void => {
    writeFileSync(join(tmp, '.saasfoundry.json'), JSON.stringify(body))
  }

  it('returns 2 when the manifest is missing', async () => {
    const io = makeIO()
    const code = await runSpawn(baseOptions({ manifestPath: join(tmp, 'nope.json') }), io)
    expect(code).toBe(2)
    expect(io.stderrBuffer.join('')).toMatch(/ENOENT|no such file/)
  })

  it('returns 2 when the manifest is malformed JSON', async () => {
    writeFileSync(join(tmp, '.saasfoundry.json'), '{not valid json')
    const io = makeIO()
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(2)
    expect(io.stderrBuffer.join('')).toMatch(/failed to parse/)
  })

  it('returns 3 when tools.srs.backend is missing', async () => {
    writeManifest({ tools: {} })
    const io = makeIO()
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(3)
  })

  it('returns 4 when the backend key is unknown', async () => {
    writeManifest({ tools: { srs: { backend: 'nope' } } })
    const io = makeIO()
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(4)
  })

  it('returns 5 when adapter.init() throws a non-config error', async () => {
    registerSrsBackend(
      'explode-init',
      () =>
        new StubAdapter([], async () => {
          throw new Error('network down')
        })
    )
    writeManifest({ tools: { srs: { backend: 'explode-init' } } })
    const io = makeIO()
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(5)
    expect(io.stderrBuffer.join('')).toMatch(/network down/)
  })

  it('returns 6 when resolveParent throws', async () => {
    registerSrsBackend(
      'explode-resolve',
      () =>
        new StubAdapter([], undefined, () => {
          throw new Error('unknown epic')
        })
    )
    writeManifest({ tools: { srs: { backend: 'explode-resolve' } } })
    const io = makeIO()
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(6)
    expect(io.stderrBuffer.join('')).toMatch(/could not resolve epic/)
  })

  it('returns 7 when listChildren throws', async () => {
    registerSrsBackend(
      'explode-children',
      () =>
        new StubAdapter([], undefined, undefined, () => {
          throw new Error('permission denied')
        })
    )
    writeManifest({ tools: { srs: { backend: 'explode-children' } } })
    const io = makeIO()
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(7)
    expect(io.stderrBuffer.join('')).toMatch(/listChildren failed/)
  })

  it('returns 0 and emits a "nothing to spawn" message when the Epic has no child pages', async () => {
    registerSrsBackend('stub', () => new StubAdapter([]))
    writeManifest({ tools: { srs: { backend: 'stub' } } })
    const io = makeIO()
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(0)
    expect(io.createSubtask).not.toHaveBeenCalled()
    expect(io.stdoutBuffer.join('')).toMatch(/nothing to spawn/)
  })

  it('dry-run: plans without creating, then exits 0', async () => {
    const children: PageRef[] = [
      { id: 'p1', url: 'https://example.test/fr1', title: 'FR-001 — Login flow' },
      { id: 'p2', url: 'https://example.test/fr2', title: 'FR-002: Password reset' }
    ]
    registerSrsBackend('stub', () => new StubAdapter(children))
    writeManifest({ tools: { srs: { backend: 'stub' } } })
    const io = makeIO()
    const code = await runSpawn(baseOptions({ dryRun: true }), io)
    expect(code).toBe(0)
    expect(io.createSubtask).not.toHaveBeenCalled()
    expect(io.applyLabel).not.toHaveBeenCalled()
    const out = io.stdoutBuffer.join('')
    expect(out).toMatch(/found 2 FR page\(s\)/)
    expect(out).toMatch(/FR-001 → FR-001: Login flow/)
    expect(out).toMatch(/FR-002 → FR-002: Password reset/)
    expect(out).toMatch(/dry-run/)
  })

  it('creates one Story per FR page and labels each with srs:new', async () => {
    const children: PageRef[] = [
      { id: 'p1', url: 'https://example.test/fr1', title: 'FR-001 — Login flow' },
      { id: 'p2', url: 'https://example.test/fr2', title: 'FR-002 — Password reset' }
    ]
    registerSrsBackend('stub', () => new StubAdapter(children))
    writeManifest({ tools: { srs: { backend: 'stub' } } })
    const io = makeIO()
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(0)
    expect(io.createSubtask).toHaveBeenCalledTimes(2)
    expect(io.createSubtask.mock.calls[0]).toEqual(['42', 'FR-001: Login flow', expect.any(String), 'spawned-from-srs'])
    expect(io.createSubtask.mock.calls[1]).toEqual(['42', 'FR-002: Password reset', expect.any(String), 'spawned-from-srs'])
    const firstBody = io.createSubtask.mock.calls[0][2] as string
    expect(firstBody).toMatch(/## Objective/)
    expect(firstBody).toMatch(/FR-001 — Login flow/)
    expect(firstBody).toMatch(/https:\/\/example\.test\/fr1/)
    expect(io.applyLabel).toHaveBeenCalledTimes(2)
    expect(io.applyLabel.mock.calls[0][1]).toBe('srs:new')
  })

  it('propagates a custom --bypass-reason to createSubtask', async () => {
    const children: PageRef[] = [{ id: 'p1', url: 'https://example.test/fr1', title: 'FR-001 — Thing' }]
    registerSrsBackend('stub', () => new StubAdapter(children))
    writeManifest({ tools: { srs: { backend: 'stub' } } })
    const io = makeIO()
    const code = await runSpawn(baseOptions({ bypassReason: 'bootstrap-epic-174' }), io)
    expect(code).toBe(0)
    expect(io.createSubtask.mock.calls[0][3]).toBe('bootstrap-epic-174')
  })

  it('returns 8 when the subtask-creation shim yields an empty childNumber', async () => {
    const children: PageRef[] = [{ id: 'p1', url: 'https://example.test/fr1', title: 'FR-001 — Thing' }]
    registerSrsBackend('stub', () => new StubAdapter(children))
    writeManifest({ tools: { srs: { backend: 'stub' } } })
    const io = makeIO({ createSubtask: jest.fn(() => ({ childNumber: '' })) })
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(8)
    expect(io.stderrBuffer.join('')).toMatch(/could not determine new ticket number/)
  })

  it('returns 8 when createSubtask throws', async () => {
    const children: PageRef[] = [{ id: 'p1', url: 'https://example.test/fr1', title: 'FR-001 — Thing' }]
    registerSrsBackend('stub', () => new StubAdapter(children))
    writeManifest({ tools: { srs: { backend: 'stub' } } })
    const io = makeIO({
      createSubtask: jest.fn(() => {
        throw new Error('gh failed')
      })
    })
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(8)
    expect(io.stderrBuffer.join('')).toMatch(/gh failed/)
  })

  it('still succeeds when applyLabel throws — surfaces a warning but does not abort', async () => {
    const children: PageRef[] = [
      { id: 'p1', url: 'https://example.test/fr1', title: 'FR-001 — A' },
      { id: 'p2', url: 'https://example.test/fr2', title: 'FR-002 — B' }
    ]
    registerSrsBackend('stub', () => new StubAdapter(children))
    writeManifest({ tools: { srs: { backend: 'stub' } } })
    const io = makeIO({
      applyLabel: jest.fn(() => {
        throw new Error('no label perms')
      })
    })
    const code = await runSpawn(baseOptions(), io)
    expect(code).toBe(0)
    expect(io.createSubtask).toHaveBeenCalledTimes(2)
    expect(io.stderrBuffer.join('')).toMatch(/could not add srs:new label/)
  })
})
