import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

import { ADOPTION_COMMON_INSTRUCTIONS } from '../../../harness/agent-instructions'
import { syncHarnessSettingsForProject } from '../../../harness/harness-settings'
import { dropPerAppClaudeInMonorepo, dropStackSkillsWithoutStack, harnessMigrations, wireDelegationCapture } from '../../../installers/harness.migrations'
import { harnessInstallerMeta } from '../../../installers/harness.installer'
import type { SaaSFoundryManifest } from '../../../types'
import { hashFileContent } from '../../../utils'

const SKILL = '.claude/skills/sf-integration-rules'
const MIRROR = '.agents/skills/sf-integration-rules'

// #831 — harness v1 deposited the stack's integration grammar on every project
describe('harness migration v1 → v2: drop-stack-skills-without-stack', () => {
  let dir: string
  let logSpy: jest.SpyInstance

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sf-harness-migration-'))
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(async () => {
    logSpy.mockRestore()
    await rm(dir, { recursive: true, force: true })
  })

  /** Writes each file and records it in fileHashes, as a harness v1 deposit leaves it. */
  const deposit = async (files: Record<string, string>): Promise<Record<string, string>> => {
    const hashes: Record<string, string> = {}
    for (const [relPath, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, relPath)), { recursive: true })
      await writeFile(join(dir, relPath), content)
      hashes[relPath] = hashFileContent(content)
    }
    return hashes
  }

  const harnessManifest = (fileHashes: Record<string, string>): SaaSFoundryManifest => ({
    version: '1.0.0',
    generatedAt: '2026-10-02T00:00:00Z',
    structure: 'cli',
    projectName: 'external',
    modules: { harness: { version: 1, managed: true } },
    workflow: { tool: 'github-projects' },
    fileHashes
  })

  const output = () => logSpy.mock.calls.flat().join('\n')

  it('is the start of the harness chain', () => {
    expect(harnessMigrations.slice(0, 2)).toEqual([dropStackSkillsWithoutStack, dropPerAppClaudeInMonorepo])
    expect(dropStackSkillsWithoutStack).toMatchObject({ from: 1, to: 2 })
    expect(harnessInstallerMeta).toMatchObject({ currentVersion: 5, migrations: harnessMigrations })
  })

  it('removes the untouched deposit and its mirror, and their fileHashes entries', async () => {
    const hashes = await deposit({
      [`${SKILL}/SKILL.md`]: 'rules\n',
      [`${SKILL}/backend.md`]: 'backend\n',
      [`${MIRROR}/SKILL.md`]: 'rules\n',
      '.claude/skills/sf-git-commit/SKILL.md': 'commit\n'
    })
    const manifest = harnessManifest(hashes)

    await dropStackSkillsWithoutStack.up(dir, manifest)

    expect(existsSync(join(dir, SKILL))).toBe(false)
    expect(existsSync(join(dir, MIRROR))).toBe(false)
    expect(Object.keys(manifest.fileHashes ?? {})).toEqual(['.claude/skills/sf-git-commit/SKILL.md'])
    expect(await readFile(join(dir, '.claude/skills/sf-git-commit/SKILL.md'), 'utf8')).toBe('commit\n')
    expect(output()).toContain('Removed 3 file(s) of sf-integration-rules')
  })

  it('keeps an edited copy and a file the harness never deposited, with the mirror of the kept copy', async () => {
    const hashes = await deposit({ [`${SKILL}/SKILL.md`]: 'rules\n', [`${SKILL}/backend.md`]: 'backend\n', [`${MIRROR}/SKILL.md`]: 'rules\n' })
    await writeFile(join(dir, `${SKILL}/SKILL.md`), 'rules, edited\n')
    await writeFile(join(dir, `${SKILL}/notes.md`), 'mine\n')
    const manifest = harnessManifest(hashes)

    await dropStackSkillsWithoutStack.up(dir, manifest)

    expect(await readFile(join(dir, `${SKILL}/SKILL.md`), 'utf8')).toBe('rules, edited\n')
    expect(await readFile(join(dir, `${SKILL}/notes.md`), 'utf8')).toBe('mine\n')
    expect(existsSync(join(dir, `${SKILL}/backend.md`))).toBe(false)
    expect(existsSync(join(dir, `${MIRROR}/SKILL.md`))).toBe(true)
    expect(manifest.fileHashes).toEqual({ [`${SKILL}/SKILL.md`]: hashes[`${SKILL}/SKILL.md`], [`${MIRROR}/SKILL.md`]: hashes[`${MIRROR}/SKILL.md`] })
    expect(output()).toContain(`• ${SKILL}/SKILL.md`)
    expect(output()).toContain(`• ${SKILL}/notes.md`)
    expect(output()).not.toContain(`• ${MIRROR}/SKILL.md`)
  })

  it('leaves untracked copies alone, as on a hand-curated repository', async () => {
    await deposit({ [`${SKILL}/SKILL.md`]: 'rules\n' })
    const manifest = harnessManifest({})

    await dropStackSkillsWithoutStack.up(dir, manifest)

    expect(existsSync(join(dir, `${SKILL}/SKILL.md`))).toBe(true)
  })

  it('never touches a project with a technical stack, nor a multirepo child', async () => {
    const files = { [`${SKILL}/SKILL.md`]: 'rules\n' }
    const stack: SaaSFoundryManifest = {
      ...harnessManifest(await deposit(files)),
      structure: 'monorepo',
      modules: { email: { provider: 'none', version: 1 }, s3Setup: 'manual', dbSetup: 'manual', includeAnalytics: false, advancedSkills: [], harness: { version: 1, managed: true } }
    }
    await dropStackSkillsWithoutStack.up(dir, stack)
    expect(existsSync(join(dir, `${SKILL}/SKILL.md`))).toBe(true)

    const child: SaaSFoundryManifest = { ...harnessManifest(await deposit(files)), projection: { kind: 'multirepo-child', rootProjectName: 'external', app: 'api' } }
    await dropStackSkillsWithoutStack.up(dir, child)
    expect(existsSync(join(dir, `${SKILL}/SKILL.md`))).toBe(true)
  })

  it('is idempotent', async () => {
    const manifest = harnessManifest(await deposit({ [`${SKILL}/SKILL.md`]: 'rules\n' }))
    await dropStackSkillsWithoutStack.up(dir, manifest)
    logSpy.mockClear()

    await dropStackSkillsWithoutStack.up(dir, manifest)

    expect(manifest.fileHashes).toEqual({})
    expect(output()).toBe('')
  })
})

