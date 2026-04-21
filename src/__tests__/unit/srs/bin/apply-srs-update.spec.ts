import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EpicSpec, FrSpec, PageContent, PageRef, RawContent, ResolvedParent, SrsAdapter } from '../../../../builders/srs/types'
import { ApplyIO, ApplyOptions, assertPatchShape, parseArgs, renderAppendBlocks, runApplyUpdate, SrsUpdatePatch } from '../../../../srs/bin/apply-srs-update'
import { registerSrsBackend, unregisterSrsBackend } from '../../../../srs'

class StubAdapter implements SrsAdapter {
  readonly updatePageCalls: Array<{ pageId: string; content: PageContent }> = []
  readonly createFrPageCalls: FrSpec[] = []
  constructor(
    private readonly onInit: () => Promise<void> | void = () => undefined,
    private readonly onCreateFrPage: (spec: FrSpec) => Promise<PageRef> | PageRef = (spec) => ({ id: 'fr-page-123', url: 'https://example.test/fr', title: spec.fr.title }),
    private readonly onUpdatePage: ((pageId: string, content: PageContent) => Promise<void> | void) | null = null
  ) {}
  async init(): Promise<void> {
    await this.onInit()
  }
  async resolveParent(input: string): Promise<ResolvedParent> {
    return { id: input, name: input, url: 'https://example.test/parent' }
  }
  async createPage(parentPageId: string, title: string): Promise<PageRef> {
    void parentPageId
    return { id: 'page', url: '', title }
  }
  async createEpicPage(spec: EpicSpec): Promise<PageRef> {
    return { id: 'epic-page', url: '', title: spec.title }
  }
  async createFrPage(spec: FrSpec): Promise<PageRef> {
    this.createFrPageCalls.push(spec)
    return this.onCreateFrPage(spec)
  }
  async updatePage(pageId: string, content: PageContent): Promise<void> {
    this.updatePageCalls.push({ pageId, content })
    if (this.onUpdatePage) await this.onUpdatePage(pageId, content)
  }
  async fetchPage(pageId: string): Promise<RawContent> {
    return { pageId, title: '', url: '', blocks: [] }
  }
  async listChildren(): Promise<PageRef[]> {
    return []
  }
}

interface TestIO extends ApplyIO {
  stdout: jest.Mock
  stderr: jest.Mock
  readStdin: jest.Mock
  stdoutBuffer: string[]
  stderrBuffer: string[]
}

function makeIO(stdinPayload = ''): TestIO {
  const stdoutBuffer: string[] = []
  const stderrBuffer: string[] = []
  const stdout = jest.fn((chunk: string) => {
    stdoutBuffer.push(chunk)
  })
  const stderr = jest.fn((chunk: string) => {
    stderrBuffer.push(chunk)
  })
  const readStdin = jest.fn(() => stdinPayload)
  return { stdout, stderr, readStdin, stdoutBuffer, stderrBuffer }
}

describe('parseArgs', () => {
  it('uses the default manifest path and empty patch path when nothing is passed', () => {
    const opts = parseArgs([])
    expect(opts.patchPath).toBe('')
    expect(opts.manifestPath).toBe('.saasfoundry.json')
  })

  it('parses --patch and --manifest with separate values', () => {
    const opts = parseArgs(['--patch', './p.json', '--manifest', './m.json'])
    expect(opts.patchPath).toBe('./p.json')
    expect(opts.manifestPath).toBe('./m.json')
  })

  it('parses --patch=value and --manifest=value attached form', () => {
    const opts = parseArgs(['--patch=./p.json', '--manifest=./m.json'])
    expect(opts.patchPath).toBe('./p.json')
    expect(opts.manifestPath).toBe('./m.json')
  })

  it('rejects --patch without a value', () => {
    expect(() => parseArgs(['--patch'])).toThrow(/--patch requires a value/)
  })

  it('rejects --patch followed by another flag instead of a value', () => {
    expect(() => parseArgs(['--patch', '--manifest', 'x'])).toThrow(/--patch requires a value/)
  })

  it('rejects --patch= with an empty attached value', () => {
    expect(() => parseArgs(['--patch='])).toThrow(/--patch= requires a value/)
  })

  it('rejects --manifest with no value', () => {
    expect(() => parseArgs(['--manifest'])).toThrow(/--manifest requires a value/)
  })
})

describe('assertPatchShape', () => {
  it('accepts a well-formed add-ur patch', () => {
    const patch: SrsUpdatePatch = { kind: 'add-ur', pageId: 'epic-1', item: { id: 'UR-010', narrative: 'narrative' } }
    expect(() => assertPatchShape(patch)).not.toThrow()
  })

  it('rejects a patch with an unknown kind', () => {
    expect(() => assertPatchShape({ kind: 'nuke' as never, pageId: 'x', item: { id: '1', narrative: 'n' } })).toThrow(/unknown kind="nuke"/)
  })

  it('rejects a patch with missing pageId', () => {
    expect(() => assertPatchShape({ kind: 'add-ur', pageId: '', item: { id: 'UR-1', narrative: 'n' } })).toThrow(/missing `pageId`/)
  })

  it('rejects a patch with missing item', () => {
    expect(() => assertPatchShape({ kind: 'add-ur', pageId: 'x', item: undefined as never })).toThrow(/missing `item`/)
  })

  it('rejects a non-object patch entirely', () => {
    expect(() => assertPatchShape('not-an-object' as never)).toThrow(/patch must be a JSON object/)
  })
})

