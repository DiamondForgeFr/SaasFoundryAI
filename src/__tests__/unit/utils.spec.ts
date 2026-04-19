import crypto from 'crypto'
import { mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { hashFileContent, computeFileHashes, validateProjectName, generateJwtSecret, setDefaultDbCredentials, fileExists, readManifest, writeManifest } from '../../utils'
import { SaaSFoundryManifest } from '../../types'

describe('utils', () => {
  // ── hashFileContent ─────────────────────────────────────────

  describe('hashFileContent', () => {
    it('should return consistent SHA-256 hash for the same content', () => {
      const hash1 = hashFileContent('hello world')
      const hash2 = hashFileContent('hello world')
      expect(hash1).toBe(hash2)
    })

    it('should return different hashes for different content', () => {
      const hash1 = hashFileContent('hello')
      const hash2 = hashFileContent('world')
      expect(hash1).not.toBe(hash2)
    })

    it('should match native crypto SHA-256', () => {
      const content = 'test content for hashing'
      const expected = crypto.createHash('sha256').update(content).digest('hex')
      expect(hashFileContent(content)).toBe(expected)
    })

    it('should return a 64-character hex string', () => {
      const hash = hashFileContent('any content')
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should handle empty string', () => {
      const hash = hashFileContent('')
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  // ── computeFileHashes ───────────────────────────────────────

  describe('computeFileHashes', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = join(tmpdir(), `sf-hash-test-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })
    })

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    })

    it('should compute hashes for all files in a directory', async () => {
      await writeFile(join(tempDir, 'file1.ts'), 'const a = 1')
      await writeFile(join(tempDir, 'file2.ts'), 'const b = 2')

      const hashes = await computeFileHashes(tempDir)

      expect(Object.keys(hashes)).toHaveLength(2)
      expect(hashes['file1.ts']).toBe(hashFileContent('const a = 1'))
      expect(hashes['file2.ts']).toBe(hashFileContent('const b = 2'))
    })

    it('should recursively walk subdirectories', async () => {
      await mkdir(join(tempDir, 'src'), { recursive: true })
      await writeFile(join(tempDir, 'src/index.ts'), 'export {}')

      const hashes = await computeFileHashes(tempDir)

      expect(hashes['src/index.ts']).toBeDefined()
    })

    it('should ignore node_modules', async () => {
      await mkdir(join(tempDir, 'node_modules/pkg'), { recursive: true })
      await writeFile(join(tempDir, 'node_modules/pkg/index.js'), 'module.exports = {}')
      await writeFile(join(tempDir, 'main.ts'), 'import "./x"')

      const hashes = await computeFileHashes(tempDir)

      expect(Object.keys(hashes)).toHaveLength(1)
      expect(hashes['main.ts']).toBeDefined()
    })

    it('should ignore .git directory', async () => {
      await mkdir(join(tempDir, '.git'), { recursive: true })
      await writeFile(join(tempDir, '.git/HEAD'), 'ref: refs/heads/main')
      await writeFile(join(tempDir, 'main.ts'), 'code')

      const hashes = await computeFileHashes(tempDir)

      expect(Object.keys(hashes)).toHaveLength(1)
    })

    it('should ignore .env files', async () => {
      await writeFile(join(tempDir, '.env'), 'SECRET=123')
      await writeFile(join(tempDir, '.env.test'), 'SECRET=test')
      await writeFile(join(tempDir, 'index.ts'), 'code')

      const hashes = await computeFileHashes(tempDir)

      expect(Object.keys(hashes)).toHaveLength(1)
      expect(hashes['.env']).toBeUndefined()
      expect(hashes['.env.test']).toBeUndefined()
    })

    it('should ignore package-lock.json', async () => {
      await writeFile(join(tempDir, 'package-lock.json'), '{}')
      await writeFile(join(tempDir, 'package.json'), '{}')

      const hashes = await computeFileHashes(tempDir)

      expect(hashes['package-lock.json']).toBeUndefined()
      expect(hashes['package.json']).toBeDefined()
    })

    it('should ignore .saasfoundry.json', async () => {
      await writeFile(join(tempDir, '.saasfoundry.json'), '{}')

      const hashes = await computeFileHashes(tempDir)

      expect(hashes['.saasfoundry.json']).toBeUndefined()
    })

    it('should ignore dist and build directories', async () => {
      await mkdir(join(tempDir, 'dist'), { recursive: true })
      await writeFile(join(tempDir, 'dist/index.js'), 'compiled code')
      await mkdir(join(tempDir, 'build'), { recursive: true })
      await writeFile(join(tempDir, 'build/output.js'), 'built code')

      const hashes = await computeFileHashes(tempDir)

      expect(Object.keys(hashes)).toHaveLength(0)
    })

    it('should return empty object for empty directory', async () => {
      const hashes = await computeFileHashes(tempDir)
      expect(hashes).toEqual({})
    })
  })

  // ── validateProjectName ─────────────────────────────────────

  describe('validateProjectName', () => {
    it('should accept valid names with lowercase letters', () => {
      expect(() => validateProjectName('myproject')).not.toThrow()
    })

    it('should accept names with numbers', () => {
      expect(() => validateProjectName('project123')).not.toThrow()
    })

    it('should accept names with hyphens', () => {
      expect(() => validateProjectName('my-project')).not.toThrow()
    })

    it('should accept names combining letters, numbers, and hyphens', () => {
      expect(() => validateProjectName('my-project-2')).not.toThrow()
    })

    it('should reject names with uppercase letters', () => {
      expect(() => validateProjectName('MyProject')).toThrow('Invalid project name')
    })

    it('should reject names with spaces', () => {
      expect(() => validateProjectName('my project')).toThrow('Invalid project name')
    })

    it('should reject names with underscores', () => {
      expect(() => validateProjectName('my_project')).toThrow('Invalid project name')
    })

    it('should reject names with special characters', () => {
      expect(() => validateProjectName('my@project')).toThrow('Invalid project name')
    })

    it('should reject empty string', () => {
      expect(() => validateProjectName('')).toThrow('Invalid project name')
    })
  })

  // ── generateJwtSecret ───────────────────────────────────────

  describe('generateJwtSecret', () => {
    it('should generate a 128-character hex string by default (64 bytes)', () => {
      const secret = generateJwtSecret()
      expect(secret).toMatch(/^[a-f0-9]{128}$/)
    })

    it('should generate different secrets each time', () => {
      const secret1 = generateJwtSecret()
      const secret2 = generateJwtSecret()
      expect(secret1).not.toBe(secret2)
    })

    it('should respect custom length parameter', () => {
      const secret = generateJwtSecret(32)
      expect(secret).toMatch(/^[a-f0-9]{64}$/) // 32 bytes = 64 hex chars
    })
  })

  // ── setDefaultDbCredentials ─────────────────────────────────

  describe('setDefaultDbCredentials', () => {
    it('should return undefined when no credentials provided', () => {
      expect(setDefaultDbCredentials(undefined)).toBeUndefined()
    })

    it('should set postgresql defaults for empty fields', () => {
      const result = setDefaultDbCredentials({
        host: '',
        port: '',
        user: '',
        password: '',
        database: '',
        dbType: 'postgresql'
      })

      expect(result).toEqual({
        dbType: 'postgresql',
        host: 'localhost',
        port: '5435',
        user: 'db_dev_user',
        password: 'db_dev_password',
        database: 'db_dev'
      })
    })

    it('should preserve provided values', () => {
      const input = {
        host: 'myhost',
        port: '5432',
        user: 'myuser',
        password: 'mypass',
        database: 'mydb',
        dbType: 'postgresql' as const
      }
      const result = setDefaultDbCredentials(input)

      expect(result).toEqual(input)
    })

    it('should default dbType to postgresql if not provided', () => {
      const result = setDefaultDbCredentials({
        host: '',
        port: '',
        user: '',
        password: '',
        database: '',
        dbType: '' as 'postgresql'
      })

      expect(result?.dbType).toBe('postgresql')
    })

    it('should use port 1433 for SQL Server', () => {
      const result = setDefaultDbCredentials({
        host: '',
        port: '',
        user: '',
        password: '',
        database: '',
        dbType: 'sql'
      })

      expect(result?.port).toBe('1433')
    })
  })

  // ── fileExists ──────────────────────────────────────────────

  describe('fileExists', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = join(tmpdir(), `sf-exists-test-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })
    })

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    })

    it('should return true for existing file', async () => {
      const filePath = join(tempDir, 'exists.txt')
      await writeFile(filePath, 'content')
      expect(await fileExists(filePath)).toBe(true)
    })

    it('should return false for non-existing file', async () => {
      expect(await fileExists(join(tempDir, 'nope.txt'))).toBe(false)
    })
  })

  // ── readManifest / writeManifest ────────────────────────────

  describe('readManifest / writeManifest', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = join(tmpdir(), `sf-manifest-test-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })
    })

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    })

    it('should return null when manifest does not exist', async () => {
      const result = await readManifest(tempDir)
      expect(result).toBeNull()
    })

    it('should write and read a manifest', async () => {
      const manifest: Partial<SaaSFoundryManifest> = {
        version: '1.0.0-beta',
        generatedAt: '2026-01-01T00:00:00.000Z',
        structure: 'monorepo',
        projectName: 'test-project',
        modules: {
          emailService: 'none',
          s3Setup: 'manual',
          dbSetup: 'docker',
          includeAnalytics: false,
          advancedSkills: []
        }
      }

      await writeManifest(tempDir, manifest)
      const result = await readManifest(tempDir)

      expect(result).toEqual(manifest)
    })

    it('should merge updates into existing manifest', async () => {
      await writeManifest(tempDir, {
        version: '1.0.0-beta',
        projectName: 'test'
      } as Partial<SaaSFoundryManifest>)

      await writeManifest(tempDir, {
        version: '1.1.0'
      } as Partial<SaaSFoundryManifest>)

      const result = await readManifest(tempDir)
      expect(result?.version).toBe('1.1.0')
      expect(result?.projectName).toBe('test')
    })

    it('should round-trip a manifest with tools.srs populated', async () => {
      const manifest: Partial<SaaSFoundryManifest> = {
        version: '1.0.0-beta',
        generatedAt: '2026-04-19T10:00:00.000Z',
        structure: 'monorepo',
        projectName: 'srs-enabled',
        modules: {
          emailService: 'none',
          s3Setup: 'manual',
          dbSetup: 'docker',
          includeAnalytics: false,
          advancedSkills: []
        },
        tools: {
          srs: {
            enabled: true,
            backend: 'notion',
            rootPage: {
              id: 'abc-123',
              url: 'https://www.notion.so/SaaSFoundry-abc123',
              name: 'SaaSFoundry — Project Overview'
            },
            categories: {
              userFlowsAndSpecifications: {
                id: 'def-456',
                url: 'https://www.notion.so/User-flows-def456',
                name: 'User flows & Specifications'
              }
            }
          }
        }
      }

      await writeManifest(tempDir, manifest)
      const result = await readManifest(tempDir)

      expect(result?.tools?.srs?.enabled).toBe(true)
      expect(result?.tools?.srs?.backend).toBe('notion')
      expect(result?.tools?.srs?.rootPage?.id).toBe('abc-123')
      expect(result?.tools?.srs?.categories?.userFlowsAndSpecifications?.id).toBe('def-456')
    })

    it('should preserve manifests without tools field (backward compat)', async () => {
      const legacyManifest: Partial<SaaSFoundryManifest> = {
        version: '1.0.0-beta',
        generatedAt: '2026-01-01T00:00:00.000Z',
        structure: 'multirepo',
        projectName: 'legacy',
        modules: {
          emailService: 'mailersend',
          s3Setup: 'manual',
          dbSetup: 'docker',
          includeAnalytics: true,
          advancedSkills: ['sf-tool-notion']
        }
      }

      await writeManifest(tempDir, legacyManifest)
      const result = await readManifest(tempDir)

      expect(result).toEqual(legacyManifest)
      expect(result?.tools).toBeUndefined()
    })

    it('should merge tools.srs into an existing tool-less manifest', async () => {
      await writeManifest(tempDir, {
        version: '1.0.0-beta',
        projectName: 'add-srs'
      } as Partial<SaaSFoundryManifest>)

      await writeManifest(tempDir, {
        tools: {
          srs: {
            enabled: true,
            backend: 'notion'
          }
        }
      } as Partial<SaaSFoundryManifest>)

      const result = await readManifest(tempDir)
      expect(result?.projectName).toBe('add-srs')
      expect(result?.tools?.srs?.enabled).toBe(true)
      expect(result?.tools?.srs?.backend).toBe('notion')
    })
  })
})
