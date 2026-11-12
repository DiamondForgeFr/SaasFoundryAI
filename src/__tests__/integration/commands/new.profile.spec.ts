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

jest.mock('../../../renderers/technical-stack.renderer', () => ({ renderTechnicalStack: jest.fn() }))
// Label provisioning talks to GitHub: observed here, its behaviour is covered by the unit spec (#973).
jest.mock('../../../installers/harness-provisioning', () => ({
  ...jest.requireActual('../../../installers/harness-provisioning'),
  provisionWorkflowLabels: jest.fn(() => [{ ok: true, message: 'Created 7 workflow labels on acme/acme' }])
}))
jest.mock('../../../installers/skills.installer', () => ({ ...jest.requireActual('../../../installers/skills.installer'), installSkills: jest.fn() }))

jest.mock('../../../runners/database.runner', () => ({ initAndStartDb: jest.fn() }))
jest.mock('../../../runners/s3.runner', () => ({ initAndStartS3: jest.fn() }))
jest.mock('../../../runners/srs.runner', () => ({
  bootstrapSrs: jest.fn().mockResolvedValue({ rootPage: { id: 'srs-root', url: 'https://example.test/srs', name: 'acme-srs' } })
}))
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
import { GENERATED_INSTRUCTIONS } from '../../../harness/agent-instructions'
import { SESSION_START_COMMAND } from '../../../harness/session-start-hook'
import { harnessInstallerMeta } from '../../../installers/harness.installer'
import { provisionWorkflowLabels } from '../../../installers/harness-provisioning'
import { renderTechnicalStack } from '../../../renderers/technical-stack.renderer'
import { collectStatus } from '../../../status/collect'
import { evaluatePreconditions } from '../../../status/preconditions'

