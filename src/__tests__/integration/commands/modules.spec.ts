import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { modulesCommand } from '../../../commands/modules'
import { SaaSFoundryManifest } from '../../../types'
import { version as cliVersion } from '../../../../package.json'

describe('modulesCommand (integration)', () => {
  let tempDir: string
  let originalCwd: string
  let logSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance
  let exitSpy: jest.SpyInstance

  const buildManifest = (overrides: Partial<SaaSFoundryManifest['modules']> = {}): SaaSFoundryManifest => ({
    version: cliVersion,
    generatedAt: '2026-01-01T00:00:00.000Z',
    structure: 'monorepo',
    projectName: 'modules-integration',
    modules: {
      emailService: 'none',
      s3Setup: 'manual',
      dbSetup: 'docker',
      includeAnalytics: false,
      advancedSkills: [],
      ...overrides
    }
  })

  const writeManifest = async (manifest: SaaSFoundryManifest) => {
    await writeFile('.saasfoundry.json', JSON.stringify(manifest, null, 2))
  }

  const getAllLogOutput = () => logSpy.mock.calls.map((call) => call.join(' ')).join('\n')
  const getJsonOutput = () => JSON.parse(logSpy.mock.calls.map((call) => call.join(' ')).join('\n'))

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-int-modules-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    originalCwd = process.cwd()
    await mkdir(tempDir, { recursive: true })
    process.chdir(tempDir)

    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true, force: true })
    logSpy.mockRestore()
    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  describe('list', () => {
    it('should print the catalogue in human mode', async () => {
      await modulesCommand('list')
      const output = getAllLogOutput()
      expect(output).toContain('SaaSFoundry Module Catalogue')
      expect(output).toContain('email')
      expect(output).toContain('storage')
      expect(output).toContain('analytics')
      expect(output).toContain('Advanced Skills')
      expect(output).toContain('Structural')
    })

    it('should include cliVersion and all modules in --json mode', async () => {
      await modulesCommand('list', '--json')
      const payload = getJsonOutput()
      expect(payload.cliVersion).toBe(cliVersion)
      expect(Array.isArray(payload.modules)).toBe(true)
      expect(payload.modules.length).toBeGreaterThanOrEqual(7)
      for (const entry of payload.modules) {
        expect(entry).toHaveProperty('name')
        expect(entry).toHaveProperty('installed')
        expect(typeof entry.installed).toBe('boolean')
      }
    })

    it('should mark email as installed when manifest has mailersend', async () => {
      await writeManifest(buildManifest({ emailService: 'mailersend' }))
      await modulesCommand('list', '--json')
      const payload = getJsonOutput()
      const email = payload.modules.find((m: { name: string }) => m.name === 'email')
      expect(email.installed).toBe(true)
    })

    it('should mark storage as installed when s3Setup is docker', async () => {
      await writeManifest(buildManifest({ s3Setup: 'docker' }))
      await modulesCommand('list', '--json')
      const payload = getJsonOutput()
      const storage = payload.modules.find((m: { name: string }) => m.name === 'storage')
      expect(storage.installed).toBe(true)
    })

    it('should mark advanced skill as installed when listed in advancedSkills', async () => {
      await writeManifest(buildManifest({ advancedSkills: ['notion'] }))
      await modulesCommand('list', '--json')
      const payload = getJsonOutput()
      const skill = payload.modules.find((m: { name: string }) => m.name === 'sf-skill-notion')
      expect(skill.installed).toBe(true)
    })

    it('should default installed to false with no manifest', async () => {
      await modulesCommand('list', '--json')
      const payload = getJsonOutput()
      const email = payload.modules.find((m: { name: string }) => m.name === 'email')
      expect(email.installed).toBe(false)
    })

    it('should mark structural modules as installed when manifest present', async () => {
      await writeManifest(buildManifest())
      await modulesCommand('list', '--json')
      const payload = getJsonOutput()
      const auth = payload.modules.find((m: { name: string }) => m.name === 'auth')
      expect(auth.installed).toBe(true)
    })
  })

  describe('info', () => {
    it('should print module detail in human mode', async () => {
      await modulesCommand('info', 'email')
      const output = getAllLogOutput()
      expect(output).toContain('MailerSend Email Service')
      expect(output).toContain('Keywords:')
      expect(output).toContain('Provides:')
      expect(output).toContain('Alternatives:')
    })

    it('should return a single module in --json mode', async () => {
      await modulesCommand('info', 'storage', '--json')
      const payload = getJsonOutput()
      expect(payload.cliVersion).toBe(cliVersion)
      expect(payload.module.name).toBe('storage')
      expect(payload.module).toHaveProperty('installed')
    })

    it('should exit with error when module is unknown', async () => {
      await expect(modulesCommand('info', 'nope')).rejects.toThrow('process.exit(1)')
      const errorOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n')
      expect(errorOutput).toContain('Module "nope" not found')
    })

    it('should exit when name is missing', async () => {
      await expect(modulesCommand('info')).rejects.toThrow('process.exit(1)')
    })
  })

  describe('match', () => {
    it('should rank email first for a transactional email intent (--json)', async () => {
      await modulesCommand('match', 'transactional emails', '--json')
      const payload = getJsonOutput()
      expect(payload.intent).toBe('transactional emails')
      expect(payload.results[0].name).toBe('email')
      expect(payload.results[0].score).toBeGreaterThan(0)
      expect(Array.isArray(payload.results[0].reasons)).toBe(true)
    })

    it('should rank storage first for an upload/S3 intent', async () => {
      await modulesCommand('match', 'file uploads to s3', '--json')
      const payload = getJsonOutput()
      expect(payload.results[0].name).toBe('storage')
    })

    it('should rank atlassian first for a jira intent', async () => {
      await modulesCommand('match', 'jira tickets', '--json')
      const payload = getJsonOutput()
      expect(payload.results[0].name).toBe('sf-skill-atlassian')
    })

    it('should return empty results for unrelated intent', async () => {
      await modulesCommand('match', 'xyzzy foobarbaz', '--json')
      const payload = getJsonOutput()
      expect(payload.results).toEqual([])
    })

    it('should exit when intent is missing', async () => {
      await expect(modulesCommand('match')).rejects.toThrow('process.exit(1)')
    })

    it('should print top 3 in human mode', async () => {
      await modulesCommand('match', 'analytics tracking')
      const output = getAllLogOutput()
      expect(output).toContain('Modules matching:')
      expect(output).toContain('Umami Analytics')
    })
  })

  describe('dispatch', () => {
    it('should show help when no subcommand is given', async () => {
      await modulesCommand()
      const output = getAllLogOutput()
      expect(output).toContain('SaaSFoundry Modules')
      expect(output).toContain('Usage:')
    })

    it('should exit on unknown subcommand', async () => {
      await expect(modulesCommand('bogus')).rejects.toThrow('process.exit(1)')
      const errorOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n')
      expect(errorOutput).toContain('Unknown subcommand: bogus')
    })
  })
})
