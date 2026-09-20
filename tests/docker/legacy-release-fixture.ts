import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { TextDecoder } from 'node:util'
import { gunzipSync } from 'node:zlib'

export interface LegacyFixtureLimits {
  maxCompressedBytes: number
  maxDecompressedBytes: number
  maxEntryBytes: number
  maxAggregateBytes: number
  maxEntries: number
  maxPathBytes: number
  maxSegmentBytes: number
}

export const DEFAULT_LEGACY_FIXTURE_LIMITS: Readonly<LegacyFixtureLimits> = Object.freeze({
  maxCompressedBytes: 4 * 1024 * 1024,
  maxDecompressedBytes: 12 * 1024 * 1024,
  maxEntryBytes: 1024 * 1024,
  maxAggregateBytes: 8 * 1024 * 1024,
  maxEntries: 1_000,
  maxPathBytes: 512,
  maxSegmentBytes: 255
})

type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface LegacyReleaseFixtureSource {
  package: string
  version: string
  integrity: string
  shasum: string
  gitHead: string
  archiveSha256: string
}

export interface LegacyReleaseFixtureEntry {
  path: string
  type: 'file'
  mode: 0o644 | 0o755
  size: number
  sha256: string
  contentBase64: string
}

export interface LegacyReleaseFixtureDocument {
  schemaVersion: 1
  source: LegacyReleaseFixtureSource
  generationInputs: Record<string, JsonValue>
  treeSha256: string
  entries: LegacyReleaseFixtureEntry[]
}

export interface ValidatedLegacyReleaseFixture {
  document: LegacyReleaseFixtureDocument
  entries: Array<LegacyReleaseFixtureEntry & { bytes: Buffer }>
  compressedBytes: number
  decompressedBytes: number
  aggregateBytes: number
  canonicalDigest: string
}

export interface CanonicalTreeEntry {
  path: string
  type: 'file'
  mode: number
  size: number
  sha256: string
}

export interface CanonicalTreeOptions {
  /** Exact relative paths; a directory excludes its complete subtree. */
  exclude?: readonly string[]
  limits?: Partial<Pick<LegacyFixtureLimits, 'maxEntries' | 'maxEntryBytes' | 'maxAggregateBytes' | 'maxPathBytes' | 'maxSegmentBytes'>>
}

const TOP_LEVEL_FIELDS = ['schemaVersion', 'source', 'generationInputs', 'treeSha256', 'entries'] as const
const SOURCE_FIELDS = ['package', 'version', 'integrity', 'shasum', 'gitHead', 'archiveSha256'] as const
const ENTRY_FIELDS = ['path', 'type', 'mode', 'size', 'sha256', 'contentBase64'] as const
const LOWER_HEX_40 = /^[0-9a-f]{40}$/
const LOWER_HEX_64 = /^[0-9a-f]{64}$/
const SHA512_SRI = /^sha512-[A-Za-z0-9+/]+={0,2}$/
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const WINDOWS_RESERVED = /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\..*)?$/i
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/
const PORTABLE_ASCII_SEGMENT = /^[A-Za-z0-9._@()+,=~ -]+$/

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactFields(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((field, index) => field !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${expected.join(', ')}`)
  }
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive safe integer`)
  return value as number
}

function resolveLimits(overrides: Partial<LegacyFixtureLimits> = {}): LegacyFixtureLimits {
  const limits = { ...DEFAULT_LEGACY_FIXTURE_LIMITS, ...overrides }
  for (const [name, value] of Object.entries(limits)) positiveInteger(value, name)
  if (limits.maxEntryBytes > limits.maxAggregateBytes) throw new Error('maxEntryBytes cannot exceed maxAggregateBytes')
  return limits
}