// #425 — a monorepo has one .claude/, at its root
describe('harness migration v2 → v3: drop-per-app-claude-in-monorepo', () => {
  const FIXTURES = join(__dirname, '../../fixtures/per-app-claude')
  let dir: string
  let logSpy: jest.SpyInstance

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sf-harness-migration-'))
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(async () => {
    logSpy.mockRestore()
    await rm(dir, { recursive: true, force: true })
  })

  /** Copies the per-app files a blueprint shipped into each app. The fixtures are `.txt` so that no formatter changes their bytes. */
  const shipped = async (apps: string[]): Promise<void> => {
    for (const app of apps) {
      await mkdir(join(dir, app, '.claude'), { recursive: true })
      for (const name of ['settings.json', 'README.md']) await writeFile(join(dir, app, '.claude', name), await readFile(join(FIXTURES, `${name}.txt`)))
    }
  }

  const manifest = (structure: SaaSFoundryManifest['structure']): SaaSFoundryManifest => ({
    version: '1.0.0',
    generatedAt: '2026-10-08T00:00:00Z',
    structure,
    projectName: 'acme',
    modules: { harness: { version: 2, managed: true } }
  })

  it('follows the stack-skills migration', () => {
    expect(dropPerAppClaudeInMonorepo).toMatchObject({ from: 2, to: 3 })
  })

  it('removes the untouched per-app .claude of a monorepo', async () => {
    await shipped(['apps/api', 'apps/web'])
    await dropPerAppClaudeInMonorepo.up(dir, manifest('monorepo'))
    expect(existsSync(join(dir, 'apps/api/.claude'))).toBe(false)
    expect(existsSync(join(dir, 'apps/web/.claude'))).toBe(false)
  })

  it('keeps and reports an edited or added file', async () => {
    await shipped(['apps/api'])
    await writeFile(join(dir, 'apps/api/.claude/settings.json'), '{ "hooks": {} }\n')
    await writeFile(join(dir, 'apps/api/.claude/notes.md'), 'mine\n')
    await dropPerAppClaudeInMonorepo.up(dir, manifest('monorepo'))
    expect(existsSync(join(dir, 'apps/api/.claude/README.md'))).toBe(false)
    expect(await readFile(join(dir, 'apps/api/.claude/settings.json'), 'utf8')).toBe('{ "hooks": {} }\n')
    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('apps/api/.claude/settings.json')
    expect(output).toContain('apps/api/.claude/notes.md')
  })

  it('leaves a multirepo alone', async () => {
    await shipped(['apps/api'])
    await dropPerAppClaudeInMonorepo.up(dir, manifest('multirepo'))
    expect(existsSync(join(dir, 'apps/api/.claude/settings.json'))).toBe(true)
  })

  it('is idempotent', async () => {
    await shipped(['apps/web'])
    await dropPerAppClaudeInMonorepo.up(dir, manifest('monorepo'))
    await expect(dropPerAppClaudeInMonorepo.up(dir, manifest('monorepo'))).resolves.toBeUndefined()
  })
})

