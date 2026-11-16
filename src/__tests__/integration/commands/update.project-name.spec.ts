import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import inquirer from 'inquirer'

import { SaaSFoundryManifest, manifestSchemaUrl } from '../../../types'
import { version as cliVersion } from '../../../../package.json'

jest.mock('inquirer')

jest.mock('../../../utils', () => ({
  ...jest.requireActual('../../../utils'),
  checkNodeVersion: jest.fn()
}))

jest.mock('../../../prompts/update.prompts', () => ({
  ...jest.requireActual('../../../prompts/update.prompts'),
  getModuleSelections: jest.fn().mockResolvedValue([]),
  getEmailModuleCredentials: jest.fn(),
  getStorageModuleConfig: jest.fn(),
  getSkillCredentials: jest.fn()
}))

jest.mock('ora', () => () => {
  const spinner: Record<string, unknown> = { text: '', succeed: jest.fn(), fail: jest.fn(), stop: jest.fn() }
  spinner.start = jest.fn(() => spinner)
  return spinner
})

import { updateCommand } from '../../../commands/update'
import { computeHarnessFileHashes, harnessInstallerMeta, installHarness } from '../../../installers/harness.installer'

const mockedPrompt = inquirer.prompt as unknown as jest.Mock

const FRESH_VERSION = '0.9.0-test'

/**
 * #966: `sf update` re-validated the manifest's `projectName` with the rule `sf new` applies to
 * a new name (lowercase, digits, hyphens), so a harness adopted as `Notulia` could not be updated
 * at all. An existing harness keeps its name; only the technical stack needs a slug.
 */
describe('updateCommand — the projectName of an existing manifest (#966)', () => {
  let projectDir: string
  let originalCwd: string
  let originalExitCode: typeof process.exitCode

  const manifestPath = () => join(projectDir, '.saasfoundry.json')

  const harnessManifest = (projectName: string, overrides: Partial<SaaSFoundryManifest> = {}): SaaSFoundryManifest => ({
    $schema: manifestSchemaUrl,
    manifestVersion: 2,
    version: FRESH_VERSION,
    generatedAt: '2026-01-01T00:00:00.000Z',
    structure: 'cli',
    projectName,
    mainBranch: 'main',
    workflow: { tool: 'none' },
    modules: { harness: { version: harnessInstallerMeta.currentVersion, managed: true } },
    ...overrides
  })

  /** A real harness deposit and its baseline, as `sf new --profile harness` leaves them. */
  const writeHarnessProject = async (projectName: string, overrides: Partial<SaaSFoundryManifest> = {}): Promise<Buffer> => {
    await installHarness({ targetPath: projectDir, projectName, version: FRESH_VERSION })
    const fileHashes = await computeHarnessFileHashes(projectDir)
    const bytes = Buffer.from(JSON.stringify(harnessManifest(projectName, { fileHashes, ...overrides }), null, 2))
    await writeFile(manifestPath(), bytes)
    return bytes
  }

  const captureStdout = (): string[] => {
    const chunks: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      chunks.push(String(chunk))
      return true
    }) as typeof process.stdout.write)
    return chunks
  }

  beforeEach(async () => {
    projectDir = join(tmpdir(), `sf-project-name-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    originalCwd = process.cwd()
    originalExitCode = process.exitCode
    await mkdir(projectDir, { recursive: true })
    process.chdir(projectDir)

    jest.clearAllMocks()
    mockedPrompt.mockImplementation(((_q: unknown, answers: Record<string, unknown>) => Promise.resolve({ ...(answers ?? {}) })) as never)
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    process.exitCode = originalExitCode
    process.chdir(originalCwd)
    jest.restoreAllMocks()
    await rm(projectDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })

  it.each(['SaaSFoundryAI', 'DiamondForge'])('updates a harness named %s and keeps its name', async (projectName) => {
    await writeHarnessProject(projectName)

    await updateCommand({ nonInteractive: true })

    const manifest = JSON.parse(await readFile(manifestPath(), 'utf8')) as SaaSFoundryManifest
    expect(manifest.projectName).toBe(projectName)
    expect(manifest.version).toBe(cliVersion)
    expect(process.exitCode).not.toBe(1)
  })

  it('previews the update of a mixed-case harness as JSON without changing it', async () => {
    const before = await writeHarnessProject('Notulia')
    const chunks = captureStdout()

    await updateCommand({ dryRun: true, json: true, nonInteractive: true })

    const report = JSON.parse(chunks.join(''))
    expect(report).toMatchObject({ version: 1, mutated: false, cliVersion, projectVersion: FRESH_VERSION })
    expect(await readFile(manifestPath())).toEqual(before)
    expect(process.exitCode).not.toBe(1)
  })

  it.each(['../escape', 'my project', '-Flag', '.hidden', ''])('still refuses the unsafe name %p', async (projectName) => {
    await writeFile(manifestPath(), JSON.stringify(harnessManifest(projectName), null, 2))

    await expect(updateCommand({ nonInteractive: true })).rejects.toThrow(/Invalid projectName .* in \.saasfoundry\.json/)
  })

  it('keeps the slug rule for a project with a technical stack', async () => {
    const stack = harnessManifest('MyApp', {
      structure: 'monorepo',
      workflow: undefined,
      modules: {
        harness: { version: 1, managed: false },
        email: { provider: 'none', version: 1 },
        s3Setup: 'manual',
        dbSetup: 'manual',
        includeAnalytics: false,
        advancedSkills: []
      }
    })
    await writeFile(manifestPath(), JSON.stringify(stack, null, 2))

    await expect(updateCommand({ nonInteractive: true })).rejects.toThrow('Invalid project name "MyApp": can only contain lowercase letters, numbers, and hyphens')
  })

  it('blocks adding a technical stack to a mixed-case harness, naming the reason, without changing it', async () => {
    const before = await writeHarnessProject('Notulia', { modules: { harness: { version: harnessInstallerMeta.currentVersion, managed: true }, advancedSkills: [] } })
    const chunks = captureStdout()

    await updateCommand({
      targetProfile: 'full',
      dryRun: true,
      json: true,
      structure: 'monorepo',
      dbSetup: 'manual',
      emailService: 'none',
      s3Setup: 'manual',
      analytics: false,
      pwa: false
    })

    expect(JSON.parse(chunks.join(''))).toMatchObject({
      mutated: false,
      profileTransition: { status: 'blocked', reasonCode: 'project-name-not-a-slug' }
    })
    expect(process.exitCode).toBe(1)
    expect(await readFile(manifestPath())).toEqual(before)
  })
})