function assertJsonValue(root: unknown, label: string): asserts root is JsonValue {
  const pending: Array<{ value: unknown; path: string; depth: number }> = [{ value: root, path: label, depth: 0 }]
  while (pending.length > 0) {
    const current = pending.pop()!
    if (current.depth > 32) throw new Error(`${current.path} exceeds the maximum JSON nesting depth`)
    if (current.value === null || typeof current.value === 'string' || typeof current.value === 'boolean') continue
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) throw new Error(`${current.path} must be a finite JSON number`)
      continue
    }
    if (Array.isArray(current.value)) {
      current.value.forEach((value, index) => pending.push({ value, path: `${current.path}[${index}]`, depth: current.depth + 1 }))
      continue
    }
    if (object(current.value)) {
      for (const [key, value] of Object.entries(current.value)) {
        if (CONTROL_CHARACTER.test(key)) throw new Error(`${current.path} contains a control character in a key`)
        pending.push({ value, path: `${current.path}.${key}`, depth: current.depth + 1 })
      }
      continue
    }
    throw new Error(`${current.path} is not JSON data`)
  }
}

function validateFixturePath(path: unknown, limits: LegacyFixtureLimits): string {
  if (typeof path !== 'string' || path.length === 0) throw new Error('fixture entry path must be a non-empty string')
  if (Buffer.byteLength(path, 'utf8') > limits.maxPathBytes) throw new Error(`fixture entry path exceeds ${limits.maxPathBytes} bytes: ${path}`)
  if (CONTROL_CHARACTER.test(path)) throw new Error(`fixture entry path contains a control character: ${JSON.stringify(path)}`)
  if (path.includes('\\')) throw new Error(`fixture entry path must use POSIX separators: ${path}`)
  if (path.startsWith('/') || path.startsWith('//') || /^[A-Za-z]:/.test(path)) throw new Error(`fixture entry path must be relative: ${path}`)

  const segments = path.split('/')
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.' || segment === '..') throw new Error(`fixture entry path contains an unsafe component: ${path}`)
    if (Buffer.byteLength(segment, 'utf8') > limits.maxSegmentBytes) throw new Error(`fixture entry path component exceeds ${limits.maxSegmentBytes} bytes: ${path}`)
    // The committed historical fixture uses this deliberately narrow portable
    // repertoire. Rejecting all other characters avoids platform-specific
    // Unicode normalization/case-folding aliases (for example Greek sigma)
    // instead of trying to emulate every target filesystem.
    if (!PORTABLE_ASCII_SEGMENT.test(segment)) throw new Error(`fixture entry path is outside the portable ASCII repertoire: ${path}`)
    if (segment.includes(':')) throw new Error(`fixture entry path contains a Windows alternate-data-stream separator: ${path}`)
    if (/[. ]$/.test(segment)) throw new Error(`fixture entry path has a trailing dot or space: ${path}`)
    if (WINDOWS_RESERVED.test(segment)) throw new Error(`fixture entry path contains a Windows reserved name: ${path}`)
  }
  return path
}

function collisionKey(path: string): string {
  return path.normalize('NFC').toLowerCase()
}

function assertPathGraph(paths: readonly string[]): void {
  const seen = new Map<string, string>()
  const seenComponents = new Map<string, string>()
  for (const path of paths) {
    const key = collisionKey(path)
    const previous = seen.get(key)
    if (previous) throw new Error(`fixture paths collide after NFC/case folding: ${previous}, ${path}`)
    seen.set(key, path)
    const segments = path.split('/')
    for (let length = 1; length <= segments.length; length += 1) {
      const prefix = segments.slice(0, length).join('/')
      const prefixKey = collisionKey(prefix)
      const previousPrefix = seenComponents.get(prefixKey)
      if (previousPrefix && previousPrefix !== prefix) throw new Error(`fixture path components collide after NFC/case folding: ${previousPrefix}, ${prefix}`)
      seenComponents.set(prefixKey, prefix)
    }
  }

  for (const [path, original] of seen) {
    const segments = path.split('/')
    for (let length = 1; length < segments.length; length += 1) {
      const prefix = segments.slice(0, length).join('/')
      const prefixOriginal = seen.get(prefix)
      if (prefixOriginal) throw new Error(`fixture file path is also a directory prefix: ${prefixOriginal}, ${original}`)
    }
  }
}

