import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import inquirer from 'inquirer'
import shelljs from 'shelljs'

import { SaaSFoundryManifest } from '../../../types'
import { version as cliVersion } from '../../../../package.json'

jest.mock('inquirer')

jest.mock('../../../utils', () => ({
  ...jest.requireActual('../../../utils'),
  checkNodeVersion: jest.fn()
}))

jest.mock('../../../installers/email.installer', () => ({ installEmailModule: jest.fn() }))
jest.mock('../../../installers/storage.installer', () => ({ installStorageModule: jest.fn() }))
jest.mock('../../../installers/analytics.installer', () => ({ installAnalyticsModule: jest.fn() }))
jest.mock('../../../installers/skills.installer', () => ({ installSkills: jest.fn() }))
jest.mock('../../../builders/dev-services.builder', () => ({ createDevServicesCompose: jest.fn() }))

jest.mock('ora', () => () => ({
  start: () => ({ text: '', succeed: jest.fn(), fail: jest.fn(), stop: jest.fn() }),
  stop: jest.fn()
}))

import { updateCommand } from '../../../commands/update'
import { installEmailModule } from '../../../installers/email.installer'
import { installStorageModule } from '../../../installers/storage.installer'
import { installAnalyticsModule } from '../../../installers/analytics.installer'
import { installSkills } from '../../../installers/skills.installer'
import { createDevServicesCompose } from '../../../builders/dev-services.builder'

const mockedPrompt = inquirer.prompt as unknown as jest.Mock
const mockedInstallEmail = installEmailModule as jest.MockedFunction<typeof installEmailModule>
const mockedInstallStorage = installStorageModule as jest.MockedFunction<typeof installStorageModule>
const mockedInstallAnalytics = installAnalyticsModule as jest.MockedFunction<typeof installAnalyticsModule>
const mockedInstallSkills = installSkills as jest.MockedFunction<typeof installSkills>
const mockedCreateDevServices = createDevServicesCompose as jest.MockedFunction<typeof createDevServicesCompose>

const baseManifest = (overrides: Partial<SaaSFoundryManifest> = {}): SaaSFoundryManifest => ({
  version: cliVersion,
  generatedAt: '2026-01-01T00:00:00.000Z',
  structure: 'monorepo',
  projectName: 'acme',
  modules: {
    emailService: 'none',
    s3Setup: 'manual',
    dbSetup: 'docker',
    includeAnalytics: false,
    advancedSkills: []
  },
  ...overrides
})

