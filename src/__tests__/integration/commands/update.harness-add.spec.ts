import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { SaaSFoundryManifest, manifestSchemaUrl } from '../../../types'
import { version as cliVersion } from '../../../../package.json'

jest.mock('../../../utils', () => ({
  ...jest.requireActual('../../../utils'),
  checkNodeVersion: jest.fn()
}))

jest.mock('../../../config-engine/session', () => ({
  runConfigSession: jest.fn()
}))

jest.mock('ora', () => () => {
  const spinner: Record<string, unknown> = { text: '', succeed: jest.fn(), fail: jest.fn(), stop: jest.fn() }
  spinner.start = jest.fn(() => spinner)
  return spinner
})

import { updateCommand } from '../../../commands/update'
import { runConfigSession } from '../../../config-engine/session'

const mockedRunConfigSession = runConfigSession as jest.MockedFunction<typeof runConfigSession>

const WORKFLOW = {
  tool: 'github-projects' as const,
  template: 'SaaSFoundry Solo',
  workingBranch: 'main',
  statuses: [{ name: 'Backlog' as const }, { name: 'In Progress' as const }, { name: 'AI Testing' as const }, { name: 'In Review' as const }, { name: 'Done' as const }]
}

// #451 AC2: a stack-only project (scaffolded without the AI harness) adds it
// later through sf update — workflow collected via the config-engine steps,
// deposits installed and version+hash tracked.
describe('updateCommand — late harness install (--add-modules harness)', () => {
  let projectDir: string
  let originalCwd: string
  let originalExitCode: typeof process.exitCode
  let logSpy: jest.SpyInstance

  const stackManifest = (): SaaSFoundryManifest => ({
    $schema: manifestSchemaUrl,
    manifestVersion: 2,
    version: cliVersion,
    generatedAt: new Date().toISOString(),
    structure: 'multirepo',
    projectName: 'acme',
    mainBranch: 'main',
    // Current `sf new --profile stack` output: common/core harness deposits
    // are versioned but the collaboration harness is explicitly not managed.
    modules: { email: { provider: 'none', version: 1 }, s3Setup: 'manual', dbSetup: 'manual', includeAnalytics: false, advancedSkills: [], harness: { version: 1, managed: false } },
    fileHashes: {}
  })

  beforeEach(async () => {
    projectDir = join(tmpdir(), `sf-harness-add-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    originalCwd = process.cwd()
    originalExitCode = process.exitCode
    await mkdir(projectDir, { recursive: true })
    process.chdir(projectDir)

    jest.clearAllMocks()
    mockedRunConfigSession.mockResolvedValue({ config: { workflow: WORKFLOW, advancedSkills: ['context7'] } as never, recap: [] })
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(async () => {
    logSpy.mockRestore()
    process.exitCode = originalExitCode
    process.chdir(originalCwd)
    await rm(projectDir, { recursive: true, force: true }).catch(() => {})
  })

  const readManifest = async () => JSON.parse(await readFile(join(projectDir, '.saasfoundry.json'), 'utf8'))

  it('offers harness on a stack-only project and installs it end-to-end', async () => {
    await writeFile('.saasfoundry.json', JSON.stringify(stackManifest(), null, 2))

    await updateCommand({ nonInteractive: true, addModules: 'harness' })

    // Workflow collected through the config-engine session
    expect(mockedRunConfigSession).toHaveBeenCalledTimes(1)

    // Real deposits on disk
    expect(await readFile(join(projectDir, '.claude/skills/sf-workflow/SKILL.md'), 'utf8')).toContain('SaaSFoundry Solo')
    expect(await readFile(join(projectDir, '.claude/skills/sf-tool-context7/SKILL.md'), 'utf8')).toBeTruthy()

    // Manifest converges to the full-profile state: workflow + tracking
    const manifest = await readManifest()
    expect(manifest.workflow.tool).toBe('github-projects')
    expect(manifest.modules.harness.version).toBe(1)
    expect(manifest.modules.harness.managed).toBe(true)
    expect(manifest.modules.advancedSkills).toEqual(['context7'])
    expect(manifest.modules.email.provider).toBe('none')
    expect(Object.keys(manifest.fileHashes).some((p: string) => p.startsWith('.claude/skills/sf-workflow/'))).toBe(true)
  })

  it('passes a non-interactive workflow preset to the shared config engine', async () => {
    await writeFile('.saasfoundry.json', JSON.stringify(stackManifest(), null, 2))

    await updateCommand({ nonInteractive: true, addModules: 'harness', workflow: 'saasfoundry' })

    expect(mockedRunConfigSession).toHaveBeenCalledWith(
      expect.objectContaining({
        nonInteractive: true,
        prefill: expect.objectContaining({ workflowPreset: 'saasfoundry' })
      })
    )
  })

  it('routes --target-profile full through the same harness installation path', async () => {
    await writeFile('.saasfoundry.json', JSON.stringify(stackManifest(), null, 2))

    await updateCommand({ nonInteractive: true, targetProfile: 'full' })

    expect(mockedRunConfigSession).toHaveBeenCalledTimes(1)
    const manifest = await readManifest()
    expect(manifest.workflow.tool).toBe('github-projects')
    expect(manifest.modules.harness).toMatchObject({ version: 1, managed: true })
    expect(manifest.modules.email.provider).toBe('none')
  })

  it('does not offer harness when the collaboration surface is already managed', async () => {
    const tracked = stackManifest()
    tracked.modules = { ...tracked.modules, harness: { version: 1, managed: true } }
    await writeFile('.saasfoundry.json', JSON.stringify({ ...tracked, workflow: WORKFLOW }, null, 2))

    await updateCommand({ nonInteractive: true, addModules: 'harness' })

    expect(mockedRunConfigSession).not.toHaveBeenCalled()
  })

  it('protects user-edited pre-existing deposits with sidecars during late install', async () => {
    await writeFile('.saasfoundry.json', JSON.stringify(stackManifest(), null, 2))
    // Stack scaffolds ship core skills — simulate one, edited by the user
    const editedPath = '.claude/skills/sf-integration-rules/SKILL.md'
    await mkdir(join(projectDir, '.claude/skills/sf-integration-rules'), { recursive: true })
    await writeFile(join(projectDir, editedPath), 'my precious user edit\n')

    await updateCommand({ nonInteractive: true, addModules: 'harness' })

    // Edit intact, template landed as a sidecar, deposits tracked
    expect(await readFile(join(projectDir, editedPath), 'utf8')).toBe('my precious user edit\n')
    expect(await readFile(join(projectDir, `${editedPath}.saasfoundry.new`), 'utf8')).not.toBe('my precious user edit\n')
    const manifest = await readManifest()
    expect(manifest.modules.harness.version).toBe(1)
    expect(manifest.modules.harness.managed).toBe(true)
    // Baseline = deposit target, not the user's edit
    const { hashFileContent } = jest.requireActual<typeof import('../../../utils')>('../../../utils')
    expect(manifest.fileHashes[editedPath]).not.toBe(hashFileContent('my precious user edit\n'))
  })

  it('fails closed on a legacy manifest whose harness capability is unknown', async () => {
    await writeFile(
      '.saasfoundry.json',
      JSON.stringify({ $schema: manifestSchemaUrl, manifestVersion: 2, version: cliVersion, generatedAt: 'x', structure: 'cli', projectName: 'acme', mainBranch: 'main' }, null, 2)
    )

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    await updateCommand({ nonInteractive: true, addModules: 'harness' })
    errorSpy.mockRestore()

    const manifest = await readManifest()
    expect(manifest.workflow).toBeUndefined()
    expect(manifest.modules?.harness).toBeUndefined()
    expect(process.exitCode).toBe(1)
  })
})

// #451 AC3: adding skills via sf update no longer crashes on a manifest
// without the scaffold modules block — deposits land at the repo root.
describe('updateCommand — skills add on a harness manifest', () => {
  let projectDir: string
  let originalCwd: string
  let logSpy: jest.SpyInstance

  beforeEach(async () => {
    projectDir = join(tmpdir(), `sf-skills-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    originalCwd = process.cwd()
    await mkdir(projectDir, { recursive: true })
    process.chdir(projectDir)
    jest.clearAllMocks()
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(async () => {
    logSpy.mockRestore()
    process.chdir(originalCwd)
    await rm(projectDir, { recursive: true, force: true }).catch(() => {})
  })

  it('installs an advanced skill at the repo root and tracks it', async () => {
    await writeFile(
      '.saasfoundry.json',
      JSON.stringify(
        {
          $schema: manifestSchemaUrl,
          manifestVersion: 2,
          version: cliVersion,
          generatedAt: 'x',
          structure: 'cli',
          projectName: 'acme',
          mainBranch: 'main',
          workflow: { tool: 'github-projects' },
          modules: { harness: { version: 1 } }
        },
        null,
        2
      )
    )

    await updateCommand({ nonInteractive: true, addModules: 'sf-skill-context7' })

    const skillMd = await readFile(join(projectDir, '.claude/skills/sf-tool-context7/SKILL.md'), 'utf8')
    expect(skillMd).toBeTruthy()
    const manifest = JSON.parse(await readFile(join(projectDir, '.saasfoundry.json'), 'utf8'))
    expect(manifest.modules.advancedSkills).toEqual(['context7'])
    expect(manifest.modules.harness.version).toBe(1)
    expect(Object.keys(manifest.fileHashes ?? {}).some((p: string) => p.startsWith('.claude/skills/sf-tool-context7/'))).toBe(true)
  })

  it('still refuses stack modules on a non-scaffold manifest', async () => {
    await writeFile(
      '.saasfoundry.json',
      JSON.stringify(
        { $schema: manifestSchemaUrl, manifestVersion: 2, version: cliVersion, generatedAt: 'x', structure: 'cli', projectName: 'acme', mainBranch: 'main', workflow: { tool: 'github-projects' } },
        null,
        2
      )
    )

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    await updateCommand({ nonInteractive: true, addModules: 'email' })
    errorSpy.mockRestore()

    // email is filtered by availability (not offered), so nothing was installed
    const manifest = JSON.parse(await readFile(join(projectDir, '.saasfoundry.json'), 'utf8'))
    expect(manifest.modules?.email).toBeUndefined()
  })
})
