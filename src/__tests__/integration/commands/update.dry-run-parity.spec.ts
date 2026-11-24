import { createHash } from 'crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import inquirer from 'inquirer'

import { GENERATED_REGION_END, GENERATED_REGION_START } from '../../../harness/agent-instructions'
import { CODEX_HOOKS_PATH } from '../../../harness/delegation-hooks'
import { SaaSFoundryManifest, manifestSchemaUrl } from '../../../types'
import { hashFileContent } from '../../../utils'
import type { UpdateDryRunReport } from '../../../commands/update.options'

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
const OLD_VERSION = '0.9.0-test'

/** Every file of the tree, by relative path, with its content hash. */
async function snapshot(root: string, relative = ''): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) for (const [child, hash] of await snapshot(root, path)) files.set(child, hash)
    else
      files.set(
        path,
        createHash('sha256')
          .update(await readFile(join(root, path)))
          .digest('hex')
      )
  }
  return files
}

function changedPaths(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = new Set([...before.keys(), ...after.keys()])
  return [...paths].filter((path) => before.get(path) !== after.get(path)).sort()
}

/** Every path the dry-run report says the real run writes or removes. */
function plannedPaths(report: UpdateDryRunReport): string[] {
  const paths = new Set<string>()
  const harness = report.harnessRefresh
  if (harness && harness.status === 'would-apply') [...harness.update, ...harness.add].forEach((path) => paths.add(path))
  const agents = report.agentInstructions
  if (agents) [...agents.update, ...agents.add, ...agents.remove].forEach((path) => paths.add(path))
  for (const settings of report.harnessSettings ?? []) paths.add(settings.sidecar ?? settings.path)
  for (const limit of report.codexInstructionLimit ?? []) paths.add(limit.path)
  for (const manifest of report.manifestWrites ?? []) paths.add(manifest.path)
  return [...paths].sort()
}

