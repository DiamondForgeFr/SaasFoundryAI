import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
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

jest.mock('../../../prompts/srs.prompts', () => ({ promptSrsConfiguration: jest.fn() }))
jest.mock('../../../installers/email.installer', () => ({ installEmailModule: jest.fn() }))
jest.mock('../../../installers/storage.installer', () => ({ installStorageModule: jest.fn() }))
jest.mock('../../../installers/analytics.installer', () => ({ installAnalyticsModule: jest.fn() }))
jest.mock('../../../installers/skills.installer', () => ({ installSkills: jest.fn() }))
jest.mock('../../../installers/srs-skill.installer', () => ({ installSrsSkill: jest.fn() }))
jest.mock('../../../runners/srs.runner', () => ({ bootstrapSrs: jest.fn() }))
jest.mock('../../../tools/notion/srs.adapter', () => ({ NotionSrsAdapter: jest.fn() }))
jest.mock('../../../builders/api.builder', () => ({ createApiApp: jest.fn() }))
jest.mock('../../../builders/web.builder', () => ({ createWebApp: jest.fn() }))
jest.mock('../../../builders/monorepo.builder', () => ({ createMonorepoRoot: jest.fn() }))
jest.mock('../../../builders/dev-services.builder', () => ({ createDevServicesCompose: jest.fn() }))

jest.mock('ora', () => () => ({ start: () => ({ text: '', succeed: jest.fn(), fail: jest.fn() }) }))

const recordedRuns: { name: string; manifestVersion: number | undefined }[] = []

// Synthetic installer registry — exercises the dispatcher end-to-end without
// shipping a real module migration (none exist in v2.0.0; the framework is
// what's released). The migration uses `writeMigratedFile` so we also cover
// the conflict-aware writer path through `sf update`.
jest.mock('../../../installers/registry', () => {
  const conflict = jest.requireActual('../../../migrations/module/conflict')
  return {
    moduleInstallers: [
      {
        name: 'email',
        currentVersion: 2,
        migrations: [
          {
            from: 1,
            to: 2,
            name: 'rename-mailersend-config',
            up: async (projectDir: string, manifest: SaaSFoundryManifest) => {
              recordedRuns.push({ name: 'rename-mailersend-config', manifestVersion: manifest.manifestVersion })
              await conflict.writeMigratedFile(projectDir, 'email/config.txt', 'PROVIDER=mailersend\n', manifest)
            }
          }
        ]
      }
    ],
    getModuleInstaller: jest.fn()
  }
})

import { updateCommand } from '../../../commands/update'
import { getModuleSelections } from '../../../prompts/update.prompts'

const mockedGetModuleSelections = getModuleSelections as jest.MockedFunction<typeof getModuleSelections>

describe('updateCommand — module migration dispatch', () => {
  let tempDir: string
  let originalCwd: string
  let logSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance
  let exitSpy: jest.SpyInstance
  let shellSpy: jest.SpyInstance

  const buildManifest = (overrides: Partial<SaaSFoundryManifest> = {}): SaaSFoundryManifest => ({
    version: cliVersion,
    generatedAt: '2026-01-01T00:00:00.000Z',
    structure: 'monorepo',
    projectName: 'mig-int',
    modules: {
      email: { provider: 'mailersend', version: 1 },
      s3Setup: 'manual',
      dbSetup: 'docker',
      includeAnalytics: false,
      advancedSkills: []
    },
    ...overrides
  })

  beforeEach(async () => {
    recordedRuns.length = 0
    tempDir = join(tmpdir(), `sf-int-mod-mig-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    originalCwd = process.cwd()
    await mkdir(tempDir, { recursive: true })
    process.chdir(tempDir)

    jest.clearAllMocks()
    mockedGetModuleSelections.mockResolvedValue([])

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

  it('runs pending email migration, bumps modules.email.version, persists manifest', async () => {
    await writeFile('.saasfoundry.json', JSON.stringify(buildManifest()))

    await updateCommand()

    expect(recordedRuns).toEqual([{ name: 'rename-mailersend-config', manifestVersion: expect.any(Number) }])
    const written = JSON.parse(await readFile('.saasfoundry.json', 'utf8')) as SaaSFoundryManifest
    const email = (written.modules as { email: { provider: string; version: number } }).email
    expect(email.version).toBe(2)
    expect(await readFile(join(tempDir, 'email/config.txt'), 'utf8')).toBe('PROVIDER=mailersend\n')
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Migrated module 'email' v1 → v2"))
  })

  it('is a no-op when modules.email.version already matches the installer currentVersion', async () => {
    const upToDate = buildManifest({
      manifestVersion: 2,
      modules: { email: { provider: 'mailersend', version: 2 }, s3Setup: 'manual', dbSetup: 'docker', includeAnalytics: false, advancedSkills: [] }
    })
    await writeFile('.saasfoundry.json', JSON.stringify(upToDate))

    await updateCommand()

    expect(recordedRuns).toEqual([])
    const written = JSON.parse(await readFile('.saasfoundry.json', 'utf8')) as SaaSFoundryManifest
    const email = (written.modules as { email: { provider: string; version: number } }).email
    expect(email.version).toBe(2)
  })
})
