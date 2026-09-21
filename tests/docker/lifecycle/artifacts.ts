import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { redactText } from './redaction'
import type { ArtifactWriteOptions, LifecycleArtifactDescriptor, LifecycleArtifactLimits, LifecycleArtifactSink } from './types'
import { LifecycleRuntimeError } from './types'

const DEFAULT_LIMITS: LifecycleArtifactLimits = {
  maxFiles: 32,
  maxFileBytes: 8 * 1024 * 1024,
  maxAggregateBytes: 32 * 1024 * 1024
}
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SAFE_TOP_LEVELS = new Set(['logs', 'events', 'timings', 'capabilities', 'screenshots', 'traces'])
const WINDOWS_RESERVED = /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9]|LPT[1-9])(?:\..*)?$/i

export interface CreateArtifactSinkOptions {
  /** Must not exist. Its existing real parent is used as the trust anchor. */
  root: string
  /** When supplied, artifact output is rejected inside this generated project tree. */
  projectRoot?: string
  /** Exact paths callers intend to create. `manifest.json` is reserved automatically. */
  allowedPaths: readonly string[]
  limits?: Partial<LifecycleArtifactLimits>
  secrets?: readonly string[]
}

class PrivateArtifactSink implements LifecycleArtifactSink {
  readonly root: string
  private readonly allowedPaths: ReadonlySet<string>
  private readonly limits: LifecycleArtifactLimits
  private readonly secrets: readonly string[]
  private readonly written = new Set<string>()
  private readonly evidence: LifecycleArtifactDescriptor[] = []
  private aggregateBytes = 0
  private queue: Promise<void> = Promise.resolve()

  constructor(root: string, allowedPaths: ReadonlySet<string>, limits: LifecycleArtifactLimits, secrets: readonly string[]) {
    this.root = root
    this.allowedPaths = allowedPaths
    this.limits = limits
    this.secrets = secrets
  }

  writeText(path: string, value: string, options: Partial<ArtifactWriteOptions> = {}): Promise<LifecycleArtifactDescriptor> {
    const bytes = Buffer.from(redactText(value, this.secrets), 'utf8')
    return this.serial(() =>
      this.write(path, bytes, {
        mediaType: options.mediaType ?? 'text/plain; charset=utf-8',
        sensitivity: options.sensitivity ?? 'diagnostic'
      })
    )
  }

  writeBinary(path: string, value: Buffer, options: ArtifactWriteOptions): Promise<LifecycleArtifactDescriptor> {
    if (!Buffer.isBuffer(value)) return Promise.reject(new TypeError('Artifact binary content must be a Buffer.'))
    return this.serial(() => this.write(path, value, { ...options, sensitivity: options.sensitivity ?? 'browser-capture' }))
  }

  descriptors(): readonly LifecycleArtifactDescriptor[] {
    return this.evidence.map((descriptor) => ({ ...descriptor }))
  }

  writeManifest(): Promise<LifecycleArtifactDescriptor> {
    return this.serial(async () => {
      const document = JSON.stringify({ schemaVersion: 1, artifacts: this.descriptors() }, null, 2) + '\n'
      return this.write('manifest.json', Buffer.from(document), { mediaType: 'application/json', sensitivity: 'diagnostic' }, true)
    })
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async write(path: string, bytes: Buffer, options: ArtifactWriteOptions, manifest = false): Promise<LifecycleArtifactDescriptor> {
    const safePath = validateArtifactPath(path, manifest)
    if ((!manifest && !this.allowedPaths.has(safePath)) || (manifest && safePath !== 'manifest.json')) {
      throw new LifecycleRuntimeError('artifact-unsafe', `Artifact path was not declared by the runtime: ${safePath}`)
    }
    if (this.written.has(safePath)) throw new LifecycleRuntimeError('artifact-unsafe', `Artifact path may be written only once: ${safePath}`)
    if (!isSafeMediaType(options.mediaType)) throw new LifecycleRuntimeError('artifact-unsafe', `Artifact media type is invalid: ${JSON.stringify(options.mediaType)}`)
    if (bytes.length > this.limits.maxFileBytes) {
      throw new LifecycleRuntimeError('artifact-limit', `Artifact ${safePath} exceeds the ${this.limits.maxFileBytes}-byte per-file limit.`)
    }
    if (this.evidence.length + 1 > this.limits.maxFiles || this.aggregateBytes + bytes.length > this.limits.maxAggregateBytes) {
      throw new LifecycleRuntimeError('artifact-limit', 'Artifact count or aggregate byte limit exceeded.')
    }

    const parent = await this.ensurePrivateParent(dirname(safePath))
    const target = join(parent, basename(safePath))
    const noFollow = 'O_NOFOLLOW' in constants ? constants.O_NOFOLLOW : 0
    let handle
    try {
      handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600)
      await handle.writeFile(bytes)
      await handle.sync()
      await handle.chmod(0o600)
      const stat = await handle.stat()
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== bytes.length) {
        throw new LifecycleRuntimeError('artifact-unsafe', `Artifact was not materialized as one private regular file: ${safePath}`)
      }
    } finally {
      await handle?.close()
    }

