import { link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

import { ADOPTION_COMMON_INSTRUCTIONS } from '../../../harness/agent-instructions'
import { CLAUDE_CAPTURE_COMMAND, CLAUDE_CAPTURE_HOOKS } from '../../../harness/delegation-hooks'
import {
  HARNESS_ALLOWED_COMMANDS,
  HARNESS_ASK_COMMANDS,
  HARNESS_HOOKS,
  claudeSettingsRoots,
  renderHarnessSettings,
  summarizeHarnessSettings,
  syncHarnessSettings,
  syncHarnessSettingsForProject
} from '../../../harness/harness-settings'
import type { SaaSFoundryManifest } from '../../../types'

const FIXTURES = join(__dirname, '../../fixtures/released-bridges')
const released = (version: string): Promise<string> => readFile(join(FIXTURES, version, 'settings.json'), 'utf8')
const ROOT = join(__dirname, '../../../..')

type Settings = { hooks?: Record<string, { matcher?: string; hooks: { command: string }[] }[]>; permissions?: { allow?: string[]; ask?: string[] }; [key: string]: unknown }
const rendered = (existing?: string): { content: string; changed: boolean } => {
  const result = renderHarnessSettings(existing)
  if ('error' in result) throw new Error(result.error)
  return result
}
const parsed = (existing?: string): Settings => JSON.parse(rendered(existing).content) as Settings

describe('renderHarnessSettings (#935)', () => {
  it('brings the settings of the 1.0.1 harness to the capture hooks and the delegation permissions, keeping what it had', async () => {
    const before = JSON.parse(await released('1.0.1')) as Settings
    const after = parsed(await released('1.0.1'))

    expect(after.hooks?.SessionStart).toEqual(before.hooks?.SessionStart)
    expect(after.hooks?.SubagentStop).toEqual(CLAUDE_CAPTURE_HOOKS.SubagentStop)
    expect(after.hooks?.PostToolUse).toEqual(CLAUDE_CAPTURE_HOOKS.PostToolUse)
    // Everything 1.0.1 allowed is still allowed, in its order, and the delegation rules come after.
    expect(after.permissions?.allow?.slice(0, before.permissions!.allow!.length)).toEqual(before.permissions?.allow)
    expect(after.permissions?.allow).toEqual(expect.arrayContaining(['Bash(sf agents route *)', 'Bash(sf agents delegation status)', 'Bash(sf agents routing report)']))
    expect(after.permissions?.ask).toEqual([...HARNESS_ASK_COMMANDS])
    expect(before.permissions?.ask).toBeUndefined()
  })

  it('brings the settings of the 1.0.0 harness there too, keeping its SRS prompt hook', async () => {
    const after = parsed(await released('1.0.0'))

    expect(after.hooks?.UserPromptSubmit).toEqual(JSON.parse(await released('1.0.0')).hooks.UserPromptSubmit)
    expect(after.hooks?.SubagentStop).toBeDefined()
    expect(after.permissions?.allow).toEqual([...HARNESS_ALLOWED_COMMANDS])
  })

  it('writes the harness settings when there is no file', () => {
    const result = rendered(undefined)
    expect(result.changed).toBe(true)
    expect(JSON.parse(result.content)).toEqual({ hooks: HARNESS_HOOKS, permissions: { allow: [...HARNESS_ALLOWED_COMMANDS], ask: [...HARNESS_ASK_COMMANDS] } })
    expect(result.content.endsWith('\n')).toBe(true)
  })

  it('is idempotent: its own output has nothing left to add', () => {
    const first = rendered(undefined)
    const second = rendered(first.content)
    expect(second.changed).toBe(false)
    expect(second.content).toBe(first.content)
  })

  it('keeps the keys, the hooks and the rules the project wrote', () => {
    const own = {
      model: 'opus',
      env: { FOO: 'bar' },
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'echo hello' }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './check.sh' }] }],
        SubagentStop: [{ matcher: 'my-agent', hooks: [{ type: 'command', command: './mine.sh' }] }]
      },
      permissions: { allow: ['Bash(make test)'], deny: ['Bash(rm -rf *)'], ask: ['Bash(git push *)'] }
    }

    const after = parsed(JSON.stringify(own))

    expect(after.model).toBe('opus')
    expect(after.env).toEqual({ FOO: 'bar' })
    expect(after.hooks?.PreToolUse).toEqual(own.hooks.PreToolUse)
    expect(after.hooks?.SessionStart?.[0]).toEqual(own.hooks.SessionStart[0])
    expect(after.hooks?.SessionStart?.map((group) => group.hooks[0].command)).toContain('sf status --claude-friendly --no-network')
    expect(after.hooks?.SubagentStop?.[0]).toEqual(own.hooks.SubagentStop[0])
    expect(after.hooks?.SubagentStop?.some((group) => group.hooks.some((hook) => hook.command === CLAUDE_CAPTURE_COMMAND))).toBe(true)
    expect(after.permissions).toMatchObject({ deny: ['Bash(rm -rf *)'] })
    expect(after.permissions?.allow?.[0]).toBe('Bash(make test)')
    expect(after.permissions?.ask?.slice(0, 1)).toEqual(['Bash(git push *)'])
  })

  it('replaces the bare-sf capture command the first build wrote, and nothing else', () => {
    const legacy = { hooks: { SubagentStop: [{ matcher: 'sf-.*', hooks: [{ type: 'command', command: 'sf agents outcome capture --host claude-code' }] }] } }

    const after = parsed(JSON.stringify(legacy))

    const commands = (after.hooks?.SubagentStop ?? []).flatMap((group) => group.hooks.map((hook) => hook.command))
    expect(commands).toEqual([CLAUDE_CAPTURE_COMMAND])
  })

  it('says why text that is not a JSON object cannot be merged, and never throws', () => {
    expect(renderHarnessSettings('{ "hooks": ')).toEqual({ error: 'is not valid JSON' })
    expect(renderHarnessSettings('[]')).toEqual({ error: 'is not a JSON object' })
    expect(renderHarnessSettings('null')).toEqual({ error: 'is not a JSON object' })
    expect(renderHarnessSettings('{ "hooks": [] }')).toEqual(expect.objectContaining({ content: expect.any(String) }))
    expect(renderHarnessSettings('{ "hooks": { "SubagentStop": "nope" } }')).toEqual({ error: expect.stringContaining('shape') })
  })

  it('treats an empty file as no file', () => {
    expect(rendered('').changed).toBe(true)
    expect(rendered('  \n').content).toBe(rendered(undefined).content)
  })

  // The scaffold templates (#935): the three `settings.json` a generated project starts from carry the same hooks
  // and rules as an installed one. Compared as JSON: Prettier lays the arrays out its own way.
  it.each(['scaffolds/overlays/monorepo/root/.claude/settings.json', 'scaffolds/blueprints/api/.claude/settings.json', 'scaffolds/blueprints/web/.claude/settings.json'])(
    'is what the scaffold template %s holds',
    async (template) => {
      const content = await readFile(join(ROOT, template), 'utf8')
      expect(JSON.parse(content)).toEqual(JSON.parse(rendered(undefined).content))
      // A project that starts from the template needs nothing from the first update.
      expect(rendered(content).changed).toBe(false)
    }
  )
})