function parseSource(value: unknown): LegacyReleaseFixtureSource {
  if (!object(value)) throw new Error('fixture source must be an object')
  exactFields(value, SOURCE_FIELDS, 'fixture source')
  for (const field of ['package', 'version', 'integrity', 'shasum', 'gitHead', 'archiveSha256'] as const) {
    if (typeof value[field] !== 'string' || value[field].length === 0) throw new Error(`fixture source.${field} must be a non-empty string`)
  }
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/.test(value.package as string)) throw new Error('fixture source.package is not a valid npm package name')
  if (!SHA512_SRI.test(value.integrity as string)) throw new Error('fixture source.integrity must be one sha512 SRI value')
  const integrityBytes = Buffer.from((value.integrity as string).slice('sha512-'.length), 'base64')
  if (integrityBytes.length !== 64 || `sha512-${integrityBytes.toString('base64')}` !== value.integrity) throw new Error('fixture source.integrity must contain one canonical SHA-512 digest')
  if (!LOWER_HEX_40.test(value.shasum as string)) throw new Error('fixture source.shasum must be a lowercase SHA-1 digest')
  if (!LOWER_HEX_40.test(value.gitHead as string) && !LOWER_HEX_64.test(value.gitHead as string)) throw new Error('fixture source.gitHead must be a lowercase Git object ID')
  if (!LOWER_HEX_64.test(value.archiveSha256 as string)) throw new Error('fixture source.archiveSha256 must be a lowercase SHA-256 digest')
  return value as unknown as LegacyReleaseFixtureSource
}

function parseEntry(value: unknown, index: number, limits: LegacyFixtureLimits): LegacyReleaseFixtureEntry & { bytes: Buffer } {
  if (!object(value)) throw new Error(`fixture entries[${index}] must be an object`)
  exactFields(value, ENTRY_FIELDS, `fixture entries[${index}]`)
  const path = validateFixturePath(value.path, limits)
  if (value.type !== 'file') throw new Error(`fixture entry type is unsupported for ${path}`)
  if (value.mode !== 0o644 && value.mode !== 0o755) throw new Error(`fixture entry mode is unsupported for ${path}`)
  if (!Number.isSafeInteger(value.size) || (value.size as number) < 0) throw new Error(`fixture entry size must be a non-negative safe integer for ${path}`)
  if ((value.size as number) > limits.maxEntryBytes) throw new Error(`fixture entry exceeds the ${limits.maxEntryBytes}-byte per-file limit: ${path}`)
  if (typeof value.sha256 !== 'string' || !LOWER_HEX_64.test(value.sha256)) throw new Error(`fixture entry sha256 is invalid for ${path}`)
  if (typeof value.contentBase64 !== 'string' || !CANONICAL_BASE64.test(value.contentBase64)) throw new Error(`fixture entry content is not canonical base64 for ${path}`)
  if (value.contentBase64.length > 4 * Math.ceil(limits.maxEntryBytes / 3)) throw new Error(`fixture entry encoded content exceeds the ${limits.maxEntryBytes}-byte per-file limit: ${path}`)

  const bytes = Buffer.from(value.contentBase64, 'base64')
  if (bytes.toString('base64') !== value.contentBase64) throw new Error(`fixture entry content is not canonical base64 for ${path}`)
  if (bytes.length !== value.size) throw new Error(`fixture entry size does not match content for ${path}`)
  if (createHash('sha256').update(bytes).digest('hex') !== value.sha256) throw new Error(`fixture entry sha256 does not match content for ${path}`)
  return { ...(value as unknown as LegacyReleaseFixtureEntry), path, bytes }
}

function digestInventory(entries: ReadonlyArray<{ path: string; mode: number; size: number; sha256: string }>): string {
  const digest = createHash('sha256')
  for (const entry of [...entries].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))) {
    digest.update(`${entry.path}\0${entry.mode}\0${entry.size}\0${entry.sha256}\n`, 'utf8')
  }
  return digest.digest('hex')
}

