import { mkdir, writeFile } from 'fs/promises'
import path from 'path'

import { buildManifest, readManifest, writeManifest } from '../../../skill/manifest'
import { createTempDir } from '../../helpers/temp-dir'

describe('skill/manifest', () => {
  it('returns null when no manifest exists', async () => {
    const { dir, cleanup } = await createTempDir()
    try {
      const manifest = await readManifest(dir)
      expect(manifest).toBeNull()
    } finally {
      await cleanup()
    }
  })

  it('round-trips a manifest through write + read', async () => {
    const { dir, cleanup } = await createTempDir()
    try {
      await mkdir(dir, { recursive: true })
      const built = buildManifest('1.2.3', 'user', new Date('2026-04-17T10:00:00Z'))
      await writeManifest(dir, built)
      const read = await readManifest(dir)
      expect(read).toEqual({
        cliVersion: '1.2.3',
        installedAt: '2026-04-17T10:00:00.000Z',
        scope: 'user'
      })
    } finally {
      await cleanup()
    }
  })

  it('returns null for a corrupt manifest', async () => {
    const { dir, cleanup } = await createTempDir()
    try {
      await writeFile(path.join(dir, '.version'), '{not valid json', 'utf8')
      const manifest = await readManifest(dir)
      expect(manifest).toBeNull()
    } finally {
      await cleanup()
    }
  })

  it('returns null for a manifest with an unknown scope', async () => {
    const { dir, cleanup } = await createTempDir()
    try {
      await writeFile(path.join(dir, '.version'), JSON.stringify({ cliVersion: '1.0.0', installedAt: '2026-04-17T00:00:00Z', scope: 'whoops' }), 'utf8')
      const manifest = await readManifest(dir)
      expect(manifest).toBeNull()
    } finally {
      await cleanup()
    }
  })

  it('builds a manifest with the current ISO timestamp when not provided', () => {
    const before = Date.now()
    const manifest = buildManifest('9.9.9', 'project')
    const after = Date.now()
    const parsed = Date.parse(manifest.installedAt)
    expect(parsed).toBeGreaterThanOrEqual(before)
    expect(parsed).toBeLessThanOrEqual(after)
    expect(manifest.cliVersion).toBe('9.9.9')
    expect(manifest.scope).toBe('project')
  })
})