describe('syncHarnessSettings (#935)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sf-harness-settings-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const put = async (path: string, content: string): Promise<void> => {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), content)
  }
  const read = (path: string): Promise<string> => readFile(join(dir, path), 'utf8')
  const SETTINGS = '.claude/settings.json'
  const SIDECAR = '.claude/settings.json.saasfoundry.new'

  it('creates the file, and its directory, in a project that has none', async () => {
    const result = await syncHarnessSettings(dir)

    expect(result).toEqual({ path: SETTINGS, status: 'created' })
    expect(JSON.parse(await read(SETTINGS))).toEqual(JSON.parse(rendered(undefined).content))
  })

  it('merges into a project’s file and keeps everything it had', async () => {
    await put(SETTINGS, JSON.stringify({ model: 'opus', permissions: { allow: ['Bash(make test)'] } }, null, 2))

    const result = await syncHarnessSettings(dir)

    expect(result).toEqual({ path: SETTINGS, status: 'merged' })
    const settings = JSON.parse(await read(SETTINGS)) as Settings
    expect(settings.model).toBe('opus')
    expect(settings.permissions?.allow?.[0]).toBe('Bash(make test)')
    expect(settings.hooks?.SubagentStop).toBeDefined()
  })

  it('does not rewrite a file with nothing to add: bytes and modification time stay', async () => {
    await put(SETTINGS, rendered(undefined).content.replace(/\n$/, '').replaceAll('  ', '    '))
    const before = await stat(join(dir, SETTINGS))
    const bytes = await read(SETTINGS)

    const result = await syncHarnessSettings(dir)

    expect(result).toEqual({ path: SETTINGS, status: 'unchanged' })
    expect(await read(SETTINGS)).toBe(bytes)
    expect((await stat(join(dir, SETTINGS))).mtimeMs).toBe(before.mtimeMs)
  })

  it('writes nothing the second time', async () => {
    await put(SETTINGS, await released('1.0.1'))
    expect((await syncHarnessSettings(dir)).status).toBe('merged')
    const once = await read(SETTINGS)
    const mtime = (await stat(join(dir, SETTINGS))).mtimeMs

    expect((await syncHarnessSettings(dir)).status).toBe('unchanged')

    expect(await read(SETTINGS)).toBe(once)
    expect((await stat(join(dir, SETTINGS))).mtimeMs).toBe(mtime)
  })

  it('leaves text that is not JSON as it is and proposes the harness settings beside it', async () => {
    const broken = '{ "hooks": // my notes\n'
    await put(SETTINGS, broken)

    const result = await syncHarnessSettings(dir)

    expect(result).toEqual({ path: SETTINGS, status: 'sidecar', sidecar: SIDECAR, reason: 'is not valid JSON' })
    expect(await read(SETTINGS)).toBe(broken)
    expect(JSON.parse(await read(SIDECAR))).toEqual(JSON.parse(rendered(undefined).content))
  })

  it('leaves a symbolic link as it is, proposes the merged settings of what it leads to, and writes through nothing', async () => {
    await put('shared/settings.json', JSON.stringify({ model: 'opus' }))
    await mkdir(join(dir, '.claude'), { recursive: true })
    await symlink(join(dir, 'shared/settings.json'), join(dir, SETTINGS))

    const result = await syncHarnessSettings(dir)

    expect(result).toEqual({ path: SETTINGS, status: 'sidecar', sidecar: SIDECAR, reason: 'is a symbolic link' })
    expect(await read('shared/settings.json')).toBe(JSON.stringify({ model: 'opus' }))
    expect(JSON.parse(await read(SIDECAR)).model).toBe('opus')
    expect(JSON.parse(await read(SIDECAR)).hooks.SubagentStop).toBeDefined()
  })

  it('has nothing to propose for a link whose target already carries everything', async () => {
    await put('shared/settings.json', rendered(undefined).content)
    await mkdir(join(dir, '.claude'), { recursive: true })
    await symlink(join(dir, 'shared/settings.json'), join(dir, SETTINGS))

    expect(await syncHarnessSettings(dir)).toEqual({ path: SETTINGS, status: 'unchanged' })
    await expect(stat(join(dir, SIDECAR))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('leaves a hard-linked file as it is, since a write would change its other name', async () => {
    await put('shared/settings.json', JSON.stringify({ model: 'opus' }))
    await mkdir(join(dir, '.claude'), { recursive: true })
    await link(join(dir, 'shared/settings.json'), join(dir, SETTINGS))

    const result = await syncHarnessSettings(dir)

    expect(result).toMatchObject({ status: 'sidecar', reason: 'is a hard-linked file' })
    expect(await read('shared/settings.json')).toBe(JSON.stringify({ model: 'opus' }))
  })

  it('skips a linked .claude directory: nothing is written through it', async () => {
    await mkdir(join(dir, 'elsewhere'), { recursive: true })
    await symlink(join(dir, 'elsewhere'), join(dir, '.claude'))

    const result = await syncHarnessSettings(dir)

    expect(result).toMatchObject({ path: SETTINGS, status: 'skipped' })
    await expect(stat(join(dir, 'elsewhere/settings.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('skips a directory that stands where the file should be', async () => {
    await mkdir(join(dir, SETTINGS), { recursive: true })
    expect(await syncHarnessSettings(dir)).toEqual({ path: SETTINGS, status: 'skipped', reason: 'is not a regular file' })
  })

  it('refuses to write the proposal through a link', async () => {
    await put(SETTINGS, '{')
    await put('elsewhere.txt', 'precious')
    await symlink(join(dir, 'elsewhere.txt'), join(dir, SIDECAR))

    const result = await syncHarnessSettings(dir)

    expect(result.status).toBe('skipped')
    expect(await read('elsewhere.txt')).toBe('precious')
  })

  it('writes nothing in a dry run and says what it would do', async () => {
    await put('b/.claude/settings.json', '{')
    await put('a/.claude/settings.json', await released('1.0.1'))

    expect(await syncHarnessSettings(dir, 'a', { dryRun: true })).toEqual({ path: `a/${SETTINGS}`, status: 'merged' })
    expect(await syncHarnessSettings(dir, 'b', { dryRun: true })).toMatchObject({ status: 'sidecar', sidecar: `b/${SIDECAR}` })
    expect(await syncHarnessSettings(dir, 'c', { dryRun: true })).toEqual({ path: `c/${SETTINGS}`, status: 'created' })

    expect(await read(`a/${SETTINGS}`)).toBe(await released('1.0.1'))
    await expect(stat(join(dir, `b/${SIDECAR}`))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(dir, 'c'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('names the paths relative to the project for a root other than the project root', async () => {
    const result = await syncHarnessSettings(dir, 'apps/acme-api')
    expect(result.path).toBe('apps/acme-api/.claude/settings.json')
    expect(JSON.parse(await read(result.path))).toBeDefined()
  })

  it('summarises what changed and what needs the developer, and says nothing of a file already current', () => {
    const lines = summarizeHarnessSettings([
      { path: SETTINGS, status: 'merged' },
      { path: 'apps/a/.claude/settings.json', status: 'unchanged' },
      { path: 'apps/b/.claude/settings.json', status: 'sidecar', sidecar: 'apps/b/.claude/settings.json.saasfoundry.new', reason: 'is not valid JSON' }
    ])

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ needsAttention: false, text: expect.stringContaining('merged in') })
    expect(lines[1]).toMatchObject({ needsAttention: true, text: expect.stringContaining('apps/b/.claude/settings.json.saasfoundry.new') })
    expect(summarizeHarnessSettings([{ path: SETTINGS, status: 'merged' }], { dryRun: true })[0].text).toContain('would be merged in')
  })
})

describe('claudeSettingsRoots (#935)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sf-harness-roots-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const manifest = (overrides: Partial<SaaSFoundryManifest> = {}): SaaSFoundryManifest => ({
    version: '1.0.1',
    generatedAt: '2026-10-12T00:00:00Z',
    structure: 'cli',
    projectName: 'acme',
    modules: { harness: { version: 4, managed: true } },
    fileHashes: {},
    ...overrides
  })

  it('is the project root for a harness that declares no agents: legacy projects are Claude Code’s', async () => {
    expect(await claudeSettingsRoots(dir, manifest())).toEqual(['.'])
  })

  it('is the project root when Claude Code is declared among others, and nothing when it is not', async () => {
    expect(await claudeSettingsRoots(dir, manifest({ modules: { harness: { version: 4, managed: true, agents: ['codex', 'claude-code'] } } }))).toEqual(['.'])
    expect(await claudeSettingsRoots(dir, manifest({ modules: { harness: { version: 4, managed: true, agents: ['codex'] } } }))).toEqual([])
  })

  it('is nothing without a harness, and nothing for a harness that is not managed', async () => {
    expect(await claudeSettingsRoots(dir, manifest({ modules: undefined }))).toEqual([])
    expect(await claudeSettingsRoots(dir, manifest({ modules: { harness: { version: 1, managed: false } } }))).toEqual([])
  })

  it('is nothing for a reference-only adoption, whose instructions ask the agent not to change settings', async () => {
    await writeFile(join(dir, 'CLAUDE.md'), '# Mine\n')
    await writeFile(join(dir, 'AGENTS.md'), ADOPTION_COMMON_INSTRUCTIONS)
    expect(await claudeSettingsRoots(dir, manifest())).toEqual([])
  })

  it('is nothing for an adoption whose baseline the manifest recorded, even before the file is read', async () => {
    const { createHash } = await import('crypto')
    const hash = createHash('sha256')
      .update(await readFile(join(FIXTURES, '1.0.1', 'AGENTS.adoption.md')))
      .digest('hex')
    expect(await claudeSettingsRoots(dir, manifest({ fileHashes: { 'AGENTS.md': hash } }))).toEqual([])
  })

  it('is the root of a monorepo only: it has a single .claude', async () => {
    await mkdir(join(dir, 'apps/api/.claude'), { recursive: true })
    expect(await claudeSettingsRoots(dir, manifest({ structure: 'monorepo' }))).toEqual(['.'])
  })

  it('is each repository of a multirepo project that has a .claude, and not one without', async () => {
    await mkdir(join(dir, 'apps/acme-api/.claude'), { recursive: true })
    await mkdir(join(dir, 'apps/acme-web'), { recursive: true })
    await mkdir(join(dir, '.claude'), { recursive: true })

    expect(await claudeSettingsRoots(dir, manifest({ structure: 'multirepo' }))).toEqual(['.', 'apps/acme-api'])
  })

  it('syncs every one of its roots', async () => {
    await mkdir(join(dir, '.claude'), { recursive: true })
    await mkdir(join(dir, 'apps/acme-api/.claude'), { recursive: true })

    const results = await syncHarnessSettingsForProject(dir, manifest({ structure: 'multirepo' }))

    expect(results.map((result) => [result.path, result.status])).toEqual([
      ['.claude/settings.json', 'created'],
      ['apps/acme-api/.claude/settings.json', 'created']
    ])
  })
})
