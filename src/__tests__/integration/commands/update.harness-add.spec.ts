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
  let logSpy: jest.SpyInstance

  const stackManifest = (): SaaSFoundryManifest => ({
    $schema: manifestSchemaUrl,
    manifestVersion: 2,
    version: cliVersion,
    generatedAt: new Date().toISOString(),
    structure: 'multirepo',
    projectName: 'acme',
    mainBranch: 'main',
    modules: { email: { provider: 'none', version: 1 }, s3Setup: 'manual', dbSetup: 'manual', includeAnalytics: false, advancedSkills: [] },
    fileHashes: {}
  })

  beforeEach(async () => {
    projectDir = join(tmpdir(), `sf-harness-add-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    originalCwd = process.cwd()
    await mkdir(projectDir, { recursive: true })
    process.chdir(projectDir)

    jest.clearAllMocks()
    mockedRunConfigSession.mockResolvedValue({ config: { workflow: WORKFLOW, advancedSkills: ['context7'] } as never, recap: [] })
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(async () => {
    logSpy.mockRestore()
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
    expect(manifest.modules.advancedSkills).toEqual(['context7'])
    expect(manifest.modules.email.provider).toBe('none')
    expect(Object.keys(manifest.fileHashes).some((p: string) => p.startsWith('.claude/skills/sf-workflow/'))).toBe(true)
  })

  it('does not offer harness when a workflow is already configured', async () => {
    await writeFile('.saasfoundry.json', JSON.stringify({ ...stackManifest(), workflow: WORKFLOW }, null, 2))

    await updateCommand({ nonInteractive: true, addModules: 'harness' })

    expect(mockedRunConfigSession).not.toHaveBeenCalled()
    const manifest = await readManifest()
    expect(manifest.modules.harness).toBeUndefined()
  })

  it('works on a harness-only manifest that skipped the workflow step', async () => {
    await writeFile(
      '.saasfoundry.json',
      JSON.stringify({ $schema: manifestSchemaUrl, manifestVersion: 2, version: cliVersion, generatedAt: 'x', structure: 'cli', projectName: 'acme', mainBranch: 'main' }, null, 2)
    )

    await updateCommand({ nonInteractive: true, addModules: 'harness' })

    const manifest = await readManifest()
    expect(manifest.workflow.tool).toBe('github-projects')
    expect(manifest.modules.harness.version).toBe(1)
  })
})