    const descriptor: LifecycleArtifactDescriptor = {
      path: safePath,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      mediaType: options.mediaType,
      sensitivity: options.sensitivity ?? 'diagnostic'
    }
    this.written.add(safePath)
    this.aggregateBytes += bytes.length
    this.evidence.push(descriptor)
    return { ...descriptor }
  }

  private async ensurePrivateParent(relativeDirectory: string): Promise<string> {
    let current = this.root
    if (relativeDirectory !== '.') {
      for (const segment of relativeDirectory.split('/')) {
        current = join(current, segment)
        await mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error
        })
        const stat = await lstat(current)
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new LifecycleRuntimeError('artifact-unsafe', `Artifact parent is not a real directory: ${current}`)
        await chmod(current, 0o700)
      }
    }
    const actual = await realpath(current)
    const expected = resolve(current)
    if (actual !== expected || !isInside(this.root, actual)) throw new LifecycleRuntimeError('artifact-unsafe', `Artifact parent escaped the private root: ${current}`)
    return actual
  }
}

export async function createArtifactSink(options: CreateArtifactSinkOptions): Promise<LifecycleArtifactSink> {
  const limits = resolveLimits(options.limits)
  const paths = options.allowedPaths.map((path) => validateArtifactPath(path, false))
  assertNoPortableCollisions(paths)
  const declared = new Set(paths)
  if (declared.size !== options.allowedPaths.length) throw new LifecycleRuntimeError('artifact-unsafe', 'Artifact allowlist contains a duplicate path.')

  const absolute = resolve(options.root)
  const parent = await realpath(dirname(absolute))
  const parentStat = await lstat(parent)
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new LifecycleRuntimeError('artifact-unsafe', 'Artifact root parent must be a real directory.')
  const root = join(parent, basename(absolute))
  if (options.projectRoot) {
    const projectRoot = await canonicalFuturePath(options.projectRoot)
    if (isInside(projectRoot, root)) throw new LifecycleRuntimeError('artifact-unsafe', 'Artifact root must be outside the generated project tree.')
  }
  try {
    await mkdir(root, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new LifecycleRuntimeError('artifact-unsafe', `Artifact root must not already exist: ${root}`)
    throw error
  }
  await chmod(root, 0o700)
  const rootStat = await lstat(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new LifecycleRuntimeError('artifact-unsafe', `Artifact root is not a private real directory: ${root}`)
  return new PrivateArtifactSink(root, declared, limits, options.secrets ?? [])
}

/** Resolve symlinks in the existing ancestor while allowing the final project path not to exist yet. */
async function canonicalFuturePath(value: string): Promise<string> {
  const missing: string[] = []
  let cursor = resolve(value)
  while (true) {
    try {
      const stat = await lstat(cursor)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new LifecycleRuntimeError('artifact-unsafe', 'Generated project root must resolve through a real directory.')
      return join(await realpath(cursor), ...missing.reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(cursor)
      if (parent === cursor) throw error
      missing.push(basename(cursor))
      cursor = parent
    }
  }
}

function validateArtifactPath(value: string, manifest: boolean): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 240 || isAbsolute(value) || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new LifecycleRuntimeError('artifact-unsafe', `Artifact path is unsafe: ${JSON.stringify(value)}`)
  }
  const segments = value.split('/')
  if (segments.some((segment) => !SAFE_SEGMENT.test(segment) || segment === '.' || segment === '..' || /[. ]$/.test(segment) || WINDOWS_RESERVED.test(segment))) {
    throw new LifecycleRuntimeError('artifact-unsafe', `Artifact path contains an unsafe component: ${value}`)
  }
  if (manifest) {
    if (value !== 'manifest.json') throw new LifecycleRuntimeError('artifact-unsafe', 'Only manifest.json may be written as the artifact manifest.')
  } else if (segments.length < 2 || segments.length > 4 || !SAFE_TOP_LEVELS.has(segments[0])) {
    throw new LifecycleRuntimeError('artifact-unsafe', `Artifact path is outside the fixed diagnostic directories: ${value}`)
  }
  return value
}

function assertNoPortableCollisions(paths: readonly string[]): void {
  const seen = new Map<string, string>()
  for (const path of paths) {
    const key = path.normalize('NFC').toLowerCase()
    const previous = seen.get(key)
    if (previous) throw new LifecycleRuntimeError('artifact-unsafe', `Artifact allowlist paths collide on a portable filesystem: ${previous}, ${path}`)
    seen.set(key, path)
  }
  for (const [key, path] of seen) {
    const segments = key.split('/')
    for (let length = 1; length < segments.length; length += 1) {
      const prefix = segments.slice(0, length).join('/')
      const file = seen.get(prefix)
      if (file) throw new LifecycleRuntimeError('artifact-unsafe', `Artifact allowlist path is both a file and directory prefix: ${file}, ${path}`)
    }
  }
}

function resolveLimits(overrides: Partial<LifecycleArtifactLimits> | undefined): LifecycleArtifactLimits {
  const limits = { ...DEFAULT_LIMITS, ...overrides }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new LifecycleRuntimeError('artifact-limit', `${name} must be a positive safe integer.`)
  }
  if (limits.maxFileBytes > limits.maxAggregateBytes) throw new LifecycleRuntimeError('artifact-limit', 'maxFileBytes cannot exceed maxAggregateBytes.')
  return limits
}

function isSafeMediaType(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 120 && /^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+(?:; charset=utf-8)?$/.test(value)
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}
