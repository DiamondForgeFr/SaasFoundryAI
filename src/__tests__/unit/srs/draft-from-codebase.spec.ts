import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runDraftFromCodebase } from '../../../srs/bin/draft-from-codebase'

describe('runDraftFromCodebase', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-srs-codebase-'))
  })

  const writeManifest = (body: unknown): string => {
    const p = join(tmp, '.saasfoundry.json')
    writeFileSync(p, JSON.stringify(body))
    return p
  }

  it('emits an empty findings list on a bare project', async () => {
    const stdout: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })
    const manifestPath = writeManifest({ tools: { srs: { backend: 'notion' } } })

    const code = await runDraftFromCodebase({ scanPath: tmp, manifestPath })

    expect(code).toBe(0)
    const body = JSON.parse(stdout.join(''))
    expect(body.source).toBe('codebase')
    expect(body.findings).toEqual([])
  })

  it('returns 2 when --path points to a missing directory', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: { srs: { backend: 'notion' } } })

    const code = await runDraftFromCodebase({ scanPath: join(tmp, 'does-not-exist'), manifestPath })

    expect(code).toBe(2)
  })

  it('returns 2 when --path points to a file', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const filePath = join(tmp, 'not-a-dir.txt')
    writeFileSync(filePath, 'hello')
    const manifestPath = writeManifest({ tools: { srs: { backend: 'notion' } } })

    const code = await runDraftFromCodebase({ scanPath: filePath, manifestPath })

    expect(code).toBe(2)
  })

  it('returns 2 when the manifest JSON is malformed', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = join(tmp, '.saasfoundry.json')
    writeFileSync(manifestPath, '{ not valid json')

    const code = await runDraftFromCodebase({ scanPath: tmp, manifestPath })

    expect(code).toBe(2)
  })

  it('returns 3 when tools.srs.backend is missing', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: {} })

    const code = await runDraftFromCodebase({ scanPath: tmp, manifestPath })

    expect(code).toBe(3)
  })

  it('returns 4 when the backend is unknown', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: { srs: { backend: 'confluence' } } })

    const code = await runDraftFromCodebase({ scanPath: tmp, manifestPath })

    expect(code).toBe(4)
  })

  it('falls back to process.cwd() when scanPath is empty', async () => {
    const stdout: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })
    const originalCwd = process.cwd()
    process.chdir(tmp)
    try {
      const manifestPath = writeManifest({ tools: { srs: { backend: 'notion' } } })
      const code = await runDraftFromCodebase({ scanPath: '', manifestPath })
      expect(code).toBe(0)
      const body = JSON.parse(stdout.join(''))
      expect(body.findings).toEqual([])
    } finally {
      process.chdir(originalCwd)
    }
  })

  it('respects .gitignore when walking the scan tree', async () => {
    const stdout: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })
    mkdirSync(join(tmp, 'src'))
    writeFileSync(join(tmp, 'src', 'a.ts'), 'export const a = 1')
    writeFileSync(join(tmp, 'src', 'b.log'), 'ignored')
    writeFileSync(join(tmp, '.gitignore'), '*.log\n')
    const manifestPath = writeManifest({ tools: { srs: { backend: 'notion' } } })

    const code = await runDraftFromCodebase({ scanPath: tmp, manifestPath })

    expect(code).toBe(0)
    // No scanners registered yet, but the walker must run end-to-end without errors.
    const body = JSON.parse(stdout.join(''))
    expect(body.source).toBe('codebase')
    expect(body.findings).toEqual([])
  })

  it('excludes node_modules / dist / coverage / .git even without .gitignore', async () => {
    const stdout: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })
    for (const dir of ['node_modules', 'dist', 'coverage', '.git']) {
      mkdirSync(join(tmp, dir))
      writeFileSync(join(tmp, dir, 'blob.ts'), 'ignored')
    }
    const manifestPath = writeManifest({ tools: { srs: { backend: 'notion' } } })

    const code = await runDraftFromCodebase({ scanPath: tmp, manifestPath })

    expect(code).toBe(0)
    // No scanners → empty findings, but walker must not traverse those dirs.
    const body = JSON.parse(stdout.join(''))
    expect(body.findings).toEqual([])
  })
})
