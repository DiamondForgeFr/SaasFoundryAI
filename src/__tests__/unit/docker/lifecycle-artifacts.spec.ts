import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createArtifactSink } from '../../../../tests/docker/lifecycle/artifacts'

describe('private lifecycle artifact sink', () => {
  let temporaryRoot: string

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'sf-lifecycle-artifacts-'))
  })

  afterEach(async () => {
    await rm(temporaryRoot, { recursive: true, force: true })
  })

  it('writes only declared private files and redacts text before disk retention', async () => {
    const secret = 'artifact-secret-value'
    const root = join(temporaryRoot, 'evidence')
    const sink = await createArtifactSink({ root, allowedPaths: ['logs/api.log'], secrets: [secret] })

    const descriptor = await sink.writeText('logs/api.log', `Authorization: Bearer ${secret}\nmessage=useful\n`)
    const manifest = await sink.writeManifest()
    const stored = await readFile(join(root, 'logs/api.log'), 'utf8')

    expect(stored).toBe('Authorization: <redacted>\nmessage=useful\n')
    expect(stored).not.toContain(secret)
    expect(descriptor).toMatchObject({ path: 'logs/api.log', bytes: Buffer.byteLength(stored), sensitivity: 'diagnostic' })
    expect(descriptor.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.path).toBe('manifest.json')
    expect(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')).artifacts).toEqual([descriptor])
    expect((await lstat(root)).mode & 0o777).toBe(0o700)
    expect((await lstat(join(root, 'logs/api.log'))).mode & 0o777).toBe(0o600)
  })

  it('rejects traversal, undeclared paths, existing roots, and project-contained roots', async () => {
    await expect(createArtifactSink({ root: join(temporaryRoot, 'traversal'), allowedPaths: ['logs/../escape.log'] })).rejects.toThrow(/unsafe component/)
    await expect(createArtifactSink({ root: join(temporaryRoot, 'reserved'), allowedPaths: ['logs/CON'] })).rejects.toThrow(/unsafe component/)
    await expect(createArtifactSink({ root: join(temporaryRoot, 'collision'), allowedPaths: ['logs/API.log', 'logs/api.log'] })).rejects.toThrow(/collide/)

    const root = join(temporaryRoot, 'evidence')
    const sink = await createArtifactSink({ root, allowedPaths: ['logs/api.log'] })
    await expect(sink.writeText('logs/web.log', 'x')).rejects.toThrow(/not declared/)
    await expect(createArtifactSink({ root, allowedPaths: ['logs/api.log'] })).rejects.toThrow(/must not already exist/)

    const project = join(temporaryRoot, 'project')
    await mkdir(project)
    await expect(createArtifactSink({ root: join(project, 'artifacts'), projectRoot: project, allowedPaths: ['logs/api.log'] })).rejects.toThrow(/outside the generated project/)
  })

  it('anchors an artifact root safely before the generated project exists', async () => {
    const futureProject = join(temporaryRoot, 'workspace', 'previous-release')
    const artifactParent = join(temporaryRoot, 'artifacts')
    await mkdir(join(temporaryRoot, 'workspace'))
    await mkdir(artifactParent)

    const sink = await createArtifactSink({
      root: join(artifactParent, 'run'),
      projectRoot: futureProject,
      allowedPaths: ['events/lifecycle.json']
    })
    await sink.writeText('events/lifecycle.json', '{}\n', { mediaType: 'application/json' })

    expect(await readFile(join(artifactParent, 'run', 'events/lifecycle.json'), 'utf8')).toBe('{}\n')
  })

  it('refuses a symbolic-link ancestor and leaves the outside directory empty', async () => {
    if (!('O_NOFOLLOW' in constants)) return
    const outside = join(temporaryRoot, 'outside')
    await mkdir(outside)
    const root = join(temporaryRoot, 'evidence')
    const sink = await createArtifactSink({ root, allowedPaths: ['logs/api.log'] })
    await symlink(outside, join(root, 'logs'))

    await expect(sink.writeText('logs/api.log', 'must stay inside')).rejects.toThrow(/not a real directory/)
    await expect(readFile(join(outside, 'api.log'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('serializes concurrent writes and enforces file, count, aggregate, and single-write limits', async () => {
    const sink = await createArtifactSink({
      root: join(temporaryRoot, 'evidence'),
      allowedPaths: ['logs/a.log', 'logs/b.log', 'logs/c.log'],
      limits: { maxFiles: 2, maxFileBytes: 4, maxAggregateBytes: 6 }
    })

    await Promise.all([sink.writeText('logs/a.log', 'aaa'), sink.writeText('logs/b.log', 'bbb')])
    await expect(sink.writeText('logs/c.log', 'c')).rejects.toThrow(/count or aggregate/)
    await expect(sink.writeText('logs/a.log', 'x')).rejects.toThrow(/only once/)

    const oversized = await createArtifactSink({
      root: join(temporaryRoot, 'oversized'),
      allowedPaths: ['traces/failure.zip'],
      limits: { maxFiles: 1, maxFileBytes: 2, maxAggregateBytes: 2 }
    })
    await expect(oversized.writeBinary('traces/failure.zip', Buffer.from('abc'), { mediaType: 'application/zip', sensitivity: 'browser-capture' })).rejects.toThrow(/per-file/)
  })
})
