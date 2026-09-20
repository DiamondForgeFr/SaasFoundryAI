import { link, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createManifestFileSafe, mutateProjectManifestSafe, readManifestFileSafe, replaceManifestFileSafe } from '../../manifest-file'

describe('safe manifest file', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-safe-manifest-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('rejects symbolic and hard-linked manifests', async () => {
    const outside = join(root, 'outside.json')
    await writeFile(outside, '{}')
    await symlink(outside, join(root, 'symbolic.json'))
    await link(outside, join(root, 'hard.json'))
    await expect(readManifestFileSafe(join(root, 'symbolic.json'))).rejects.toThrow('regular, non-linked')
    await expect(readManifestFileSafe(join(root, 'hard.json'))).rejects.toThrow('regular, non-linked')
  })

  it('creates a new manifest exclusively and never replaces an existing file', async () => {
    const path = join(root, '.saasfoundry.json')
    const snapshot = await createManifestFileSafe(path, Buffer.from('{"version":1}\n'))
    expect(snapshot.bytes.toString()).toBe('{"version":1}\n')
    await expect(createManifestFileSafe(path, Buffer.from('{"version":2}\n'))).rejects.toThrow('already exists')
    expect(await readFile(path, 'utf8')).toBe('{"version":1}\n')
  })

  it('replaces the expected identity atomically and refuses stale snapshots', async () => {
    const path = join(root, '.saasfoundry.json')
    await writeFile(path, '{"version":1}\n')
    const first = await readManifestFileSafe(path)
    const second = await replaceManifestFileSafe(first, Buffer.from('{"version":2}\n'))
    expect(await readFile(path, 'utf8')).toBe('{"version":2}\n')
    await expect(replaceManifestFileSafe(first, Buffer.from('{"version":3}\n'))).rejects.toThrow('changed during the update')
    expect(second.bytes.toString()).toBe('{"version":2}\n')
  })

  it('requires a real manifest parent directory', async () => {
    const outside = join(root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, '.saasfoundry.json'), '{}')
    await symlink(outside, join(root, 'linked-root'))
    await expect(readManifestFileSafe(join(root, 'linked-root', '.saasfoundry.json'))).rejects.toThrow('parent')
  })

  it('serializes project writers through the shared manifest lock', async () => {
    const path = join(root, '.saasfoundry.json')
    const before = '{"version":"1","projectName":"p","structure":"cli"}\n'
    await writeFile(path, before)
    await writeFile(join(root, '.saasfoundry.agents.lock'), 'another writer')

    await expect(
      mutateProjectManifestSafe(root, (manifest) => {
        manifest.mainBranch = 'develop'
      })
    ).rejects.toThrow('Another manifest or agent configuration update is in progress')
    expect(await readFile(path, 'utf8')).toBe(before)
  })

  it('refuses to commit when the project directory identity is replaced', async () => {
    const project = join(root, 'project')
    const displaced = join(root, 'project-displaced')
    await mkdir(project)
    const path = join(project, '.saasfoundry.json')
    await writeFile(path, '{"version":1}\n')
    const snapshot = await readManifestFileSafe(path)

    await expect(
      replaceManifestFileSafe(snapshot, Buffer.from('{"version":2}\n'), {
        beforeCommitValidation: async () => {
          await rename(project, displaced)
          await mkdir(project)
          for (const name of await readdir(displaced)) await rename(join(displaced, name), join(project, name))
        }
      })
    ).rejects.toThrow('project directory changed before the manifest commit')
    expect(await readFile(path, 'utf8')).toBe('{"version":1}\n')
  })
})