// #935 — a harness installed before the delegation routing never had its capture hooks in .claude/settings.json
describe('harness migration v4 → v5: wire-delegation-capture', () => {
  let dir: string
  let logSpy: jest.SpyInstance

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sf-harness-wire-capture-'))
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(async () => {
    logSpy.mockRestore()
    await rm(dir, { recursive: true, force: true })
  })

  const SETTINGS = '.claude/settings.json'
  const put = async (path: string, content: string): Promise<void> => {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), content)
  }
  const read = (path: string): Promise<string> => readFile(join(dir, path), 'utf8')
  const output = (): string => logSpy.mock.calls.flat().join('\n')
  const v101 = (): Promise<string> => readFile(join(__dirname, '../../fixtures/released-bridges/1.0.1/settings.json'), 'utf8')

  const manifest = (overrides: Partial<SaaSFoundryManifest> = {}): SaaSFoundryManifest => ({
    version: '1.0.1',
    generatedAt: '2026-10-12T00:00:00Z',
    structure: 'cli',
    projectName: 'acme',
    modules: { harness: { version: 4, managed: true } },
    fileHashes: {},
    ...overrides
  })

  it('follows the CLAUDE.md move and ends the chain at the installer version', () => {
    expect(harnessMigrations.at(-1)).toBe(wireDelegationCapture)
    expect(wireDelegationCapture).toMatchObject({ from: 4, to: 5, name: 'wire-delegation-capture' })
    expect(harnessInstallerMeta.currentVersion).toBe(wireDelegationCapture.to)
  })

  it('merges the capture hooks and the delegation permissions into the settings a 1.0.1 harness left', async () => {
    await put(SETTINGS, await v101())

    await wireDelegationCapture.up(dir, manifest())

    const settings = JSON.parse(await read(SETTINGS))
    expect(settings.hooks.SessionStart).toEqual(JSON.parse(await v101()).hooks.SessionStart)
    expect(settings.hooks.SubagentStop[0].matcher).toBe('sf-.*')
    expect(settings.hooks.PostToolUse[0].matcher).toBe('Agent|Task')
    expect(settings.permissions.allow).toEqual(expect.arrayContaining([...JSON.parse(await v101()).permissions.allow, 'Bash(sf agents route *)', 'Bash(sf agents routing report)']))
    expect(settings.permissions.ask).toEqual(expect.arrayContaining(['Bash(sf agents route --record*)', 'Bash(sf agents route * --retry-of*)']))
    expect(output()).toContain('.claude/settings.json: delegation capture hooks and harness permissions merged in')
  })

  it('keeps the keys, hooks and rules the project added', async () => {
    const own = { model: 'opus', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './check.sh' }] }] }, permissions: { allow: ['Bash(make test)'], deny: ['Bash(rm *)'] } }
    await put(SETTINGS, JSON.stringify(own))

    await wireDelegationCapture.up(dir, manifest())

    const settings = JSON.parse(await read(SETTINGS))
    expect(settings.model).toBe('opus')
    expect(settings.hooks.PreToolUse).toEqual(own.hooks.PreToolUse)
    expect(settings.permissions.deny).toEqual(['Bash(rm *)'])
    expect(settings.permissions.allow[0]).toBe('Bash(make test)')
  })

  it('leaves a settings file that is not JSON as it is and writes the proposal beside it', async () => {
    await put(SETTINGS, '{ "hooks": ')

    await wireDelegationCapture.up(dir, manifest())

    expect(await read(SETTINGS)).toBe('{ "hooks": ')
    expect(JSON.parse(await read(`${SETTINGS}.saasfoundry.new`)).hooks.SubagentStop).toBeDefined()
    expect(output()).toContain('.claude/settings.json is not valid JSON')
    expect(output()).toContain('.claude/settings.json.saasfoundry.new')
  })

  // Review of #935, row 1: this one-shot step, like `sf agents refresh`, takes the two pre-release rules away,
  // and says which; the every-update merge never does
  it('removes the two pre-release evidence rules once, and names each one it removes', async () => {
    await put(SETTINGS, JSON.stringify({ permissions: { allow: ['Bash(make test)', 'Bash(sf agents outcome mark *)', 'Bash(sf agents outcome record *)'] } }))

    await wireDelegationCapture.up(dir, manifest())

    const allow: string[] = JSON.parse(await read(SETTINGS)).permissions.allow
    expect(allow).toContain('Bash(make test)')
    expect(allow).not.toContain('Bash(sf agents outcome mark *)')
    expect(allow).not.toContain('Bash(sf agents outcome record *)')
    expect(output()).toContain('.claude/settings.json: removed the rule Bash(sf agents outcome mark *)')
    expect(output()).toContain('.claude/settings.json: removed the rule Bash(sf agents outcome record *)')
    expect(output()).toContain('your own keys, hooks and rules are kept, except the rule named below')
  })

  it('previews the rules it would remove', async () => {
    await put(SETTINGS, JSON.stringify({ permissions: { allow: ['Bash(sf agents outcome mark *)'] } }))

    const [entry] = await wireDelegationCapture.preview!(dir, manifest())

    expect(entry).toMatchObject({ action: 'merge', source: SETTINGS, reason: expect.stringContaining('Bash(sf agents outcome mark *)') })
    expect(JSON.parse(await read(SETTINGS)).permissions.allow).toContain('Bash(sf agents outcome mark *)')
  })

  it('removes a rule once: a project that adds one back after the migration keeps it through every later run', async () => {
    await put(SETTINGS, JSON.stringify({ permissions: { allow: ['Bash(sf agents outcome mark *)'] } }))
    await wireDelegationCapture.up(dir, manifest())
    const settings = JSON.parse(await read(SETTINGS))
    settings.permissions.allow.push('Bash(sf agents outcome mark *)')
    await put(SETTINGS, JSON.stringify(settings))

    const results = await syncHarnessSettingsForProject(dir, manifest())

    expect(results).toEqual([{ path: SETTINGS, status: 'unchanged' }])
    expect(JSON.parse(await read(SETTINGS)).permissions.allow).toContain('Bash(sf agents outcome mark *)')
  })

  // Review of #935, rows 2 and 3
  it.each([
    ['a hooks that is an array', '{ "hooks": [] }', '.claude/settings.json has `hooks` that is not an object'],
    ['a permissions.allow that is a string', '{ "permissions": { "allow": "Bash(npm test)" } }', '.claude/settings.json has `permissions.allow` that is not an array']
  ])('leaves %s as it is and writes the proposal beside it', async (_name, text, message) => {
    await put(SETTINGS, text)

    await wireDelegationCapture.up(dir, manifest())

    expect(await read(SETTINGS)).toBe(text)
    expect(JSON.parse(await read(`${SETTINGS}.saasfoundry.new`)).hooks.SubagentStop).toBeDefined()
    expect(output()).toContain(message)
  })

  it('is idempotent: the second run writes nothing and says nothing', async () => {
    await put(SETTINGS, await v101())
    await wireDelegationCapture.up(dir, manifest())
    const once = await read(SETTINGS)
    logSpy.mockClear()

    await wireDelegationCapture.up(dir, manifest())

    expect(await read(SETTINGS)).toBe(once)
    expect(output()).toBe('')
  })

  it('creates the settings of a harness that has none', async () => {
    await wireDelegationCapture.up(dir, manifest())
    expect(JSON.parse(await read(SETTINGS)).hooks.SubagentStop).toBeDefined()
  })

  it('leaves alone a harness that declares no Claude Code, one that is not managed, and a reference-only adoption', async () => {
    await put(SETTINGS, await v101())
    const untouched = await v101()

    await wireDelegationCapture.up(dir, manifest({ modules: { harness: { version: 4, managed: true, agents: ['codex'] } } }))
    await wireDelegationCapture.up(dir, manifest({ modules: { harness: { version: 4, managed: false } } }))
    await put('CLAUDE.md', '# Mine\n')
    await put('AGENTS.md', ADOPTION_COMMON_INSTRUCTIONS)
    await wireDelegationCapture.up(dir, manifest())

    expect(await read(SETTINGS)).toBe(untouched)
  })

  it('covers each repository of a multirepo project, and the root of a monorepo only', async () => {
    await put('.claude/settings.json', await v101())
    await put('apps/acme-api/.claude/settings.json', await v101())
    await put('apps/acme-web/.claude/settings.json', await v101())
    await put('apps/api/.claude/settings.json', await v101())

    await wireDelegationCapture.up(dir, manifest({ structure: 'multirepo' }))
    for (const path of ['.claude', 'apps/acme-api/.claude', 'apps/acme-web/.claude']) expect(JSON.parse(await read(`${path}/settings.json`)).hooks.SubagentStop).toBeDefined()
    expect(await read('apps/api/.claude/settings.json')).toBe(await v101())

    await put('.claude/settings.json', await v101())
    await wireDelegationCapture.up(dir, manifest({ structure: 'monorepo' }))
    expect(JSON.parse(await read('.claude/settings.json')).hooks.SubagentStop).toBeDefined()
    expect(await read('apps/api/.claude/settings.json')).toBe(await v101())
  })

  it('never writes the delegation consent: only the developer’s own answer records it', async () => {
    const m = manifest()
    await wireDelegationCapture.up(dir, m)
    expect(m.modules?.harness).toEqual({ version: 4, managed: true })
  })

  it('points to the refresh for a Codex setup the manifest does not know', async () => {
    await mkdir(join(dir, '.codex'), { recursive: true })
    await wireDelegationCapture.up(dir, manifest())
    expect(output()).toContain('sf agents refresh')
    logSpy.mockClear()

    await wireDelegationCapture.up(dir, manifest({ modules: { harness: { version: 4, managed: true, agents: ['claude-code', 'codex'] } } }))
    expect(output()).not.toContain('sf agents refresh')
  })

  it('previews the file it would merge and writes nothing', async () => {
    await put(SETTINGS, await v101())

    const preview = await wireDelegationCapture.preview!(dir, manifest())

    expect(preview).toEqual([{ action: 'merge', source: SETTINGS, reason: expect.stringContaining('delegation capture hooks') }])
    expect(await read(SETTINGS)).toBe(await v101())
  })

  it('previews a file it would leave as it is, and the proposal it would write', async () => {
    await put(SETTINGS, '{')

    const preview = await wireDelegationCapture.preview!(dir, manifest())

    expect(preview).toEqual([{ action: 'propose', source: SETTINGS, target: `${SETTINGS}.saasfoundry.new`, reason: expect.stringContaining('is not valid JSON') }])
    expect(existsSync(join(dir, `${SETTINGS}.saasfoundry.new`))).toBe(false)
  })

  it('previews nothing for a project that is up to date', async () => {
    await wireDelegationCapture.up(dir, manifest())
    expect(await wireDelegationCapture.preview!(dir, manifest())).toEqual([])
  })
})
