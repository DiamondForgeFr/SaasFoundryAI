import { mkdir, readFile, readdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import inquirer from 'inquirer'

jest.mock('inquirer')

jest.mock('../../../utils', () => ({
  ...jest.requireActual('../../../utils'),
  checkNodeVersion: jest.fn(),
  computeFileHashes: jest.fn().mockResolvedValue({})
}))

jest.mock('../../../builders/api.builder', () => ({ createApiApp: jest.fn() }))
jest.mock('../../../builders/web.builder', () => ({ createWebApp: jest.fn() }))
jest.mock('../../../builders/monorepo.builder', () => ({ createMonorepoRoot: jest.fn() }))
jest.mock('../../../builders/dev-services.builder', () => ({ createDevServicesCompose: jest.fn() }))
jest.mock('../../../installers/skills.installer', () => ({ ...jest.requireActual('../../../installers/skills.installer'), installSkills: jest.fn() }))

jest.mock('../../../runners/database.runner', () => ({ initAndStartDb: jest.fn() }))
jest.mock('../../../runners/s3.runner', () => ({ initAndStartS3: jest.fn() }))
jest.mock('../../../runners/server.runner', () => ({
  startBackend: jest.fn(),
  startFrontend: jest.fn(),
  startMonorepoApps: jest.fn(),
  waitForServer: jest.fn()
}))
jest.mock('../../../runners/terminal.runner', () => ({
  openTerminal: jest.fn(),
  getHuskySetupCommand: jest.fn().mockReturnValue('')
}))

jest.mock('ora', () => () => ({
  start: () => ({ text: '', succeed: jest.fn(), fail: jest.fn() })
}))

jest.mock('terminal-link', () => ({
  __esModule: true,
  default: (text: string) => text
}))

import { newCommand } from '../../../commands/new'
import { createApiApp } from '../../../builders/api.builder'
import { createWebApp } from '../../../builders/web.builder'

const mockedPrompt = inquirer.prompt as unknown as jest.Mock
const mockedCreateApiApp = createApiApp as jest.MockedFunction<typeof createApiApp>
const mockedCreateWebApp = createWebApp as jest.MockedFunction<typeof createWebApp>

describe('newCommand (--profile integration)', () => {
  let tempDir: string
  let originalCwd: string
  let logSpy: jest.SpyInstance

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-int-profile-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    originalCwd = process.cwd()
    await mkdir(tempDir, { recursive: true })
    process.chdir(tempDir)

    jest.clearAllMocks()
    mockedPrompt.mockImplementation(((_questions: unknown, answers: Record<string, unknown>) => Promise.resolve(answers ?? {})) as never)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(async () => {
    logSpy.mockRestore()
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  const stackOpts = {
    nonInteractive: true,
    profile: 'stack' as const,
    projectName: 'acme',
    projectDescription: 'd',
    structure: 'multirepo' as const,
    mainBranch: 'main' as const,
    setupRepo: 'local' as const,
    dbSetup: 'manual' as const,
    s3Setup: 'manual' as const,
    emailService: 'none' as const,
    analytics: false
  }

  it('stack profile scaffolds the stack with no workflow, skills or SRS in the manifest', async () => {
    await newCommand(stackOpts)

    expect(mockedCreateApiApp).toHaveBeenCalledTimes(1)
    expect(mockedCreateWebApp).toHaveBeenCalledTimes(1)
    const apiParams = mockedCreateApiApp.mock.calls[0][0]
    expect(apiParams.workflow).toBeUndefined()
    expect(apiParams.advancedSkills ?? []).toEqual([])

    const manifest = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    expect(manifest.workflow).toBeUndefined()
    expect(manifest.tools).toBeUndefined()
    expect(manifest.modules.advancedSkills).toEqual([])
  })

  it('stack profile never asks workflow/skills/SRS questions', async () => {
    await newCommand(stackOpts)

    const askedNames = mockedPrompt.mock.calls.flatMap((call) => (call[0] as { name: string }[]).map((q) => q.name))
    expect(askedNames).not.toContain('srsEnable')
    expect(askedNames).not.toContain('configureWorkflow')
  })

  it('harness profile stops cleanly before any filesystem mutation', async () => {
    await expect(
      newCommand({
        nonInteractive: true,
        profile: 'harness',
        projectName: 'acme',
        mainBranch: 'main',
        workflow: 'none'
      })
    ).rejects.toThrow(/harness profile is not executable yet/)

    expect(mockedCreateApiApp).not.toHaveBeenCalled()
    expect(mockedCreateWebApp).not.toHaveBeenCalled()
    expect(await readdir(tempDir)).toEqual([])
  })

  it('defaults to the full profile in non-interactive mode without --profile (regression guard)', async () => {
    await newCommand({ ...stackOpts, profile: undefined })

    expect(mockedCreateApiApp).toHaveBeenCalledTimes(1)
    const manifest = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    expect(manifest.projectName).toBe('acme')
  })
})