describe('renderAppendBlocks', () => {
  it('renders add-ur with a labeled heading and bullet carrying the id + narrative', () => {
    const blocks = renderAppendBlocks({ kind: 'add-ur', pageId: 'e', item: { id: 'UR-042', narrative: 'User can log in with Unicode passwords', businessValue: 'Global reach' } })
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({ kind: 'heading', level: 2, text: 'Added User Requirement — UR-042' })
    expect(blocks[1]).toEqual({ kind: 'bulleted_list', items: ['UR-042: User can log in with Unicode passwords (value: Global reach)'] })
  })

  it('renders add-ds with description as suffix', () => {
    const blocks = renderAppendBlocks({ kind: 'add-ds', pageId: 'fr', item: { id: 'DS-007', title: 'Use BCrypt', description: 'Cost factor 12' } })
    expect(blocks[0]).toEqual({ kind: 'heading', level: 2, text: 'Added Design Item — DS-007' })
    expect(blocks[1]).toEqual({ kind: 'bulleted_list', items: ['DS-007: Use BCrypt — Cost factor 12'] })
  })

  it('renders add-tc with expected result and numbered steps when provided', () => {
    const blocks = renderAppendBlocks({
      kind: 'add-tc',
      pageId: 'fr',
      item: { id: 'TC-091', title: 'Unicode password is accepted', steps: ['submit form with é', 'assert 200'], expectedResult: 'login succeeds' }
    })
    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toEqual({ kind: 'heading', level: 2, text: 'Added Test Case — TC-091' })
    expect(blocks[1]).toEqual({ kind: 'bulleted_list', items: ['TC-091: Unicode password is accepted → login succeeds'] })
    expect(blocks[2]).toEqual({ kind: 'numbered_list', items: ['submit form with é', 'assert 200'] })
  })

  it('appends an optional note paragraph when provided', () => {
    const blocks = renderAppendBlocks({
      kind: 'add-ur',
      pageId: 'e',
      item: { id: 'UR-001', narrative: 'foo' },
      note: 'Captured during conversation on 2026-04-21'
    })
    expect(blocks[blocks.length - 1]).toEqual({ kind: 'paragraph', text: 'Note: Captured during conversation on 2026-04-21' })
  })

  it('rejects add-ur without narrative', () => {
    expect(() => renderAppendBlocks({ kind: 'add-ur', pageId: 'e', item: { id: 'UR-001' } as never })).toThrow(/add-ur requires item.id and item.narrative/)
  })

  it('rejects add-tc without title', () => {
    expect(() => renderAppendBlocks({ kind: 'add-tc', pageId: 'fr', item: { id: 'TC-1' } as never })).toThrow(/add-tc requires item.id and item.title/)
  })
})

