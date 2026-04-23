import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseArgs, runEvalSrs } from '../../../../srs/bin/eval-srs'
import { SrsInventory } from '../../../../srs/eval/types'
import { ScannerFinding } from '../../../../srs/scanners/types'

describe('parseArgs (eval-srs)', () => {
  it('applies defaults', () => {
    const opts = parseArgs([])
    expect(opts.scanPath).toBe('')
    expect(opts.manifestPath).toBe('.saasfoundry.json')
    expect(opts.thresholdPct).toBe(80)
    expect(opts.output).toBe('human')
  })

  it('parses all long-form flags', () => {
    const opts = parseArgs(['--path', '/tmp/x', '--manifest', '/m.json', '--root-page', 'abc', '--threshold', '60', '--json'])
    expect(opts.scanPath).toBe('/tmp/x')
    expect(opts.manifestPath).toBe('/m.json')
    expect(opts.rootPageId).toBe('abc')
    expect(opts.thresholdPct).toBe(60)
    expect(opts.output).toBe('json')
  })

  it('parses the = variant', () => {
    const opts = parseArgs(['--path=/p', '--manifest=/m', '--root-page=rr', '--threshold=70'])
    expect(opts.scanPath).toBe('/p')
    expect(opts.rootPageId).toBe('rr')
    expect(opts.thresholdPct).toBe(70)
  })

  it('parses --review-packet in both forms', () => {
    const space = parseArgs(['--review-packet', '/out/packet.json'])
    expect(space.reviewPacketPath).toBe('/out/packet.json')
    const eq = parseArgs(['--review-packet=/out/packet.json'])
    expect(eq.reviewPacketPath).toBe('/out/packet.json')
  })
})