// #1315 — the dry run is the plan a developer reviews: it lists every file the real run writes, per host.
describe('updateCommand — the dry run lists every file the real run writes (#1315)', () => {
  let projectDir: string
  let originalCwd: string
  let logSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  beforeEach(async () => {
    projectDir = join(tmpdir(), `sf-dry-run-parity-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    originalCwd = process.cwd()
    await mkdir(projectDir, { recursive: true })
    process.chdir(projectDir)
    jest.clearAllMocks()
    mockedPrompt.mockImplementation(((_q: unknown, answers: Record<string, unknown>) => Promise.resolve({ ...(answers ?? {}) })) as never)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    // Machine mode routes the progress lines to stderr: keep stdout to the JSON document.
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    process.chdir(originalCwd)
    await rm(projectDir, { recursive: true, force: true }).catch(() => {})
  })

  /**
   * A Claude Code + Codex harness one release behind: an outdated skill and its shared copy, a skill file the
   * new release adds, an older AGENTS.md region, outdated tier agents and host rule, and no Codex hooks yet.
   */
  async function installOutdatedHarness(): Promise<{ newSkillFile: string }> {
    const agents: ('claude-code' | 'codex')[] = ['claude-code', 'codex']
    const report = await installHarness({ targetPath: projectDir, projectName: 'acme', version: OLD_VERSION, agents })
    const hashes: Record<string, string> = { ...(await computeHarnessFileHashes(projectDir)), ...report?.fileHashes }

    const outdate = async (path: string) => {
      const content = `${await readFile(join(projectDir, path), 'utf8')}\nA line the previous release carried.\n`
      await writeFile(join(projectDir, path), content)
      hashes[path] = hashFileContent(content)
    }
    await outdate('.claude/skills/sf-git-commit/SKILL.md')
    await outdate('.agents/skills/sf-git-commit/SKILL.md')
    for (const path of ['.claude/agents/sf-fix.md', '.codex/agents/sf-fix.toml', '.claude/rules/claude-code.md']) await outdate(path)

    // A skill the new release adds: absent from both copies and from the baselines.
    const newSkillFile = '.claude/skills/sf-git-merge/SKILL.md'
    for (const dir of ['.claude/skills/sf-git-merge', '.agents/skills/sf-git-merge']) {
      await rm(join(projectDir, dir), { recursive: true })
      delete hashes[`${dir}/SKILL.md`]
    }

    const agentsMd = await readFile(join(projectDir, 'AGENTS.md'), 'utf8')
    const start = agentsMd.indexOf(GENERATED_REGION_START)
    const end = agentsMd.indexOf(GENERATED_REGION_END)
    await writeFile(join(projectDir, 'AGENTS.md'), `${agentsMd.slice(0, start)}${GENERATED_REGION_START}\nThe previous release's region.\n${agentsMd.slice(end)}`)
    await rm(join(projectDir, CODEX_HOOKS_PATH), { force: true })

    const manifest: SaaSFoundryManifest = {
      $schema: manifestSchemaUrl,
      manifestVersion: 2,
      version: OLD_VERSION,
      generatedAt: new Date().toISOString(),
      structure: 'cli',
      projectName: 'acme',
      mainBranch: 'main',
      language: { srs: 'en', tickets: 'en', codeComments: 'en' },
      modules: { harness: { version: harnessInstallerMeta.currentVersion, managed: true, agents } },
      fileHashes: hashes
    }
    await writeFile(join(projectDir, '.saasfoundry.json'), JSON.stringify(manifest, null, 2))
    return { newSkillFile }
  }

  it('lists the agent instructions, the tier agents, the Codex hooks and the manifest, and writes nothing', async () => {
    const { newSkillFile } = await installOutdatedHarness()
    const before = await snapshot(projectDir)

    let stdout = ''
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
      stdout += chunk
      return true
    }) as never)
    await updateCommand({ nonInteractive: true, dryRun: true, json: true })
    stdoutSpy.mockRestore()
    const report = JSON.parse(stdout) as UpdateDryRunReport

    expect(changedPaths(before, await snapshot(projectDir))).toEqual([])
    expect(report.harnessRefresh).toMatchObject({ status: 'would-apply', add: [newSkillFile] })
    expect(report.agentInstructions?.update).toEqual(
      expect.arrayContaining(['AGENTS.md', '.claude/rules/claude-code.md', '.claude/agents/sf-fix.md', '.codex/agents/sf-fix.toml', '.agents/skills/sf-git-commit/SKILL.md'])
    )
    // The shared copy of a file the harness refresh adds: only a render after the refresh sees it.
    expect(report.agentInstructions?.add).toEqual(expect.arrayContaining([CODEX_HOOKS_PATH, newSkillFile.replace('.claude/skills/', '.agents/skills/')]))
    expect(report.manifestWrites).toEqual([{ path: '.saasfoundry.json', changes: ['version', 'fileHashes'] }])
  })

  it('names exactly the files the real run then changes', async () => {
    await installOutdatedHarness()
    const before = await snapshot(projectDir)

    let stdout = ''
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
      stdout += chunk
      return true
    }) as never)
    await updateCommand({ nonInteractive: true, dryRun: true, json: true })
    stdoutSpy.mockRestore()
    const planned = plannedPaths(JSON.parse(stdout) as UpdateDryRunReport)

    await updateCommand({ nonInteractive: true })

    expect(changedPaths(before, await snapshot(projectDir))).toEqual(planned)
  })

  it('closes the real run with the agent instructions it wrote, counted per host', async () => {
    await installOutdatedHarness()

    await updateCommand({ nonInteractive: true })

    const lines = logSpy.mock.calls.map((call) => String(call[0]))
    expect(lines.some((line) => line.includes('Agent instructions refreshed:'))).toBe(true)
    const updated = lines.find((line) => /file\(s\) updated in place \(/.test(line))
    expect(updated).toMatch(/\.agents\/ \d+/)
    expect(updated).toMatch(/\.claude\/ \d+/)
    expect(updated).toMatch(/\.codex\/ \d+/)
    expect(updated).toMatch(/project \d+/)
  })
})