describe('runApplyUpdate', () => {
  const BACKEND = 'apply-test-backend'
  let tmpDir: string
  let manifestPath: string
  let stub: StubAdapter

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sf-apply-update-'))
    manifestPath = join(tmpDir, 'manifest.json')
    writeFileSync(manifestPath, JSON.stringify({ tools: { srs: { backend: BACKEND } } }))
    stub = new StubAdapter()
    registerSrsBackend(BACKEND, () => stub)
  })

  afterEach(() => {
    unregisterSrsBackend(BACKEND)
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function runWithStdin(payload: string, extra: Partial<ApplyOptions> = {}): { code: Promise<number>; io: TestIO } {
    const io = makeIO(payload)
    const options: ApplyOptions = { patchPath: '', manifestPath, ...extra }
    return { code: runApplyUpdate(options, io), io }
  }

  it('applies add-ur by calling adapter.updatePage with the expected blocks (exit 0)', async () => {
    const patch: SrsUpdatePatch = { kind: 'add-ur', pageId: 'epic-42', item: { id: 'UR-100', narrative: 'New requirement' } }
    const { code, io } = runWithStdin(JSON.stringify(patch))
    await expect(code).resolves.toBe(0)
    expect(stub.updatePageCalls).toHaveLength(1)
    expect(stub.updatePageCalls[0].pageId).toBe('epic-42')
    expect(stub.updatePageCalls[0].content.blocks[0]).toMatchObject({ kind: 'heading', text: 'Added User Requirement — UR-100' })
    const stdout = io.stdoutBuffer.join('')
    expect(stdout).toContain('"kind": "add-ur"')
    expect(stdout).toContain('"targetPageId": "epic-42"')
  })

  it('applies add-fr via adapter.createFrPage and includes newPage in the result', async () => {
    const frSpec: FrSpec = { parentEpicPageId: '', fr: { id: 'FR-043', title: 'OAuth login' } }
    const patch: SrsUpdatePatch = { kind: 'add-fr', pageId: 'epic-42', item: frSpec }
    const { code, io } = runWithStdin(JSON.stringify(patch))
    await expect(code).resolves.toBe(0)
    expect(stub.createFrPageCalls).toHaveLength(1)
    expect(stub.createFrPageCalls[0].parentEpicPageId).toBe('epic-42')
    expect(stub.createFrPageCalls[0].fr.id).toBe('FR-043')
    const stdout = io.stdoutBuffer.join('')
    expect(stdout).toContain('"newPage"')
    expect(stdout).toContain('"id": "fr-page-123"')
  })

  it('applies add-ds against an FR page via updatePage', async () => {
    const patch: SrsUpdatePatch = { kind: 'add-ds', pageId: 'fr-007', item: { id: 'DS-007', title: 'BCrypt' } }
    const { code } = runWithStdin(JSON.stringify(patch))
    await expect(code).resolves.toBe(0)
    expect(stub.updatePageCalls[0].pageId).toBe('fr-007')
    expect(stub.updatePageCalls[0].content.blocks[0]).toMatchObject({ text: 'Added Design Item — DS-007' })
  })

  it('applies add-tc and includes steps as numbered_list', async () => {
    const patch: SrsUpdatePatch = {
      kind: 'add-tc',
      pageId: 'fr-007',
      item: { id: 'TC-091', title: 'Unicode pw OK', steps: ['open form', 'submit'], expectedResult: '200' }
    }
    const { code } = runWithStdin(JSON.stringify(patch))
    await expect(code).resolves.toBe(0)
    const blocks = stub.updatePageCalls[0].content.blocks
    expect(blocks).toHaveLength(3)
    expect(blocks[2]).toMatchObject({ kind: 'numbered_list' })
  })

  it('returns exit 2 when the patch JSON is malformed', async () => {
    const { code, io } = runWithStdin('{ not valid json')
    await expect(code).resolves.toBe(2)
    expect(io.stderrBuffer.join('')).toMatch(/failed to parse patch JSON/)
  })

  it('returns exit 2 when the patch kind is unknown', async () => {
    const { code, io } = runWithStdin(JSON.stringify({ kind: 'nuke', pageId: 'x', item: { id: 'Y', narrative: 'z' } }))
    await expect(code).resolves.toBe(2)
    expect(io.stderrBuffer.join('')).toMatch(/unknown kind/)
  })

  it('returns exit 3 when the manifest has no backend configured', async () => {
    writeFileSync(manifestPath, JSON.stringify({ tools: {} }))
    const patch: SrsUpdatePatch = { kind: 'add-ur', pageId: 'e', item: { id: 'UR-1', narrative: 'n' } }
    const { code, io } = runWithStdin(JSON.stringify(patch))
    await expect(code).resolves.toBe(3)
    expect(io.stderrBuffer.join('')).toMatch(/tools\.srs\.backend.*not set/)
  })

  it('returns exit 4 when the manifest declares an unknown backend', async () => {
    writeFileSync(manifestPath, JSON.stringify({ tools: { srs: { backend: 'i-do-not-exist' } } }))
    const patch: SrsUpdatePatch = { kind: 'add-ur', pageId: 'e', item: { id: 'UR-1', narrative: 'n' } }
    const { code, io } = runWithStdin(JSON.stringify(patch))
    await expect(code).resolves.toBe(4)
    expect(io.stderrBuffer.join('')).toMatch(/unknown SRS backend/)
  })

  it('returns exit 5 when the adapter throws during updatePage', async () => {
    stub = new StubAdapter(
      () => undefined,
      undefined,
      () => {
        throw new Error('network down')
      }
    )
    unregisterSrsBackend(BACKEND)
    registerSrsBackend(BACKEND, () => stub)
    const patch: SrsUpdatePatch = { kind: 'add-ur', pageId: 'e', item: { id: 'UR-1', narrative: 'n' } }
    const { code, io } = runWithStdin(JSON.stringify(patch))
    await expect(code).resolves.toBe(5)
    expect(io.stderrBuffer.join('')).toMatch(/network down/)
  })

  it('reads a patch from --patch file when provided (stdin skipped)', async () => {
    const patchPath = join(tmpDir, 'patch.json')
    const patch: SrsUpdatePatch = { kind: 'add-ur', pageId: 'epic-42', item: { id: 'UR-010', narrative: 'from file' } }
    writeFileSync(patchPath, JSON.stringify(patch))
    const { code, io } = runWithStdin('{ this stdin must be ignored }', { patchPath })
    await expect(code).resolves.toBe(0)
    expect(io.readStdin).not.toHaveBeenCalled()
  })
})