const mockedPrompt = inquirer.prompt as unknown as jest.Mock
const mockedRenderTechnicalStack = renderTechnicalStack as jest.MockedFunction<typeof renderTechnicalStack>
const mockedProvisionWorkflowLabels = provisionWorkflowLabels as jest.MockedFunction<typeof provisionWorkflowLabels>

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

    expect(mockedRenderTechnicalStack).toHaveBeenCalledTimes(1)
    const renderOptions = mockedRenderTechnicalStack.mock.calls[0][0]
    expect(renderOptions.targetDir).toBe('.')
    expect(renderOptions.externalEffects).toBe(true)
    expect(renderOptions.config.workflow).toBeUndefined()
    expect(renderOptions.config.advancedSkills ?? []).toEqual([])

    const manifest = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    expect(manifest.workflow).toBeUndefined()
    expect(manifest.tools).toBeUndefined()
    expect(manifest.modules.advancedSkills).toEqual([])
    expect(manifest.modules.harness).toEqual({ version: harnessInstallerMeta.currentVersion, managed: false })
  })

  it('stack profile never asks workflow/skills/SRS questions', async () => {
    await newCommand(stackOpts)

    const askedNames = mockedPrompt.mock.calls.flatMap((call) => (call[0] as { name: string }[]).map((q) => q.name))
    expect(askedNames).not.toContain('srsEnable')
    expect(askedNames).not.toContain('configureWorkflow')
  })

  it('harness profile installs the AI harness onto the existing repo without scaffolding', async () => {
    await newCommand({
      nonInteractive: true,
      profile: 'harness',
      projectName: 'acme',
      mainBranch: 'main'
    })

    expect(mockedRenderTechnicalStack).not.toHaveBeenCalled()

    // Minimal manifest: structure cli, harness deposits version+hash-tracked
    // (scoped to the deposit dirs only — never the user's own code)
    const manifest = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    expect(manifest).toMatchObject({ structure: 'cli', projectName: 'acme', mainBranch: 'main' })
    expect(manifest.modules).toEqual({ harness: { version: harnessInstallerMeta.currentVersion, managed: true }, advancedSkills: [] })
    // computeFileHashes is mocked to {} in this spec — the field wiring is
    // asserted here, real hash content is covered by the installer unit spec.
    expect(manifest.fileHashes).toBeDefined()
    for (const trackedPath of Object.keys(manifest.fileHashes)) {
      expect(trackedPath).toMatch(/^(?:\.claude\/(?:skills|docs)\/|\.claude\/rules\/claude-code\.md$|\.claude\/agents\/sf-[a-z-]+\.md$)/)
    }
    // AGENTS.md is project-owned: only its generated region is refreshed, it carries no baseline
    expect(manifest.fileHashes['AGENTS.md']).toBeUndefined()

    // Harness deposits, no scaffold directories
    const agentsMd = await readFile('AGENTS.md', 'utf8')
    expect(agentsMd).toContain('# acme')
    expect(agentsMd).toContain(GENERATED_INSTRUCTIONS)
    expect(await readFile(join(tempDir, '.claude', 'rules', 'claude-code.md'), 'utf8')).not.toBe('')
    expect(await readdir(tempDir)).not.toContain('CLAUDE.md')
    expect(await readdir(tempDir)).not.toContain('CLAUDE.local.md')
    expect(await readdir(tempDir)).not.toContain('GEMINI.md')
    const settings = JSON.parse(await readFile(join(tempDir, '.claude', 'settings.json'), 'utf8'))
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(SESSION_START_COMMAND)
    expect(await readdir(tempDir)).not.toContain('apps')

    // TC-1: sf status preconditions all pass on the harness install
    const report = await collectStatus(tempDir, { checkNetwork: false })
    const failing = evaluatePreconditions(report).filter((p) => p.status === 'fail')
    expect(failing).toEqual([])

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Claude Code (claude-code) — AGENTS.md')
    expect(output).toContain('sf status --agent-friendly --no-network')
  })

  it('harness completion reports explicit agents and provider-neutral next steps', async () => {
    await newCommand({
      nonInteractive: true,
      profile: 'harness',
      projectName: 'acme',
      mainBranch: 'main',
      agents: 'codex,gemini-cli'
    })

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Codex (codex) — AGENTS.md')
    expect(output).toContain('Gemini CLI (gemini-cli) — GEMINI.md')
    expect(output).toContain('sf agents doctor codex gemini-cli')
    expect(output).not.toContain('open the project in Claude Code')

    // Only the declared Gemini CLI gets its entrypoint; Claude Code is not declared, so no rule
    expect(await readFile('GEMINI.md', 'utf8')).toBe('# SaaSFoundry shared instructions\n\n@AGENTS.md\n')
    expect(await readdir(tempDir)).not.toContain('CLAUDE.md')
  })

  it('harness profile persists and installs an explicit non-interactive workflow preset', async () => {
    await newCommand({
      nonInteractive: true,
      profile: 'harness',
      projectName: 'acme',
      mainBranch: 'main',
      workflow: 'solo',
      tracker: 'github-projects',
      agents: 'claude-code,codex'
    })

    const manifest = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    expect(manifest.workflow).toMatchObject({
      tool: 'github-projects',
      template: 'SaaSFoundry Solo',
      workingBranch: 'develop',
      prTargetBranch: 'develop'
    })
    expect(manifest.workflow.statuses.map((status: { name: string }) => status.name)).toEqual(['Backlog', 'In Progress', 'AI Testing', 'In Review', 'Done'])
    expect(manifest.aiRules).toMatchObject({ alwaysCreateBranchFromWorking: true, requireHumanCheckOnPushedBranch: true })

    const statusDocs = await readdir(join(tempDir, '.claude', 'skills', 'sf-workflow', 'statuses'))
    expect(statusDocs.filter((file) => /^\d+-/.test(file)).sort()).toEqual(['1-backlog.md', '2-in-progress.md', '3-ai-testing.md', '4-in-review.md', '5-done.md'])
    expect(await readFile(join(tempDir, '.claude', 'skills', 'sf-workflow', 'workflow-cli.sh'), 'utf8')).toContain('manifest_statuses()')
    expect(await readdir(join(tempDir, '.claude', 'skills'))).toContain('sf-tool-github-projects')
    expect(await readdir(join(tempDir, '.agents', 'skills', 'sf-workflow', 'statuses'))).toEqual(statusDocs)
    for (const file of statusDocs) {
      expect(manifest.fileHashes[`.agents/skills/sf-workflow/statuses/${file}`]).toBeDefined()
    }
  })

  // #973 — only the harness path created the workflow labels: the first `create-ticket --complexity` of a full project failed
  describe('workflow labels', () => {
    const fullOpts = { ...stackOpts, profile: 'full' as const, workflow: 'solo', tracker: 'github-projects' }

    it('harness profile provisions them on the repository it runs in', async () => {
      await newCommand({ nonInteractive: true, profile: 'harness', projectName: 'acme', mainBranch: 'main', workflow: 'solo', tracker: 'github-projects' })

      expect(mockedProvisionWorkflowLabels).toHaveBeenCalledTimes(1)
      expect(mockedProvisionWorkflowLabels).toHaveBeenCalledWith({ srs: false, dirs: ['.'] })
      expect(logSpy.mock.calls.flat().join('\n')).toContain('Created 7 workflow labels on acme/acme')
    })

    it('full monorepo profile provisions them on the monorepo and reports it', async () => {
      await newCommand({ ...fullOpts, structure: 'monorepo' })

      expect(mockedProvisionWorkflowLabels).toHaveBeenCalledTimes(1)
      expect(mockedProvisionWorkflowLabels).toHaveBeenCalledWith({ srs: false, dirs: ['.'] })
      expect(logSpy.mock.calls.flat().join('\n')).toContain('Created 7 workflow labels on acme/acme')
    })

    it('full multirepo profile provisions them on the backend and the frontend repositories', async () => {
      await newCommand(fullOpts)

      expect(mockedProvisionWorkflowLabels).toHaveBeenCalledWith({ srs: false, dirs: [join('apps', 'acme-api'), join('apps', 'acme-web')] })
      expect(logSpy.mock.calls.flat().join('\n')).toContain('Created 7 workflow labels on acme/acme')
    })

    it('full profile without a GitHub Projects workflow creates none', async () => {
      await newCommand({ ...stackOpts, profile: 'full' })

      expect(mockedProvisionWorkflowLabels).not.toHaveBeenCalled()
    })
  })

  // #822 — a solo project working on main no longer has to edit the manifest after setup
  it('harness profile writes the branches passed as flags', async () => {
    await newCommand({ nonInteractive: true, profile: 'harness', projectName: 'acme', mainBranch: 'main', workflow: 'solo', tracker: 'github-projects', workingBranch: 'main' })

    const manifest = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    expect(manifest.workflow).toMatchObject({ workingBranch: 'main', prTargetBranch: 'main' })
  })

  // #821 — the non-interactive harness setup left the workflow without a board, and said nothing
  it('harness profile warns when the GitHub Projects workflow has no board, and attaches --project-url', async () => {
    await newCommand({ nonInteractive: true, profile: 'harness', projectName: 'acme', mainBranch: 'main', workflow: 'solo', tracker: 'github-projects' })
    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('No github-projects board attached')
    expect(output).toContain('sf workflow use solo --project-url <url>')

    await rm('.saasfoundry.json')
    logSpy.mockClear()
    await newCommand({
      nonInteractive: true,
      profile: 'harness',
      projectName: 'acme',
      mainBranch: 'main',
      workflow: 'solo',
      tracker: 'github-projects',
      projectUrl: 'https://github.com/users/acme/projects/7'
    })
    expect(JSON.parse(await readFile('.saasfoundry.json', 'utf8')).workflow.projectUrl).toBe('https://github.com/users/acme/projects/7')
    expect(logSpy.mock.calls.flat().join('\n')).not.toContain('board attached')
  })

  it('publishes the SRS skill to declared shared agents after SRS bootstrap', async () => {
    await newCommand({
      nonInteractive: true,
      profile: 'harness',
      projectName: 'acme',
      mainBranch: 'main',
      agents: 'claude-code,codex',
      srsEnable: true,
      srsBackend: 'notion',
      srsParentPageInput: '00000000-0000-0000-0000-000000000001',
      notionApiToken: 'fixture-token'
    })

    const sharedSkill = await readFile('.agents/skills/sf-srs/SKILL.md', 'utf8')
    expect(sharedSkill).toContain('name: sf-srs')
    expect(await readFile('.agents/skills/sf-srs/scripts/srs-cli.sh', 'utf8')).toContain('#!/usr/bin/env bash')
    const manifest = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    expect(manifest.fileHashes['.agents/skills/sf-srs/SKILL.md']).toBeDefined()
    expect(manifest.tools.srs.enabled).toBe(true)
  })

  // Covers the S4 scenarios of #514, which were only validated by hand: a fresh
  // project must carry the block, and the flag must reach all three surfaces.
  it('writes the language block at English defaults when --language is not passed', async () => {
    await newCommand({ nonInteractive: true, profile: 'harness', projectName: 'acme', mainBranch: 'main' })

    const manifest = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    expect(manifest.language).toEqual({ srs: 'en', tickets: 'en', codeComments: 'en' })
  })

  it('applies --language to all three surfaces', async () => {
    await newCommand({ nonInteractive: true, profile: 'harness', projectName: 'acme', mainBranch: 'main', language: 'fr' })

    const manifest = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    expect(manifest.language).toEqual({ srs: 'fr', tickets: 'fr', codeComments: 'fr' })
  })

  // The stack profile never sees the question — its manifest must still carry
  // the block, or a later `sf update` would be the first to introduce it.
  it('stack profile carries the block at English defaults despite skipping the step', async () => {
    await newCommand(stackOpts)

    const manifest = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    expect(manifest.language).toEqual({ srs: 'en', tickets: 'en', codeComments: 'en' })
  })

  it('harness profile refuses to run when a manifest already exists', async () => {
    const { writeFile: write } = jest.requireActual<typeof import('fs/promises')>('fs/promises')
    await write(join(tempDir, '.saasfoundry.json'), '{"structure":"cli","projectName":"x","version":"1.0.0"}')

    await expect(
      newCommand({
        nonInteractive: true,
        profile: 'harness',
        projectName: 'acme',
        mainBranch: 'main'
      })
    ).rejects.toThrow(/already has a \.saasfoundry\.json/)

    expect(mockedRenderTechnicalStack).not.toHaveBeenCalled()
  })

  it('defaults to the full profile in non-interactive mode without --profile (regression guard)', async () => {
    await newCommand({ ...stackOpts, profile: undefined })

    expect(mockedRenderTechnicalStack).toHaveBeenCalledTimes(1)
    const manifest = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    expect(manifest.projectName).toBe('acme')
  })
})