export function parseLegacyReleaseFixture(compressed: Buffer, limitOverrides: Partial<LegacyFixtureLimits> = {}): ValidatedLegacyReleaseFixture {
  const limits = resolveLimits(limitOverrides)
  if (!Buffer.isBuffer(compressed)) throw new Error('legacy fixture must be provided as a Buffer')
  if (compressed.length === 0) throw new Error('legacy fixture is empty')
  if (compressed.length > limits.maxCompressedBytes) throw new Error(`legacy fixture exceeds the ${limits.maxCompressedBytes}-byte compressed limit`)

  let decompressed: Buffer
  try {
    decompressed = gunzipSync(compressed, { maxOutputLength: limits.maxDecompressedBytes + 1 })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`legacy fixture is not a bounded gzip document: ${detail}`)
  }
  if (decompressed.length > limits.maxDecompressedBytes) throw new Error(`legacy fixture exceeds the ${limits.maxDecompressedBytes}-byte decompressed limit`)

  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decompressed))
  } catch {
    throw new Error('legacy fixture does not contain valid UTF-8 JSON')
  }
  if (!object(value)) throw new Error('legacy fixture document must be an object')
  exactFields(value, TOP_LEVEL_FIELDS, 'legacy fixture document')
  if (value.schemaVersion !== 1) throw new Error('legacy fixture schemaVersion must equal 1')
  const source = parseSource(value.source)
  if (!object(value.generationInputs)) throw new Error('legacy fixture generationInputs must be an object')
  assertJsonValue(value.generationInputs, 'fixture generationInputs')
  if (typeof value.treeSha256 !== 'string' || !LOWER_HEX_64.test(value.treeSha256)) throw new Error('legacy fixture treeSha256 must be a lowercase SHA-256 digest')
  if (!Array.isArray(value.entries)) throw new Error('legacy fixture entries must be an array')
  if (value.entries.length === 0) throw new Error('legacy fixture must contain at least one entry')
  if (value.entries.length > limits.maxEntries) throw new Error(`legacy fixture exceeds the ${limits.maxEntries}-entry limit`)

  const entries: Array<LegacyReleaseFixtureEntry & { bytes: Buffer }> = []
  let aggregateBytes = 0
  value.entries.forEach((entry, index) => {
    const parsed = parseEntry(entry, index, limits)
    aggregateBytes += parsed.bytes.length
    if (!Number.isSafeInteger(aggregateBytes) || aggregateBytes > limits.maxAggregateBytes) throw new Error(`legacy fixture exceeds the ${limits.maxAggregateBytes}-byte aggregate file limit`)
    entries.push(parsed)
  })
  assertPathGraph(entries.map((entry) => entry.path))
  const canonicalDigest = digestInventory(entries)
  if (value.treeSha256 !== canonicalDigest) throw new Error('legacy fixture treeSha256 does not match its canonical entry inventory')

  const document: LegacyReleaseFixtureDocument = {
    schemaVersion: 1,
    source,
    generationInputs: value.generationInputs as Record<string, JsonValue>,
    treeSha256: value.treeSha256,
    entries: entries.map((entry) => ({ path: entry.path, type: entry.type, mode: entry.mode, size: entry.size, sha256: entry.sha256, contentBase64: entry.contentBase64 }))
  }
  return {
    document,
    entries,
    compressedBytes: compressed.length,
    decompressedBytes: decompressed.length,
    aggregateBytes,
    canonicalDigest
  }
}

async function ensureDestinationAbsent(path: string): Promise<void> {
  const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (stat) throw new Error(`fixture destination must not already exist: ${path}`)
}

async function canonicalDestination(path: string): Promise<string> {
  const absolute = resolve(path)
  const parent = await realpath(dirname(absolute))
  const stat = await lstat(parent)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`fixture destination parent must be a real directory: ${parent}`)
  return join(parent, basename(absolute))
}

async function ensureRealParent(root: string, relativeDirectory: string): Promise<void> {
  if (relativeDirectory === '.') return
  let current = root
  for (const segment of relativeDirectory.split('/')) {
    current = join(current, segment)
    await mkdir(current, { mode: 0o755 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    const stat = await lstat(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`fixture destination parent is not a real directory: ${current}`)
  }
}

export async function materializeLegacyReleaseFixture(compressed: Buffer, destination: string, options: { limits?: Partial<LegacyFixtureLimits> } = {}): Promise<ValidatedLegacyReleaseFixture> {
  // No filesystem operation occurs until the complete bundle and its path graph
  // have passed validation.
  const fixture = parseLegacyReleaseFixture(compressed, options.limits)
  const safeDestination = await canonicalDestination(destination)
  await ensureDestinationAbsent(safeDestination)
  const staging = await mkdtemp(join(dirname(safeDestination), `.${basename(safeDestination)}.sf-fixture-`))
  await chmod(staging, 0o700)
  const noFollow = 'O_NOFOLLOW' in constants ? constants.O_NOFOLLOW : 0
  let published = false

  try {
    for (const entry of [...fixture.entries].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))) {
      const target = join(staging, ...entry.path.split('/'))
      await ensureRealParent(staging, dirname(entry.path).split('\\').join('/'))
      const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, entry.mode)
      try {
        await handle.writeFile(entry.bytes)
        await handle.chmod(entry.mode)
        const stat = await handle.stat()
        if (!stat.isFile() || stat.nlink !== 1 || stat.size !== entry.size) throw new Error(`fixture entry was not published as one regular file: ${entry.path}`)
      } finally {
        await handle.close()
      }
    }

    // Writes happen only in the private staging tree. A concurrent destination
    // swap can at worst make this atomic rename fail or replace that directory
    // entry; it cannot redirect individual fixture writes outside the root.
    await rename(staging, safeDestination)
    published = true
    return fixture
  } finally {
    if (!published) await rm(staging, { recursive: true, force: true })
  }
}