describe('runEvalSrs (fixture mode)', () => {
  let tmp: string
  const out: string[] = []
  const err: string[] = []
  const io = { stdout: (c: string) => out.push(c), stderr: (c: string) => err.push(c) }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-eval-'))
    out.length = 0
    err.length = 0
  })

  const writeFixture = (inventory: SrsInventory, findings: ScannerFinding[]): { inv: string; fnd: string; manifest: string } => {
    const inv = join(tmp, 'inv.json')
    const fnd = join(tmp, 'fnd.json')
    const manifest = join(tmp, '.saasfoundry.json')
    writeFileSync(inv, JSON.stringify(inventory))
    writeFileSync(fnd, JSON.stringify(findings))
    writeFileSync(manifest, JSON.stringify({ tools: { srs: { backend: 'notion', rootPage: { id: 'root' } } } }))
    return { inv, fnd, manifest }
  }

  it('returns 0 and prints human report when coverage meets the threshold', async () => {
    const { inv, fnd, manifest } = writeFixture(
      {
        rootPageId: 'root',
        epics: [{ pageId: 'e', title: 'E' }],
        frs: [{ id: 'FR-AUTH-01', area: 'auth', title: 'Sign in', pageId: 'f', epicPageId: 'e', epicTitle: 'E' }],
        unsupportedCategories: ['UR', 'DS', 'TC', 'NFR']
      },
      [{ kind: 'endpoint', area: 'auth', method: 'POST', path: '/signin', hasTests: true, file: 'auth/c.ts', title: 'POST /signin' }]
    )

    const code = await runEvalSrs({ scanPath: tmp, manifestPath: manifest, thresholdPct: 80, output: 'human', fixtureInventoryPath: inv, fixtureFindingsPath: fnd }, io)

    expect(code).toBe(0)
    const text = out.join('')
    expect(text).toContain('SRS freshness report')
    expect(text).toContain('status = FRESH')
  })

  it('returns 1 and prints drift when coverage falls below the threshold', async () => {
    const { inv, fnd, manifest } = writeFixture(
      {
        rootPageId: 'root',
        epics: [{ pageId: 'e', title: 'E' }],
        frs: [{ id: 'FR-AUTH-01', area: 'auth', title: 'Sign in', pageId: 'f', epicPageId: 'e', epicTitle: 'E' }],
        unsupportedCategories: ['UR', 'DS', 'TC', 'NFR']
      },
      [{ kind: 'endpoint', area: 'billing', method: 'GET', path: '/invoices', hasTests: false, file: 'b/c.ts', title: 'GET /invoices' }]
    )

    const code = await runEvalSrs({ scanPath: tmp, manifestPath: manifest, thresholdPct: 80, output: 'human', fixtureInventoryPath: inv, fixtureFindingsPath: fnd }, io)

    expect(code).toBe(1)
    const text = out.join('')
    expect(text).toContain('fr-without-code')
    expect(text).toContain('orphan-area')
  })

  it('emits valid JSON when --json is selected', async () => {
    const { inv, fnd, manifest } = writeFixture(
      {
        rootPageId: 'root',
        epics: [],
        frs: [],
        unsupportedCategories: ['UR', 'DS', 'TC', 'NFR']
      },
      []
    )

    const code = await runEvalSrs({ scanPath: tmp, manifestPath: manifest, thresholdPct: 80, output: 'json', fixtureInventoryPath: inv, fixtureFindingsPath: fnd }, io)

    expect(code).toBe(0)
    const text = out.join('').trim()
    const parsed = JSON.parse(text)
    expect(parsed.overall.status).toBe('fresh')
    expect(parsed.categories.FR.score).toBeNull()
  })

  it('returns 2 when --path does not exist', async () => {
    const manifestPath = join(tmp, '.saasfoundry.json')
    writeFileSync(manifestPath, JSON.stringify({ tools: { srs: { backend: 'notion', rootPage: { id: 'root' } } } }))
    const code = await runEvalSrs({ scanPath: join(tmp, 'missing'), manifestPath, thresholdPct: 80, output: 'human' }, io)
    expect(code).toBe(2)
  })

  it('returns 2 when rootPage.id is missing and --root-page is not passed', async () => {
    const manifestPath = join(tmp, '.saasfoundry.json')
    writeFileSync(manifestPath, JSON.stringify({ tools: { srs: { backend: 'notion' } } }))
    const code = await runEvalSrs({ scanPath: tmp, manifestPath, thresholdPct: 80, output: 'human' }, io)
    expect(code).toBe(2)
    expect(err.join('')).toMatch(/--root-page is required/)
  })

  it('writes a review packet when --review-packet is set', async () => {
    const { inv, fnd, manifest } = writeFixture(
      {
        rootPageId: 'root',
        epics: [{ pageId: 'e', title: 'E' }],
        frs: [{ id: 'FR-AUTH-01', area: 'auth', title: 'Sign in', pageId: 'f', epicPageId: 'e', epicTitle: 'E' }],
        unsupportedCategories: ['UR', 'DS', 'TC', 'NFR']
      },
      [{ kind: 'endpoint', area: 'auth', method: 'POST', path: '/signin', hasTests: true, file: 'auth/c.ts', title: 'POST /signin' }]
    )

    const packetPath = join(tmp, 'packet.json')
    const code = await runEvalSrs({ scanPath: tmp, manifestPath: manifest, thresholdPct: 80, output: 'json', fixtureInventoryPath: inv, fixtureFindingsPath: fnd, reviewPacketPath: packetPath }, io)
    expect(code).toBe(0)
    expect(existsSync(packetPath)).toBe(true)
    const packet = JSON.parse(readFileSync(packetPath, 'utf8'))
    expect(packet.inventory.frCount).toBe(1)
    expect(packet.frs[0].status).toBe('matched')
    expect(Array.isArray(packet.promptHints)).toBe(true)
  })

  it('returns 3 when the backend is missing from the manifest', async () => {
    const { inv, fnd } = writeFixture({ rootPageId: 'root', epics: [], frs: [], unsupportedCategories: ['UR', 'DS', 'TC', 'NFR'] }, [])
    const manifestPath = join(tmp, '.saasfoundry.json')
    writeFileSync(manifestPath, JSON.stringify({ tools: {} }))
    // No fixture paths → real path is taken, which hits createSrsAdapter and returns 3
    const code = await runEvalSrs({ scanPath: tmp, manifestPath, rootPageId: 'root', thresholdPct: 80, output: 'human' }, io)
    expect(code).toBe(3)
    void inv
    void fnd
  })
})
