import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { writeMigratedFile } from '../../../migrations/module/conflict'
import type { SaaSFoundryManifest } from '../../../types'
import { hashFileContent } from '../../../utils'

const baseManifest = (fileHashes?: Record<string, string>): SaaSFoundryManifest => ({
  version: '1.0.0-beta',
  generatedAt: '2026-04-01T00:00:00.000Z',
  structure: 'cli',
  projectName: 'demo',
  manifestVersion: 2,
  fileHashes
})

describe('writeMigratedFile', () => {
  let projectDir: string

  beforeEach(async () => {
    projectDir = join(tmpdir(), `sf-mig-conflict-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(projectDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
  })

  it('writes a brand-new file in-place and reports `created`', async () => {
    const outcome = await writeMigratedFile(projectDir, 'src/email.ts', 'export const x = 1\n', baseManifest())
    expect(outcome).toBe('created')
    expect(await readFile(join(projectDir, 'src/email.ts'), 'utf8')).toBe('export const x = 1\n')
  })

  it('overwrites a tracked file in-place when the user has not edited it', async () => {
    const original = 'export const x = 1\n'
    await mkdir(join(projectDir, 'src'), { recursive: true })
    await writeFile(join(projectDir, 'src/email.ts'), original)

    const manifest = baseManifest({ 'src/email.ts': hashFileContent(original) })
    const outcome = await writeMigratedFile(projectDir, 'src/email.ts', 'export const x = 2\n', manifest)

    expect(outcome).toBe('inplace')
    expect(await readFile(join(projectDir, 'src/email.ts'), 'utf8')).toBe('export const x = 2\n')
  })

  it('writes a sidecar when the user has edited a tracked file', async () => {
    const original = 'export const x = 1\n'
    const userEdited = 'export const x = 999 // tweaked locally\n'
    await mkdir(join(projectDir, 'src'), { recursive: true })
    await writeFile(join(projectDir, 'src/email.ts'), userEdited)

    const manifest = baseManifest({ 'src/email.ts': hashFileContent(original) })
    const outcome = await writeMigratedFile(projectDir, 'src/email.ts', 'export const x = 2\n', manifest)

    expect(outcome).toBe('sidecar')
    expect(await readFile(join(projectDir, 'src/email.ts'), 'utf8')).toBe(userEdited)
    expect(await readFile(join(projectDir, 'src/email.ts.saasfoundry.new'), 'utf8')).toBe('export const x = 2\n')
  })

  it('writes in-place when the file is missing on disk even if tracked (regenerated path)', async () => {
    const manifest = baseManifest({ 'src/email.ts': hashFileContent('whatever\n') })
    const outcome = await writeMigratedFile(projectDir, 'src/email.ts', 'export const x = 2\n', manifest)

    expect(outcome).toBe('inplace')
    expect(await readFile(join(projectDir, 'src/email.ts'), 'utf8')).toBe('export const x = 2\n')
  })
})
