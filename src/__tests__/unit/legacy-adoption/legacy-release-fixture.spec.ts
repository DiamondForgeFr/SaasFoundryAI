import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

import { LEGACY_SOURCE } from '../../../legacy-adoption/legacy-adoption'
import { LEGACY_BETA_MULTIREPO_BASELINE } from '../../../legacy-adoption/legacy-beta-baseline'
import {
  canonicalTreeDigest,
  materializeLegacyReleaseFixture,
  parseLegacyReleaseFixture,
  snapshotCanonicalTree,
  type LegacyReleaseFixtureDocument,
  type LegacyReleaseFixtureEntry
} from '../../../../tests/docker/legacy-release-fixture'

const CLI_ROOT = resolve(__dirname, '../../../..')
const AUTHORITATIVE_FIXTURE_ROOT = join(CLI_ROOT, 'tests/docker/fixtures/previous-release/1.0.0-beta')

interface FixtureMetadata {
  fixture: {
    file: string
    sha256: string
    compressedBytes: number
    entryCount: number
    totalBytes: number
    executableEntries: number
    treeSha256: string
  }
  source: typeof LEGACY_SOURCE & Record<string, unknown>
  generationInputs: { projectName: string }
}

const source = {
  package: 'saasfoundry-cli',
  version: '1.0.0-beta',
  integrity: 'sha512-DDUIM7+rPrtsOCwZVjasSiUlEG7cmTelxMN0wxT0JEUffWXmwSl4mdccVdVw574RoFxydBBEn0yYto3Dtfs34A==',
  shasum: '4dd553bf5c026dfc7502e3d54f8bbc53746b6cf8',
  gitHead: '1a682d7ecfa76edcc20af0604da962b06a9c92a7',
  archiveSha256: 'b1abb454495a6a0732f3187beb94298a2c3c79d5f98c376949c577736a1c633b'
}

function fixtureEntry(path: string, content: string | Buffer = `fixture:${path}\n`, mode: 0o644 | 0o755 = 0o644): LegacyReleaseFixtureEntry {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content)
  return {
    path,
    type: 'file',
    mode,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    contentBase64: bytes.toString('base64')
  }
}

function inventoryDigest(entries: Array<{ path: string; mode: number; size: number; sha256: string }>): string {
  const digest = createHash('sha256')
  for (const entry of [...entries].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))) {
    digest.update(`${entry.path}\0${entry.mode}\0${entry.size}\0${entry.sha256}\n`)
  }
  return digest.digest('hex')
}

function document(entries: LegacyReleaseFixtureEntry[]): LegacyReleaseFixtureDocument {
  return {
    schemaVersion: 1,
    source,
    generationInputs: { projectName: 'legacy-app', structure: 'multirepo', features: ['api', 'web'] },
    treeSha256: inventoryDigest(entries),
    entries
  }
}

function bundle(value: unknown): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(value)))
}

