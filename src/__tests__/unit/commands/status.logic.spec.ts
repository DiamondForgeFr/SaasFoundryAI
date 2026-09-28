import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { collectStatus } from '../../../status/collect'
import { writeManifest } from '../../../utils'
import type { SaaSFoundryManifest } from '../../../types'

describe('collectStatus', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-status-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  it('returns a null manifest when .saasfoundry.json is missing', async () => {
    const report = await collectStatus(tempDir)
    expect(report.manifest).toBeNull()
    expect(report.projectRoot).toBe(tempDir)
    expect(report.manifestPath).toContain('.saasfoundry.json')
  })

  it('reads the manifest when present', async () => {
    const manifest: SaaSFoundryManifest = {
      version: '1.0.0-beta',
      generatedAt: new Date().toISOString(),
      structure: 'monorepo',
      projectName: 'status-test'
    }
    await writeManifest(tempDir, manifest)
    const report = await collectStatus(tempDir)
    expect(report.manifest?.projectName).toBe('status-test')
    expect(report.manifest?.structure).toBe('monorepo')
  })

  it('skips gh tooling probe unless --check-gh is requested', async () => {
    const report = await collectStatus(tempDir)
    expect(report.tools.find((t) => t.name === 'gh')).toBeUndefined()
  })

  it('probes gh when --check-gh is requested', async () => {
    const report = await collectStatus(tempDir, { checkGh: true })
    const gh = report.tools.find((t) => t.name === 'gh')
    expect(gh).toBeDefined()
    expect(typeof gh?.available).toBe('boolean')
  })

  it('reports git as unavailable for a non-git directory', async () => {
    const report = await collectStatus(tempDir)
    expect(report.git.available).toBe(false)
  })
})
