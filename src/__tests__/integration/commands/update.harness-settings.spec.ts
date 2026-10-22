import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, rm, stat, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

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
import { GENERATED_REGION_START } from '../../../harness/agent-instructions'
import { CLAUDE_CAPTURE_COMMAND } from '../../../harness/delegation-hooks'
import { computeHarnessFileHashes, harnessInstallerMeta, installHarness } from '../../../installers/harness.installer'

const mockedPrompt = inquirer.prompt as unknown as jest.Mock

const FIXTURES = join(__dirname, '../../fixtures')
const sha = (content: Buffer | string): string => createHash('sha256').update(content).digest('hex')

type Settings = { hooks?: Record<string, { matcher?: string; hooks: { command: string }[] }[]>; permissions?: { allow?: string[]; ask?: string[] }; [key: string]: unknown }

// #935 — `sf update` keeps `.claude/settings.json` current (the delegation capture hooks and the permission
// rules), and takes an installed harness from the released v3 to v5 in one run.
describe('updateCommand — .claude/settings.json and the harness v4 → v5 migration (#935)', () => {
  let projectDir: string
  let originalCwd: string
  let logSpy: jest.SpyInstance

  const SETTINGS = '.claude/settings.json'
  const path = (relative: string): string => join(projectDir, relative)
  const read = (relative: string): Promise<string> => readFile(path(relative), 'utf8')
  const readManifest = async (): Promise<SaaSFoundryManifest> => JSON.parse(await read('.saasfoundry.json'))
  const output = (): string => logSpy.mock.calls.flat().join('\n')
  const released = (version: string, name: string): Promise<string> => readFile(join(FIXTURES, 'released-bridges', version, name), 'utf8')

  const put = async (relative: string, content: string): Promise<void> => {
    await mkdir(dirname(path(relative)), { recursive: true })
    await writeFile(path(relative), content)
  }

  const writeManifest = async (overrides: Partial<SaaSFoundryManifest>): Promise<void> => {
    const manifest: SaaSFoundryManifest = {
      $schema: manifestSchemaUrl,
      manifestVersion: 2,
      version: cliVersion,
      generatedAt: new Date().toISOString(),
      structure: 'cli',
      projectName: 'acme',
      mainBranch: 'main',
      ...overrides
    }
    await writeFile(path('.saasfoundry.json'), JSON.stringify(manifest, null, 2))
  }

  /** A real harness install and its hash baseline, with the settings an older CLI left in place of today's. */
  const installHarnessWith = async (settings: string): Promise<Record<string, string>> => {
    await installHarness({ targetPath: projectDir, projectName: 'acme', version: cliVersion })
    await put(SETTINGS, settings)
    return computeHarnessFileHashes(projectDir)
  }

  beforeEach(async () => {
    projectDir = join(tmpdir(), `sf-harness-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    originalCwd = process.cwd()
    await mkdir(projectDir, { recursive: true })
    process.chdir(projectDir)

    jest.clearAllMocks()
    mockedPrompt.mockImplementation(((_q: unknown, answers: Record<string, unknown>) => Promise.resolve({ adoptHarness: true, ...(answers ?? {}) })) as never)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(async () => {
    logSpy.mockRestore()
    process.chdir(originalCwd)
    await rm(projectDir, { recursive: true, force: true }).catch(() => {})
  })

  describe('on every run, for a harness already at v5', () => {
    it('gives a project with an older allow list the new rules and the capture hooks, and keeps what the project added', async () => {
      const own = { model: 'opus', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './check.sh' }] }] } }
      const older = JSON.parse(await released('1.0.1', 'settings.json'))
      const hashes = await installHarnessWith(JSON.stringify({ ...older, ...own, hooks: { ...older.hooks, ...own.hooks } }, null, 2))
      await writeManifest({ modules: { harness: { version: harnessInstallerMeta.currentVersion, managed: true } }, workflow: { tool: 'none' }, fileHashes: hashes })
      expect(JSON.parse(await read(SETTINGS)).permissions.allow).not.toContain('Bash(sf agents route *)')

      await updateCommand({ nonInteractive: true })

      const settings = JSON.parse(await read(SETTINGS)) as Settings
      expect(settings.permissions?.allow).toEqual(expect.arrayContaining([...older.permissions.allow, 'Bash(sf agents route *)', 'Bash(sf agents delegation status)']))
      expect(settings.permissions?.ask).toEqual(expect.arrayContaining(['Bash(sf agents route --record*)']))
      expect(settings.hooks?.SubagentStop?.some((group) => group.hooks.some((hook) => hook.command === CLAUDE_CAPTURE_COMMAND))).toBe(true)
      expect(settings.hooks?.PostToolUse?.some((group) => group.hooks.some((hook) => hook.command === CLAUDE_CAPTURE_COMMAND))).toBe(true)
      expect(settings.model).toBe('opus')
      expect(settings.hooks?.PreToolUse).toEqual(own.hooks.PreToolUse)
      expect(output()).toContain('.claude/settings.json: delegation capture hooks and harness permissions merged in')
    })

    it('writes nothing the second time: same bytes, same modification time, nothing said', async () => {
      const hashes = await installHarnessWith(await released('1.0.1', 'settings.json'))
      await writeManifest({ modules: { harness: { version: harnessInstallerMeta.currentVersion, managed: true } }, workflow: { tool: 'none' }, fileHashes: hashes })
      await updateCommand({ nonInteractive: true })
      const once = await read(SETTINGS)
      const mtime = (await stat(path(SETTINGS))).mtimeMs
      logSpy.mockClear()

      await updateCommand({ nonInteractive: true })

      expect(await read(SETTINGS)).toBe(once)
      expect((await stat(path(SETTINGS))).mtimeMs).toBe(mtime)
      expect(output()).not.toContain('.claude/settings.json')
    })

    it('leaves a settings file that is not JSON as it is and writes the proposal beside it, without failing the update', async () => {
      const hashes = await installHarnessWith('{ "hooks": // mine\n')
      await writeManifest({ modules: { harness: { version: harnessInstallerMeta.currentVersion, managed: true } }, workflow: { tool: 'none' }, fileHashes: hashes })

      await updateCommand({ nonInteractive: true })

      expect(await read(SETTINGS)).toBe('{ "hooks": // mine\n')
      expect(JSON.parse(await read(`${SETTINGS}.saasfoundry.new`)).hooks.SubagentStop).toBeDefined()
      expect(output()).toContain('.claude/settings.json is not valid JSON: left as it is')
      expect((await readManifest()).version).toBe(cliVersion)
    })

    it('leaves a symbolic link as it is, and writes the proposal beside it', async () => {
      const hashes = await installHarnessWith('{}')
      await rm(path(SETTINGS))
      await put('shared/settings.json', JSON.stringify({ model: 'opus' }))
      await symlink(path('shared/settings.json'), path(SETTINGS))
      await writeManifest({ modules: { harness: { version: harnessInstallerMeta.currentVersion, managed: true } }, workflow: { tool: 'none' }, fileHashes: hashes })

      await updateCommand({ nonInteractive: true })

      expect(await read('shared/settings.json')).toBe(JSON.stringify({ model: 'opus' }))
      expect(JSON.parse(await read(`${SETTINGS}.saasfoundry.new`)).model).toBe('opus')
      expect(output()).toContain('.claude/settings.json is a symbolic link: left as it is')
    })

    it('does not touch the settings of a harness that does not declare Claude Code', async () => {
      const older = await released('1.0.1', 'settings.json')
      const hashes = await installHarnessWith(older)
      await writeManifest({ modules: { harness: { version: harnessInstallerMeta.currentVersion, managed: true, agents: ['codex'] } }, workflow: { tool: 'none' }, fileHashes: hashes })

      await updateCommand({ nonInteractive: true })

      expect(await read(SETTINGS)).toBe(older)
    })

    it('shows what it would merge in the dry-run report, and writes nothing', async () => {
      const older = await released('1.0.1', 'settings.json')
      const hashes = await installHarnessWith(older)
      await writeManifest({ modules: { harness: { version: harnessInstallerMeta.currentVersion, managed: true } }, workflow: { tool: 'none' }, fileHashes: hashes })

      await updateCommand({ nonInteractive: true, dryRun: true })

      expect(await read(SETTINGS)).toBe(older)
      const report = JSON.parse(output().split('<sf-update-dry-run-report>')[1].split('</sf-update-dry-run-report>')[0])
      expect(report.harnessSettings).toEqual([{ path: SETTINGS, status: 'merged' }])
      expect(output()).toContain('would be merged in')
    })
  })

  describe('a harness installed by 1.0.1 (v3)', () => {
    /** What 1.0.1 left: the pre-#937 CLAUDE.md, its AGENTS.md bridge, its settings, and no tier agent. */
    const installV101 = async (): Promise<void> => {
      const hashes = await installHarnessWith(await released('1.0.1', 'settings.json'))
      await put('CLAUDE.md', await readFile(join(FIXTURES, 'pre-937-claude-md', 'harness.CLAUDE.md'), 'utf8'))
      await put('AGENTS.md', await released('1.0.1', 'AGENTS.common.md'))
      await rm(path('.claude/agents'), { recursive: true, force: true })
      await rm(path('.claude/rules'), { recursive: true, force: true })
      await writeManifest({
        version: '1.0.1',
        modules: { harness: { version: 3, managed: true } },
        workflow: { tool: 'none' },
        fileHashes: { ...hashes, 'AGENTS.md': sha(await released('1.0.1', 'AGENTS.common.md')) }
      })
    }

    it('reaches v5 in one sf update: the instructions moved, the tier agents and the capture hooks in place', async () => {
      await installV101()

      await updateCommand({ nonInteractive: true })

      // v3 → v4: CLAUDE.md moved into AGENTS.md, no proposal left beside it
      expect(existsSync(path('CLAUDE.md'))).toBe(false)
      expect(await read('AGENTS.md')).toContain(GENERATED_REGION_START)
      expect(existsSync(path('AGENTS.md.saasfoundry.new'))).toBe(false)
      // the per-update refresh: the tier agents
      expect(existsSync(path('.claude/agents/sf-build.md'))).toBe(true)
      // v4 → v5: the capture hooks and the permissions, with the 1.0.1 rules kept
      const settings = JSON.parse(await read(SETTINGS)) as Settings
      expect(settings.hooks?.SubagentStop?.[0].matcher).toBe('sf-.*')
      expect(settings.permissions?.allow).toEqual(expect.arrayContaining(JSON.parse(await released('1.0.1', 'settings.json')).permissions.allow))
      expect(settings.permissions?.allow).toContain('Bash(sf agents route *)')
      // The consent is the developer's own answer: the update never records one
      const manifest = await readManifest()
      expect(manifest.modules?.harness?.version).toBe(5)
      expect(manifest.modules?.harness?.delegation).toBeUndefined()
      expect(output()).toContain("Migrated module 'harness' v3 → v5 via [003→004 move-claude-md-to-agents-md, 004→005 wire-delegation-capture]")
    })

    it('is byte-idempotent: a second sf update writes nothing', async () => {
      await installV101()
      await updateCommand({ nonInteractive: true })
      const files = ['AGENTS.md', SETTINGS, '.saasfoundry.json', '.claude/agents/sf-build.md']
      const once = await Promise.all(files.map(read))
      const mtimes = await Promise.all(files.map(async (file) => (await stat(path(file))).mtimeMs))

      await updateCommand({ nonInteractive: true })

      expect(await Promise.all(files.map(read))).toEqual(once)
      expect(await Promise.all(files.map(async (file) => (await stat(path(file))).mtimeMs))).toEqual(mtimes)
    })

    it('lists the file the migration would merge in the dry run, once, and writes nothing', async () => {
      await installV101()

      await updateCommand({ nonInteractive: true, dryRun: true })

      const report = JSON.parse(output().split('<sf-update-dry-run-report>')[1].split('</sf-update-dry-run-report>')[0])
      const harness = report.moduleMigrations.find((pending: { module: string }) => pending.module === 'harness')
      const capture = harness.migrations.find((migration: { name: string }) => migration.name === 'wire-delegation-capture')
      expect(capture.preview).toEqual([{ action: 'merge', source: SETTINGS, reason: expect.stringContaining('delegation capture hooks') }])
      // The migration lists it: the every-run merge does not list it a second time
      expect(report.harnessSettings).toBeUndefined()
      expect(await read(SETTINGS)).toBe(await released('1.0.1', 'settings.json'))
      expect(existsSync(path('CLAUDE.md'))).toBe(true)
    })

    it('removes the 1.0.1 CLAUDE.md bridge over an AGENTS.md project, and keeps the AGENTS.md as it is', async () => {
      const hashes = await installHarnessWith(await released('1.0.1', 'settings.json'))
      const own = '# acme\n\nUse pnpm.\n'
      await put('CLAUDE.md', await released('1.0.1', 'CLAUDE.bridge.md'))
      await put('AGENTS.md', own)
      await rm(path('.claude/agents'), { recursive: true, force: true })
      await writeManifest({ version: '1.0.1', modules: { harness: { version: 3, managed: true, agents: ['codex', 'claude-code'] } }, workflow: { tool: 'none' }, fileHashes: hashes })

      await updateCommand({ nonInteractive: true })

      expect(existsSync(path('CLAUDE.md'))).toBe(false)
      expect(existsSync(path('AGENTS.md.saasfoundry.new'))).toBe(false)
      expect(await read('AGENTS.md')).toContain(own.trimEnd())
      expect(output()).toContain('Removed CLAUDE.md: a generated bridge to AGENTS.md')
    })
  })
})
