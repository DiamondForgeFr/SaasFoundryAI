import { mkdir, rm, writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import shelljs from 'shelljs'

import { SaaSFoundryManifest } from '../../../types'
import { version as cliVersion } from '../../../../package.json'

jest.mock('../../../utils', () => ({
  ...jest.requireActual('../../../utils'),
  checkNodeVersion: jest.fn()
}))

jest.mock('../../../prompts/update.prompts', () => ({
  ...jest.requireActual('../../../prompts/update.prompts'),
  getModuleSelections: jest.fn(),
  getEmailModuleCredentials: jest.fn(),
  getStorageModuleConfig: jest.fn(),
  getSkillCredentials: jest.fn()
}))

jest.mock('../../../prompts/srs.prompts', () => ({
  promptSrsConfiguration: jest.fn().mockResolvedValue({
    srsEnable: true,
    srsBackend: 'notion',
    notionApiToken: 'secret_token',
    notionApiVersion: '2022-06-28',
    srsParentPageInput: 'https://notion.so/Parent-123'
  })
}))

jest.mock('../../../installers/email.installer', () => ({ installEmailModule: jest.fn() }))
jest.mock('../../../installers/storage.installer', () => ({ installStorageModule: jest.fn() }))
jest.mock('../../../installers/analytics.installer', () => ({ installAnalyticsModule: jest.fn() }))
jest.mock('../../../installers/skills.installer', () => ({ installSkills: jest.fn() }))
jest.mock('../../../installers/srs-skill.installer', () => ({ installSrsSkill: jest.fn() }))
jest.mock('../../../runners/srs.runner', () => ({
  bootstrapSrs: jest.fn().mockResolvedValue({
    rootPage: { id: 'root-id', url: 'https://notion/root', name: 'Root' }
  })
}))
jest.mock('../../../tools/notion/srs.adapter', () => ({ NotionSrsAdapter: jest.fn() }))
jest.mock('../../../builders/api.builder', () => ({ createApiApp: jest.fn() }))
jest.mock('../../../builders/web.builder', () => ({ createWebApp: jest.fn() }))
jest.mock('../../../builders/monorepo.builder', () => ({ createMonorepoRoot: jest.fn() }))
jest.mock('../../../builders/dev-services.builder', () => ({ createDevServicesCompose: jest.fn() }))

jest.mock('ora', () => () => ({
  start: () => ({ text: '', succeed: jest.fn(), fail: jest.fn() })
}))

import { updateCommand } from '../../../commands/update'
import { getModuleSelections, getEmailModuleCredentials, getStorageModuleConfig, getSkillCredentials } from '../../../prompts/update.prompts'
import { installEmailModule } from '../../../installers/email.installer'
import { installStorageModule } from '../../../installers/storage.installer'
import { installAnalyticsModule } from '../../../installers/analytics.installer'
import { installSkills } from '../../../installers/skills.installer'
import { createDevServicesCompose } from '../../../builders/dev-services.builder'

const mockedGetModuleSelections = getModuleSelections as jest.MockedFunction<typeof getModuleSelections>
const mockedGetEmailCreds = getEmailModuleCredentials as jest.MockedFunction<typeof getEmailModuleCredentials>
const mockedGetStorageConfig = getStorageModuleConfig as jest.MockedFunction<typeof getStorageModuleConfig>
const mockedGetSkillCreds = getSkillCredentials as jest.MockedFunction<typeof getSkillCredentials>
const mockedInstallEmail = installEmailModule as jest.MockedFunction<typeof installEmailModule>
const mockedInstallStorage = installStorageModule as jest.MockedFunction<typeof installStorageModule>
const mockedInstallAnalytics = installAnalyticsModule as jest.MockedFunction<typeof installAnalyticsModule>
const mockedInstallSkills = installSkills as jest.MockedFunction<typeof installSkills>
const mockedCreateDevServices = createDevServicesCompose as jest.MockedFunction<typeof createDevServicesCompose>

describe('updateCommand (integration)', () => {
  let tempDir: string
  let originalCwd: string
  let shellSpy: jest.SpyInstance
  let logSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance
  let exitSpy: jest.SpyInstance

  const buildBaseManifest = (overrides: Partial<SaaSFoundryManifest> = {}): SaaSFoundryManifest => ({
    version: cliVersion,
    generatedAt: '2026-01-01T00:00:00.000Z',
    structure: 'monorepo',
    projectName: 'integration-project',
    modules: {
      emailService: 'none',
      s3Setup: 'manual',
      dbSetup: 'docker',
      includeAnalytics: false,
      advancedSkills: []
    },
    ...overrides
  })

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-int-update-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    originalCwd = process.cwd()
    await mkdir(tempDir, { recursive: true })
    process.chdir(tempDir)

    jest.clearAllMocks()

    shellSpy = jest.spyOn(shelljs, 'exec').mockImplementation((() => ({ code: 0, stdout: '10.0.0', stderr: '' })) as never)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never)
  })

  afterEach(async () => {
    shellSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
    exitSpy.mockRestore()
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  describe('manifest loading', () => {
    it('exits with code 1 when .saasfoundry.json is missing', async () => {
      await expect(updateCommand()).rejects.toThrow('process.exit(1)')
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No .saasfoundry.json found'))
    })
  })

  // Regression guard for #290 — `sf update` is the migration vector that
  // back-fills the JSON Schema URL into manifests scaffolded before #286
  // shipped. The migration must persist on the early-return paths (most users
  // run `sf update` to see "up to date" and bail) and never clobber a
  // user-customized $schema (e.g. someone forking the schema for a private
  // CLI build).
  describe('$schema migration (#290)', () => {
    const SCHEMA_URL = 'https://raw.githubusercontent.com/DiamondForgeFr/SaaSFoundry/master/schemas/saasfoundry-manifest.schema.json'

    it('stamps $schema on a legacy manifest even when the run hits the early-return', async () => {
      mockedGetModuleSelections.mockResolvedValue([])
      const manifest = buildBaseManifest()
      delete (manifest as Partial<SaaSFoundryManifest>).$schema
      await writeFile('.saasfoundry.json', JSON.stringify(manifest))

      await updateCommand()

      const written = JSON.parse(await readFile('.saasfoundry.json', 'utf8')) as SaaSFoundryManifest
      expect(written.$schema).toBe(SCHEMA_URL)
    })

    it('writes $schema as the first field for shape parity with sf new', async () => {
      mockedGetModuleSelections.mockResolvedValue([])
      const manifest = buildBaseManifest()
      delete (manifest as Partial<SaaSFoundryManifest>).$schema
      await writeFile('.saasfoundry.json', JSON.stringify(manifest))

      await updateCommand()

      const written = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
      expect(Object.keys(written)[0]).toBe('$schema')
    })

    it('preserves a user-customized $schema (idempotent)', async () => {
      mockedGetModuleSelections.mockResolvedValue([])
      const customUrl = 'https://internal.example.com/schemas/saasfoundry-manifest.schema.json'
      const manifest = buildBaseManifest({ $schema: customUrl })
      await writeFile('.saasfoundry.json', JSON.stringify(manifest))

      await updateCommand()

      const written = JSON.parse(await readFile('.saasfoundry.json', 'utf8')) as SaaSFoundryManifest
      expect(written.$schema).toBe(customUrl)
    })

    it('does not mutate disk in --dry-run mode', async () => {
      const manifest = buildBaseManifest()
      delete (manifest as Partial<SaaSFoundryManifest>).$schema
      const original = JSON.stringify(manifest)
      await writeFile('.saasfoundry.json', original)

      await updateCommand({ dryRun: true, nonInteractive: true })

      expect(await readFile('.saasfoundry.json', 'utf8')).toBe(original)
    })
  })

  describe('no modules available', () => {
    it('returns early when everything is already installed', async () => {
      const manifest = buildBaseManifest({
        modules: {
          emailService: 'mailersend',
          s3Setup: 'docker',
          dbSetup: 'docker',
          includeAnalytics: true,
          advancedSkills: ['context7', 'atlassian', 'notion', 'figma']
        },
        tools: { srs: { enabled: true, backend: 'notion' } }
      })
      await writeFile('.saasfoundry.json', JSON.stringify(manifest))

      await updateCommand()

      expect(mockedGetModuleSelections).not.toHaveBeenCalled()
      expect(mockedInstallEmail).not.toHaveBeenCalled()
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('up to date'))
    })
  })

  describe('user selects no modules', () => {
    it('returns gracefully when prompt returns empty list', async () => {
      const manifest = buildBaseManifest()
      await writeFile('.saasfoundry.json', JSON.stringify(manifest))

      mockedGetModuleSelections.mockResolvedValue([])

      await updateCommand()

      expect(mockedGetModuleSelections).toHaveBeenCalled()
      expect(mockedInstallEmail).not.toHaveBeenCalled()
      expect(mockedInstallStorage).not.toHaveBeenCalled()
      expect(mockedInstallAnalytics).not.toHaveBeenCalled()
    })
  })

  describe('module installation', () => {
    it('installs email module with provided credentials', async () => {
      const manifest = buildBaseManifest()
      await writeFile('.saasfoundry.json', JSON.stringify(manifest))

      mockedGetModuleSelections.mockResolvedValue(['email'])
      mockedGetEmailCreds.mockResolvedValue({
        mailersendApiKey: 'test-api-key',
        mailersendSenderEmail: 'noreply@test.com',
        mailersendSenderName: 'TestApp'
      })

      await updateCommand()

      expect(mockedInstallEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          apiPath: 'apps/api',
          mailersendApiKey: 'test-api-key',
          mailersendSenderEmail: 'noreply@test.com',
          mailersendSenderName: 'TestApp'
        })
      )

      const saved = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
      expect(saved.modules.emailService).toBe('mailersend')
    })

    it('skips email module when user cancels credentials', async () => {
      const manifest = buildBaseManifest()
      await writeFile('.saasfoundry.json', JSON.stringify(manifest))

      mockedGetModuleSelections.mockResolvedValue(['email'])
      mockedGetEmailCreds.mockResolvedValue(null)

      await updateCommand()

      expect(mockedInstallEmail).not.toHaveBeenCalled()
    })

    it('installs storage module (docker) and adds dev services', async () => {
      const manifest = buildBaseManifest()
      await writeFile('.saasfoundry.json', JSON.stringify(manifest))

      mockedGetModuleSelections.mockResolvedValue(['storage'])
      mockedGetStorageConfig.mockResolvedValue({ s3Setup: 'docker' })

      await updateCommand()

      expect(mockedInstallStorage).toHaveBeenCalledWith(expect.objectContaining({ s3Setup: 'docker', isMonorepo: true, skipNpmInstall: true }))
      expect(mockedCreateDevServices).toHaveBeenCalledWith(expect.objectContaining({ s3Setup: 'docker' }))

      const saved = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
      expect(saved.modules.s3Setup).toBe('docker')
    })

    it('installs storage module (credentials) without dev services', async () => {
      const manifest = buildBaseManifest()
      await writeFile('.saasfoundry.json', JSON.stringify(manifest))

      mockedGetModuleSelections.mockResolvedValue(['storage'])
      mockedGetStorageConfig.mockResolvedValue({
        s3Setup: 'credentials',
        s3Credentials: {
          endpoint: 'https://s3.example.com',
          accessKey: 'ak',
          secretKey: 'sk',
          bucket: 'bucket',
          region: 'eu-west-1'
        }
      })

      await updateCommand()

      expect(mockedInstallStorage).toHaveBeenCalledWith(expect.objectContaining({ s3Setup: 'credentials' }))
      expect(mockedCreateDevServices).not.toHaveBeenCalled()

      const saved = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
      expect(saved.modules.s3Setup).toBe('credentials')
    })

    it('installs analytics module and updates manifest', async () => {
      const manifest = buildBaseManifest()
      await writeFile('.saasfoundry.json', JSON.stringify(manifest))

      mockedGetModuleSelections.mockResolvedValue(['analytics'])

      await updateCommand()

      expect(mockedInstallAnalytics).toHaveBeenCalledWith({ webPath: 'apps/web' })

      const saved = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
      expect(saved.modules.includeAnalytics).toBe(true)
    })

    it('installs a single skill and merges with existing skills in the manifest', async () => {
      const manifest = buildBaseManifest({
        modules: {
          emailService: 'none',
          s3Setup: 'manual',
          dbSetup: 'docker',
          includeAnalytics: false,
          advancedSkills: ['context7']
        }
      })
      await writeFile('.saasfoundry.json', JSON.stringify(manifest))

      mockedGetModuleSelections.mockResolvedValue(['sf-skill-notion'])
      mockedGetSkillCreds.mockResolvedValue({ notionApiToken: 'notion-token' })

      await updateCommand()

      expect(mockedInstallSkills).toHaveBeenCalledWith(
        expect.objectContaining({
          advancedSkills: ['context7', 'notion'],
          notionApiToken: 'notion-token'
        })
      )

      const saved = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
      expect(saved.modules.advancedSkills).toEqual(['context7', 'notion'])
    })

    it('installs multiple modules at once (email + analytics + skill)', async () => {
      const manifest = buildBaseManifest()
      await writeFile('.saasfoundry.json', JSON.stringify(manifest))

      mockedGetModuleSelections.mockResolvedValue(['email', 'analytics', 'sf-skill-context7'])
      mockedGetEmailCreds.mockResolvedValue({
        mailersendApiKey: 'k',
        mailersendSenderEmail: 'a@b.c',
        mailersendSenderName: 'X'
      })
      mockedGetSkillCreds.mockResolvedValue({})

      await updateCommand()

      expect(mockedInstallEmail).toHaveBeenCalled()
      expect(mockedInstallAnalytics).toHaveBeenCalled()
      expect(mockedInstallSkills).toHaveBeenCalledWith(expect.objectContaining({ advancedSkills: ['context7'] }))
    })

    it('resolves app paths correctly for multirepo projects', async () => {
      const manifest = buildBaseManifest({ structure: 'multirepo', projectName: 'multi-proj' })
      await writeFile('.saasfoundry.json', JSON.stringify(manifest))

      mockedGetModuleSelections.mockResolvedValue(['analytics'])

      await updateCommand()

      expect(mockedInstallAnalytics).toHaveBeenCalledWith({ webPath: 'apps/multi-proj-web' })
    })

    it('runs npm install once when new dependencies are added', async () => {
      const manifest = buildBaseManifest()
      await writeFile('.saasfoundry.json', JSON.stringify(manifest))

      mockedGetModuleSelections.mockResolvedValue(['email'])
      mockedGetEmailCreds.mockResolvedValue({
        mailersendApiKey: 'k',
        mailersendSenderEmail: 'a@b.c',
        mailersendSenderName: 'X'
      })

      await updateCommand()

      const npmInstallCalls = shellSpy.mock.calls.filter((c) => String(c[0]).includes('npm install'))
      expect(npmInstallCalls).toHaveLength(1)
    })

    it('skips npm install when only analytics is selected', async () => {
      const manifest = buildBaseManifest()
      await writeFile('.saasfoundry.json', JSON.stringify(manifest))

      mockedGetModuleSelections.mockResolvedValue(['analytics'])

      await updateCommand()

      const npmInstallCalls = shellSpy.mock.calls.filter((c) => String(c[0]).includes('npm install'))
      expect(npmInstallCalls).toHaveLength(0)
    })

    it('exits with code 1 when installer throws', async () => {
      const manifest = buildBaseManifest()
      await writeFile('.saasfoundry.json', JSON.stringify(manifest))

      mockedGetModuleSelections.mockResolvedValue(['analytics'])
      mockedInstallAnalytics.mockRejectedValueOnce(new Error('install blew up'))

      await expect(updateCommand()).rejects.toThrow('process.exit(1)')
      expect(errorSpy).toHaveBeenCalled()
    })
  })

  describe('version mismatch branch', () => {
    it('warns and skips template update when fileHashes is missing', async () => {
      const manifest = buildBaseManifest({ version: '1.0.0-alpha' })
      await writeFile('.saasfoundry.json', JSON.stringify(manifest))

      mockedGetModuleSelections.mockResolvedValue([])

      await updateCommand()

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('before hash tracking'))
    })

    it('reports no template changes when target hashes match manifest', async () => {
      const manifest = buildBaseManifest({
        version: '1.0.0-alpha',
        fileHashes: { 'some/file.ts': 'deadbeef' }
      })
      await writeFile('.saasfoundry.json', JSON.stringify(manifest))

      mockedGetModuleSelections.mockResolvedValue([])

      await updateCommand()

      const infoMsgs = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(infoMsgs).toMatch(/Version change detected/i)
    })
  })

  describe('cli-structure manifest (dogfooding)', () => {
    const buildCliManifest = (): SaaSFoundryManifest => ({
      version: cliVersion,
      generatedAt: '2026-01-01T00:00:00.000Z',
      structure: 'cli',
      projectName: 'saasfoundry-cli'
    })

    it('enables SRS without writing fileHashes when manifest has no modules block', async () => {
      const manifest = buildCliManifest()
      await writeFile('.saasfoundry.json', JSON.stringify(manifest, null, 2))

      mockedGetModuleSelections.mockResolvedValue(['srs'])

      await updateCommand()

      const saved = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
      expect(saved.tools?.srs?.enabled).toBe(true)
      expect(saved.tools?.srs?.backend).toBe('notion')
      expect(saved.modules).toBeUndefined()
      expect(saved.fileHashes).toBeUndefined()
    })
  })
})