describe('updateCommand (non-interactive integration)', () => {
  let tempDir: string
  let originalCwd: string
  let shellSpy: jest.SpyInstance
  let logSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance
  let exitSpy: jest.SpyInstance

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-int-update-nit-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    originalCwd = process.cwd()
    await mkdir(tempDir, { recursive: true })
    process.chdir(tempDir)

    jest.clearAllMocks()

    // Inquirer's native prefill contract: when called with (questions, prefill),
    // resolved answers are the prefill object as-is when every applicable question is prefilled.
    mockedPrompt.mockImplementation(((_questions: unknown, answers: Record<string, unknown>) => Promise.resolve(answers ?? {})) as never)

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

  it('installs the email module end-to-end from flags alone', async () => {
    await writeFile('.saasfoundry.json', JSON.stringify(baseManifest()))

    await updateCommand({
      nonInteractive: true,
      addModules: 'email',
      mailersendApiKey: 'ms-key',
      mailersendSenderEmail: 'hello@acme.com',
      mailersendSenderName: 'Acme'
    })

    expect(mockedInstallEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        apiPath: 'apps/api',
        mailersendApiKey: 'ms-key',
        mailersendSenderEmail: 'hello@acme.com',
        mailersendSenderName: 'Acme'
      })
    )

    const saved = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    expect(saved.modules.emailService).toBe('mailersend')
  })

  it('propagates storage flags (credentials) to the storage installer', async () => {
    await writeFile('.saasfoundry.json', JSON.stringify(baseManifest()))

    await updateCommand({
      nonInteractive: true,
      addModules: 'storage',
      s3Setup: 'credentials',
      s3Endpoint: 'https://s3.example.com',
      s3AccessKey: 'AKIA',
      s3SecretKey: 'SECRET',
      s3Bucket: 'acme-uploads',
      s3Region: 'eu-west-1'
    })

    expect(mockedInstallStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        s3Setup: 'credentials',
        s3Credentials: {
          endpoint: 'https://s3.example.com',
          accessKey: 'AKIA',
          secretKey: 'SECRET',
          bucket: 'acme-uploads',
          region: 'eu-west-1'
        }
      })
    )
    expect(mockedCreateDevServices).not.toHaveBeenCalled()
  })

  it('installs analytics and a free skill (context7) without credential prompts', async () => {
    await writeFile('.saasfoundry.json', JSON.stringify(baseManifest()))

    await updateCommand({
      nonInteractive: true,
      addModules: 'analytics,sf-skill-context7'
    })

    expect(mockedInstallAnalytics).toHaveBeenCalledWith({ webPath: 'apps/web' })
    expect(mockedInstallSkills).toHaveBeenCalledWith(expect.objectContaining({ advancedSkills: ['context7'] }))
  })

  it('--dry-run skips every installer and emits a JSON report on stdout', async () => {
    await writeFile('.saasfoundry.json', JSON.stringify(baseManifest()))

    await updateCommand({
      nonInteractive: true,
      dryRun: true,
      addModules: 'email,analytics',
      mailersendApiKey: 'k',
      mailersendSenderEmail: 'a@b.c',
      mailersendSenderName: 'X'
    })

    // No side effects in dry-run.
    expect(mockedInstallEmail).not.toHaveBeenCalled()
    expect(mockedInstallAnalytics).not.toHaveBeenCalled()
    const npmInstallCalls = shellSpy.mock.calls.filter((c) => String(c[0]).includes('npm install'))
    expect(npmInstallCalls).toHaveLength(0)

    // Manifest remains unchanged (emailService stays 'none').
    const saved = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    expect(saved.modules.emailService).toBe('none')

    // Report is emitted between the sentinel markers so callers can parse it.
    const combined = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(combined).toContain('<sf-update-dry-run-report>')
    expect(combined).toContain('</sf-update-dry-run-report>')

    const match = combined.match(/<sf-update-dry-run-report>\n([\s\S]*?)\n<\/sf-update-dry-run-report>/)
    expect(match).not.toBeNull()
    const report = JSON.parse(match![1])
    expect(report.cliVersion).toBe(cliVersion)
    expect(report.conflictStrategy).toBe('save-new')
    expect(report.moduleAddition.selected).toEqual(['email', 'analytics'])
    expect(report.moduleAddition.email).toEqual({ configured: true })
    expect(report.moduleAddition.wouldRunNpmInstall).toBe(true)
  })

  it('throws a missing-required error when email creds are omitted in non-interactive mode', async () => {
    await writeFile('.saasfoundry.json', JSON.stringify(baseManifest()))

    await expect(
      updateCommand({
        nonInteractive: true,
        addModules: 'email'
        // mailersend* flags intentionally missing
      })
    ).rejects.toThrow(/Missing required values in --non-interactive mode/)

    expect(mockedInstallEmail).not.toHaveBeenCalled()
  })

  it('suppresses the MailerSend 4s delay and affiliate log in non-interactive mode', async () => {
    await writeFile('.saasfoundry.json', JSON.stringify(baseManifest()))

    const setTimeoutSpy = jest.spyOn(global, 'setTimeout')

    await updateCommand({
      nonInteractive: true,
      addModules: 'email',
      mailersendApiKey: 'k',
      mailersendSenderEmail: 'a@b.c',
      mailersendSenderName: 'X'
    })

    // The 4s signup-redirect delay must be skipped.
    const fourSecondWaits = setTimeoutSpy.mock.calls.filter((c) => c[1] === 4000)
    expect(fourSecondWaits).toHaveLength(0)

    // None of the affiliate promo log lines should be emitted.
    const combined = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(combined).not.toMatch(/mailersend\.com/i)
    expect(combined).not.toMatch(/affiliate link/i)

    // And no `open`/`xdg-open`/`start` invocation to open the signup page.
    const browserOpens = shellSpy.mock.calls.filter((c) => /mailersend\.com/.test(String(c[0])))
    expect(browserOpens).toHaveLength(0)

    setTimeoutSpy.mockRestore()
  })

  it('rejects unknown --conflict-strategy values before reading the manifest', async () => {
    // No manifest present — but parseConflictStrategy runs first, so the error path is the strategy check.
    await expect(updateCommand({ conflictStrategy: 'skip' })).rejects.toThrow(/Invalid --conflict-strategy "skip"/)
  })

  it('passes the chosen conflict strategy into the dry-run report', async () => {
    await writeFile('.saasfoundry.json', JSON.stringify(baseManifest()))

    await updateCommand({
      nonInteractive: true,
      dryRun: true,
      conflictStrategy: 'replace',
      addModules: 'analytics'
    })

    const combined = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    const match = combined.match(/<sf-update-dry-run-report>\n([\s\S]*?)\n<\/sf-update-dry-run-report>/)
    expect(match).not.toBeNull()
    const report = JSON.parse(match![1])
    expect(report.conflictStrategy).toBe('replace')
  })

  it('skips an already-installed module requested via --add-modules without re-installing', async () => {
    const manifest = baseManifest({
      modules: {
        emailService: 'none',
        s3Setup: 'manual',
        dbSetup: 'docker',
        includeAnalytics: true,
        advancedSkills: []
      }
    })
    await writeFile('.saasfoundry.json', JSON.stringify(manifest))

    await updateCommand({
      nonInteractive: true,
      addModules: 'analytics'
    })

    const combined = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(combined).toMatch(/'analytics' is already installed/)
    expect(combined).toMatch(/All requested modules are already installed/)
    expect(mockedInstallAnalytics).not.toHaveBeenCalled()
  })

  it('skips installed modules but proceeds with the installable ones in the same --add-modules', async () => {
    const manifest = baseManifest({
      modules: {
        emailService: 'none',
        s3Setup: 'manual',
        dbSetup: 'docker',
        includeAnalytics: true,
        advancedSkills: []
      }
    })
    await writeFile('.saasfoundry.json', JSON.stringify(manifest))

    await updateCommand({
      nonInteractive: true,
      addModules: 'analytics,email',
      mailersendApiKey: 'ms-key',
      mailersendSenderEmail: 'hello@acme.com',
      mailersendSenderName: 'Acme'
    })

    const combined = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(combined).toMatch(/'analytics' is already installed/)
    expect(mockedInstallAnalytics).not.toHaveBeenCalled()
    expect(mockedInstallEmail).toHaveBeenCalled()
  })
})