describe('legacy release fixture ingestion', () => {
  let temporaryRoot: string
  let destination: string

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'sf-legacy-release-fixture-'))
    destination = join(temporaryRoot, 'destination')
  })

  afterEach(async () => {
    await rm(temporaryRoot, { recursive: true, force: true })
  })

  async function expectRejectedWithoutWrites(compressed: Buffer, limits?: Parameters<typeof parseLegacyReleaseFixture>[1]): Promise<void> {
    await expect(materializeLegacyReleaseFixture(compressed, destination, { limits })).rejects.toThrow()
    await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  }

  it('pins the authoritative artifact provenance, inventory, and legacy baseline coverage', async () => {
    const fixturePath = join(AUTHORITATIVE_FIXTURE_ROOT, 'multirepo.fixture.json.gz')
    const metadataPath = join(AUTHORITATIVE_FIXTURE_ROOT, 'multirepo.metadata.json')
    const inventoryPath = join(AUTHORITATIVE_FIXTURE_ROOT, 'multirepo.files.sha256')
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as FixtureMetadata
    const [compressed, recordedInventory] = await Promise.all([readFile(fixturePath), readFile(inventoryPath, 'utf8')])
    const parsed = parseLegacyReleaseFixture(compressed)
    const expectedInventory = [...parsed.document.entries]
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
      .map((entry) => `${entry.sha256}  ${entry.mode.toString(8)}  ${entry.size}  ${entry.path}\n`)
      .join('')

    expect(metadata.fixture.file).toBe('multirepo.fixture.json.gz')
    expect(createHash('sha256').update(compressed).digest('hex')).toBe(metadata.fixture.sha256)
    expect(compressed.length).toBe(metadata.fixture.compressedBytes)
    expect(parsed.document.entries).toHaveLength(metadata.fixture.entryCount)
    expect(parsed.aggregateBytes).toBe(metadata.fixture.totalBytes)
    expect(parsed.document.entries.filter((entry) => entry.mode === 0o755)).toHaveLength(metadata.fixture.executableEntries)
    expect(parsed.canonicalDigest).toBe(metadata.fixture.treeSha256)
    expect(parsed.document.treeSha256).toBe(metadata.fixture.treeSha256)
    expect(parsed.document.source).toEqual(source)
    expect(metadata.source).toMatchObject(source)
    expect(parsed.document.source).toMatchObject(LEGACY_SOURCE)
    expect(recordedInventory).toBe(expectedInventory)

    const projectName = metadata.generationInputs.projectName
    expect(parsed.document.generationInputs.projectName).toBe(projectName)
    const fixturePaths = new Set(parsed.document.entries.map((entry) => entry.path))
    const expectedBaselinePaths = [
      ...Object.keys(LEGACY_BETA_MULTIREPO_BASELINE.api).map((path) => `apps/${projectName}-api/${path}`),
      ...Object.keys(LEGACY_BETA_MULTIREPO_BASELINE.web).map((path) => `apps/${projectName}-web/${path}`)
    ].sort()
    expect([...fixturePaths].sort()).toEqual(expectedBaselinePaths)
  })

  it('validates the complete bundle before materializing files exclusively', async () => {
    const entries = [fixtureEntry('README.md', 'legacy fixture\n'), fixtureEntry('apps/api/run.sh', '#!/bin/sh\nexit 0\n', 0o755), fixtureEntry('apps/web/empty.txt', '')]
    const compressed = bundle(document(entries))

    const parsed = parseLegacyReleaseFixture(compressed)
    const materialized = await materializeLegacyReleaseFixture(compressed, destination)

    expect(materialized.canonicalDigest).toBe(inventoryDigest(entries))
    expect(materialized.canonicalDigest).toBe(parsed.document.treeSha256)
    expect(await readFile(join(destination, 'README.md'), 'utf8')).toBe('legacy fixture\n')
    expect(await readFile(join(destination, 'apps/api/run.sh'), 'utf8')).toBe('#!/bin/sh\nexit 0\n')
    expect(await snapshotCanonicalTree(destination)).toEqual([
      expect.objectContaining({ path: 'README.md', type: 'file', mode: 0o644, size: 15 }),
      expect.objectContaining({ path: 'apps/api/run.sh', type: 'file', mode: 0o755 }),
      expect.objectContaining({ path: 'apps/web/empty.txt', type: 'file', mode: 0o644, size: 0 })
    ])
    expect(await canonicalTreeDigest(destination)).toBe(materialized.canonicalDigest)
  })

  it.each([
    '/absolute',
    '//server/share',
    'C:/drive/path',
    '\\\\server\\share',
    'apps\\api\\main.ts',
    'nul\0byte',
    'control\u001fbyte',
    'apps//api',
    './apps/api',
    'apps/../api',
    'apps/./api',
    'CON',
    'con.txt',
    'apps/NUL/config',
    'COM¹.txt',
    'LPT³',
    'CONIN$',
    'CONOUT$.txt',
    'σ.txt',
    'ς.txt',
    'Straße.txt',
    'trailing.',
    'trailing ',
    'stream:name'
  ])('rejects unsafe cross-platform path %p before touching the destination', async (path) => {
    await expectRejectedWithoutWrites(bundle(document([fixtureEntry(path)])))
  })

  it.each([
    [fixtureEntry('Readme.md'), fixtureEntry('README.md')],
    [fixtureEntry('caf\u00e9.txt'), fixtureEntry('cafe\u0301.txt')],
    [fixtureEntry('Apps/api/main.ts'), fixtureEntry('apps/web/main.ts')],
    [fixtureEntry('apps'), fixtureEntry('apps/api/main.ts')],
    [fixtureEntry('apps/api'), fixtureEntry('apps/api/main.ts')]
  ])('rejects duplicate or prefix-colliding paths before touching the destination', async (...entries) => {
    await expectRejectedWithoutWrites(bundle(document(entries)))
  })

  it('rejects unsupported entry types and modes before touching the destination', async () => {
    const unsupportedType = { ...fixtureEntry('apps/api'), type: 'directory' }
    await expectRejectedWithoutWrites(bundle(document([unsupportedType as unknown as LegacyReleaseFixtureEntry])))

    const unsupportedMode = { ...fixtureEntry('secret.txt'), mode: 0o600 }
    await expectRejectedWithoutWrites(bundle(document([unsupportedMode as unknown as LegacyReleaseFixtureEntry])))
  })

  it('rejects size, content hash, base64, and tree digest mismatches before writes', async () => {
    const good = fixtureEntry('file.txt', 'content')
    await expectRejectedWithoutWrites(bundle(document([{ ...good, size: good.size + 1 }])))
    await expectRejectedWithoutWrites(bundle(document([{ ...good, sha256: '0'.repeat(64) }])))
    await expectRejectedWithoutWrites(bundle(document([{ ...good, contentBase64: `${good.contentBase64}=`, size: good.size }])))
    await expectRejectedWithoutWrites(bundle({ ...document([good]), treeSha256: '0'.repeat(64) }))
  })

  it('enforces compressed, decompressed, per-file, aggregate, and entry-count limits before writes', async () => {
    const one = fixtureEntry('one.txt', '123')
    const two = fixtureEntry('two.txt', '456')
    const compressed = bundle(document([one, two]))

    await expectRejectedWithoutWrites(compressed, { maxCompressedBytes: compressed.length - 1 })
    await expectRejectedWithoutWrites(compressed, { maxDecompressedBytes: 32 })
    await expectRejectedWithoutWrites(compressed, { maxEntryBytes: 2, maxAggregateBytes: 6 })
    await expectRejectedWithoutWrites(compressed, { maxEntryBytes: 3, maxAggregateBytes: 5 })
    await expectRejectedWithoutWrites(compressed, { maxEntries: 1 })
  })

  it('rejects unknown or missing schema fields before writes', async () => {
    const valid = document([fixtureEntry('file.txt')])
    await expectRejectedWithoutWrites(bundle({ ...valid, unexpected: true }))
    const missingSource = { ...valid } as Partial<LegacyReleaseFixtureDocument>
    delete missingSource.source
    await expectRejectedWithoutWrites(bundle(missingSource))
    await expectRejectedWithoutWrites(bundle({ ...valid, generationInputs: [] }))
    await expectRejectedWithoutWrites(bundle({ ...valid, source: { ...valid.source, unexpected: true } }))
    await expectRejectedWithoutWrites(bundle({ ...valid, source: { ...valid.source, integrity: 'sha512-AA==' } }))
    await expectRejectedWithoutWrites(bundle({ ...valid, entries: [{ ...valid.entries[0], unexpected: true }] }))
  })

  it('rejects linked and non-empty destinations without replacing them', async () => {
    const compressed = bundle(document([fixtureEntry('file.txt')]))
    await mkdir(destination)
    await writeFile(join(destination, 'owned.txt'), 'keep')
    await expect(materializeLegacyReleaseFixture(compressed, destination)).rejects.toThrow(/must not already exist/)
    expect(await readFile(join(destination, 'owned.txt'), 'utf8')).toBe('keep')

    if (process.platform !== 'win32') {
      const linkedDestination = join(temporaryRoot, 'linked-destination')
      await symlink(destination, linkedDestination)
      await expect(materializeLegacyReleaseFixture(compressed, linkedDestination)).rejects.toThrow(/must not already exist/)
      expect(await readFile(join(destination, 'owned.txt'), 'utf8')).toBe('keep')
    }
  })

  it('cannot redirect staged writes by swapping the final destination', async () => {
    if (process.platform === 'win32') return
    const outside = join(temporaryRoot, 'outside')
    await mkdir(outside)
    const entries = Array.from({ length: 800 }, (_, index) => fixtureEntry(`files/${String(index).padStart(4, '0')}.txt`, 'x'.repeat(4096)))
    const materialization = materializeLegacyReleaseFixture(bundle(document(entries)), destination)

    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const names = await readdir(temporaryRoot)
      if (names.some((name) => name.startsWith('.destination.sf-fixture-'))) break
      await new Promise((resolve) => setImmediate(resolve))
    }
    await symlink(outside, destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })

    let published = true
    await materialization.catch(() => {
      published = false
    })
    expect(await readdir(outside)).toEqual([])
    if (published) {
      expect((await lstat(destination)).isDirectory()).toBe(true)
      expect(await readFile(join(destination, 'files/0799.txt'), 'utf8')).toBe('x'.repeat(4096))
    } else {
      expect((await lstat(destination)).isSymbolicLink()).toBe(true)
      expect((await readdir(temporaryRoot)).some((name) => name.startsWith('.destination.sf-fixture-'))).toBe(false)
    }
  })

  it('takes a stable bounded snapshot, supports explicit subtree exclusions, and rejects links', async () => {
    await mkdir(destination)
    await writeFile(join(destination, 'keep.txt'), 'keep')
    await mkdir(join(destination, 'ignored'))
    await writeFile(join(destination, 'ignored', 'volatile.log'), 'changes')

    const first = await snapshotCanonicalTree(destination, { exclude: ['ignored'] })
    await writeFile(join(destination, 'ignored', 'volatile.log'), 'different')
    const second = await snapshotCanonicalTree(destination, { exclude: ['ignored'] })
    expect(second).toEqual(first)
    expect(await canonicalTreeDigest(destination, { exclude: ['ignored'] })).toBe(inventoryDigest(first))

    if (process.platform !== 'win32') {
      await symlink('keep.txt', join(destination, 'linked.txt'))
      await expect(snapshotCanonicalTree(destination, { exclude: ['ignored'] })).rejects.toThrow(/symbolic links/)
    }
  })
})