function excluded(path: string, exclusions: readonly string[]): boolean {
  return exclusions.some((candidate) => path === candidate || path.startsWith(`${candidate}/`))
}

async function hashRegularFile(path: string, limits: LegacyFixtureLimits, budget: { bytes: number }): Promise<{ size: number; mode: number; sha256: string }> {
  const noFollow = 'O_NOFOLLOW' in constants ? constants.O_NOFOLLOW : 0
  const nonBlock = 'O_NONBLOCK' in constants ? constants.O_NONBLOCK : 0
  const handle = await open(path, constants.O_RDONLY | noFollow | nonBlock)
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.nlink !== 1) throw new Error(`canonical tree entry is not one regular file: ${path}`)
    if (before.size > limits.maxEntryBytes) throw new Error(`canonical tree entry exceeds the ${limits.maxEntryBytes}-byte per-file limit: ${path}`)
    if (budget.bytes + before.size > limits.maxAggregateBytes) throw new Error(`canonical tree exceeds the ${limits.maxAggregateBytes}-byte aggregate limit`)
    budget.bytes += before.size
    const digest = createHash('sha256')
    const stream = handle.createReadStream({ autoClose: false })
    for await (const chunk of stream) digest.update(chunk as Buffer)
    const after = await handle.stat()
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.mode !== after.mode ||
      before.nlink !== after.nlink ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw new Error(`canonical tree entry changed while it was read: ${path}`)
    }
    return { size: before.size, mode: before.mode & 0o7777, sha256: digest.digest('hex') }
  } finally {
    await handle.close()
  }
}

export async function snapshotCanonicalTree(root: string, options: CanonicalTreeOptions = {}): Promise<CanonicalTreeEntry[]> {
  const limits = resolveLimits(options.limits)
  const exclusions = (options.exclude ?? []).map((path) => validateFixturePath(path, limits))
  assertPathGraph(exclusions)
  const rootStat = await lstat(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`canonical tree root must be a real directory: ${root}`)

  const result: CanonicalTreeEntry[] = []
  const seenPaths: string[] = []
  const budget = { bytes: 0 }
  const walk = async (directory: string, relativeDirectory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      validateFixturePath(relativePath, limits)
      if (excluded(relativePath, exclusions)) continue
      const absolute = join(directory, entry.name)
      const stat = await lstat(absolute)
      if (stat.isSymbolicLink()) throw new Error(`canonical tree does not support symbolic links: ${relativePath}`)
      if (stat.isDirectory()) {
        await walk(absolute, relativePath)
        continue
      }
      if (!stat.isFile() || stat.nlink !== 1) throw new Error(`canonical tree does not support this entry type: ${relativePath}`)
      const evidence = await hashRegularFile(absolute, limits, budget)
      result.push({ path: relativePath, type: 'file', ...evidence })
      seenPaths.push(relativePath)
      if (result.length > limits.maxEntries) throw new Error(`canonical tree exceeds the ${limits.maxEntries}-entry limit`)
    }
  }
  await walk(root, '')
  assertPathGraph(seenPaths)
  return result
}

export async function canonicalTreeDigest(root: string, options: CanonicalTreeOptions = {}): Promise<string> {
  const snapshot = await snapshotCanonicalTree(root, options)
  return digestInventory(snapshot)
}
