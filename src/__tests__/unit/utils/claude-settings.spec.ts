import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  ClaudeHooksConfig,
  ClaudeSettingsShapeError,
  SRS_INTENT_HOOK_COMMAND,
  mergeClaudeSettingsHooks,
  mergeClaudeSettingsPermissions,
  mergeHooksInto,
  mergePermissionsInto,
  reconcileSrsIntentHook
} from '../../../utils/claude-settings'

const HARNESS_HOOKS: ClaudeHooksConfig = {
  SessionStart: [{ hooks: [{ type: 'command', command: 'sf status --claude-friendly --no-network' }] }],
  UserPromptSubmit: [{ hooks: [{ type: 'command', command: '.claude/skills/sf-srs/scripts/srs-intent-hook.sh' }] }]
}

describe('mergeClaudeSettingsHooks', () => {
  let dir: string

  beforeEach(async () => {
    dir = join(tmpdir(), `sf-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(dir, { recursive: true })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  const readSettings = async () => JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf8'))

  it('creates .claude/settings.json with the hooks when none exists', async () => {
    await mergeClaudeSettingsHooks(dir, HARNESS_HOOKS)

    const settings = await readSettings()
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe('sf status --claude-friendly --no-network')
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('srs-intent-hook.sh')
  })

  it('preserves unrelated settings keys and existing hooks', async () => {
    await mkdir(join(dir, '.claude'), { recursive: true })
    await writeFile(
      join(dir, '.claude', 'settings.json'),
      JSON.stringify({
        permissions: { allow: ['Bash(npm test)'] },
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo hello' }] }] }
      })
    )

    await mergeClaudeSettingsHooks(dir, HARNESS_HOOKS)

    const settings = await readSettings()
    expect(settings.permissions).toEqual({ allow: ['Bash(npm test)'] })
    const sessionCommands = settings.hooks.SessionStart.flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command))
    expect(sessionCommands).toEqual(['echo hello', 'sf status --claude-friendly --no-network'])
  })

  it('is idempotent — running twice never duplicates a hook', async () => {
    await mergeClaudeSettingsHooks(dir, HARNESS_HOOKS)
    await mergeClaudeSettingsHooks(dir, HARNESS_HOOKS)

    const settings = await readSettings()
    const allCommands = Object.values(settings.hooks as Record<string, { hooks: { command: string }[] }[]>)
      .flat()
      .flatMap((g) => g.hooks.map((h) => h.command))
    expect(allCommands.sort()).toEqual(['.claude/skills/sf-srs/scripts/srs-intent-hook.sh', 'sf status --claude-friendly --no-network'])
  })

  it('adds only the missing commands of a partially-present group', async () => {
    await mkdir(join(dir, '.claude'), { recursive: true })
    await writeFile(join(dir, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'sf status --claude-friendly --no-network' }] }] } }))

    await mergeClaudeSettingsHooks(dir, HARNESS_HOOKS)

    const settings = await readSettings()
    expect(settings.hooks.SessionStart).toHaveLength(1)
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1)
  })
})

describe('reconcileSrsIntentHook', () => {
  let dir: string

  beforeEach(async () => {
    dir = join(tmpdir(), `sf-srs-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(dir, { recursive: true })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  const readSettings = async () => JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf8'))

  it('does not register the hook when the SRS skill is absent', async () => {
    await mergeClaudeSettingsHooks(dir, { SessionStart: [{ hooks: [{ type: 'command', command: 'sf status' }] }] })
    await reconcileSrsIntentHook(dir, true)

    const settings = await readSettings()
    expect(settings.hooks.UserPromptSubmit).toBeUndefined()
  })

  it('registers the hook once after the SRS skill is installed', async () => {
    await mkdir(join(dir, '.claude', 'skills', 'sf-srs', 'scripts'), { recursive: true })
    await writeFile(join(dir, SRS_INTENT_HOOK_COMMAND), '#!/bin/sh\n')
    await reconcileSrsIntentHook(dir, true)
    await reconcileSrsIntentHook(dir, true)

    const settings = await readSettings()
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1)
    expect(settings.hooks.UserPromptSubmit[0].hooks).toEqual([{ type: 'command', command: SRS_INTENT_HOOK_COMMAND }])
  })

  it('removes only the managed hook when SRS is disabled', async () => {
    await mkdir(join(dir, '.claude'), { recursive: true })
    await writeFile(
      join(dir, '.claude', 'settings.json'),
      JSON.stringify({
        permissions: { allow: ['Bash(npm test)'] },
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: 'sf status' }] }],
          UserPromptSubmit: [
            {
              hooks: [
                { type: 'command', command: 'echo user-hook' },
                { type: 'command', command: SRS_INTENT_HOOK_COMMAND }
              ]
            },
            { matcher: 'other', hooks: [{ type: 'command', command: SRS_INTENT_HOOK_COMMAND }] }
          ]
        }
      })
    )

    await reconcileSrsIntentHook(dir, false)

    const settings = await readSettings()
    expect(settings.permissions).toEqual({ allow: ['Bash(npm test)'] })
    expect(settings.hooks.SessionStart).toHaveLength(1)
    expect(settings.hooks.UserPromptSubmit).toEqual([{ hooks: [{ type: 'command', command: 'echo user-hook' }] }])
  })
})

describe('scaffold Claude settings', () => {
  it.each(['blueprints/api', 'blueprints/web', 'overlays/monorepo/root'])('does not register SRS before opt-in in %s', async (scaffold) => {
    const path = join(process.cwd(), 'scaffolds', scaffold, '.claude', 'settings.json')
    const settings = JSON.parse(await readFile(path, 'utf8'))
    expect(settings.hooks.SessionStart).toBeDefined()
    expect(settings.hooks.UserPromptSubmit).toBeUndefined()
  })

  // #935 — the templates carry the harness hooks, the same ones an installed project is brought to
  it.each(['blueprints/api', 'blueprints/web', 'overlays/monorepo/root'])('registers the delegation capture hooks in %s', async (scaffold) => {
    const path = join(process.cwd(), 'scaffolds', scaffold, '.claude', 'settings.json')
    const settings = JSON.parse(await readFile(path, 'utf8'))
    expect(settings.hooks.SubagentStop[0].matcher).toBe('sf-.*')
    expect(settings.hooks.PostToolUse[0].matcher).toBe('Agent|Task')
  })
})

describe('reconcileSrsIntentHook on a file that is not JSON (#935)', () => {
  it('leaves it alone instead of stopping the update: the harness settings merge reports it', async () => {
    const dir = join(tmpdir(), `sf-settings-broken-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(dir, '.claude'), { recursive: true })
    await writeFile(join(dir, '.claude', 'settings.json'), '{ "hooks": // mine\n')

    await expect(reconcileSrsIntentHook(dir, true)).resolves.toBeUndefined()

    expect(await readFile(join(dir, '.claude', 'settings.json'), 'utf8')).toBe('{ "hooks": // mine\n')
    await rm(dir, { recursive: true, force: true })
  })
})

describe('mergePermissionsInto', () => {
  it('adds the rules to an in-memory object, keeps the project’s own, and reports whether anything changed', () => {
    const settings: Record<string, unknown> = { permissions: { allow: ['Bash(make test)'], deny: ['Bash(rm *)'] } }

    expect(mergePermissionsInto(settings, ['Bash(sf status *)'], [], ['Bash(sf agents route --record*)'])).toEqual({ changed: true, revoked: [] })
    expect(settings.permissions).toEqual({ allow: ['Bash(make test)', 'Bash(sf status *)'], deny: ['Bash(rm *)'], ask: ['Bash(sf agents route --record*)'] })
    expect(mergePermissionsInto(settings, ['Bash(sf status *)'], [], ['Bash(sf agents route --record*)'])).toEqual({ changed: false, revoked: [] })
  })

  it('names the rules it revoked, and only those it removed', () => {
    const settings: Record<string, unknown> = { permissions: { allow: ['Bash(old *)', 'Bash(make test)', 'Bash(kept *)'] } }

    expect(mergePermissionsInto(settings, ['Bash(kept *)'], ['Bash(old *)', 'Bash(kept *)', 'Bash(absent *)'])).toEqual({ changed: true, revoked: ['Bash(old *)'] })
    expect(settings.permissions).toEqual({ allow: ['Bash(make test)', 'Bash(kept *)'] })
  })

  // Review of #935, row 2: the rules were overwritten and the caller was told they were merged
  it.each([
    ['an array permissions', { permissions: ['Bash(npm test)'] }, 'has `permissions` that is not an object'],
    ['a null permissions', { permissions: null }, 'has `permissions` that is not an object'],
    ['a string allow', { permissions: { allow: 'Bash(npm test)' } }, 'has `permissions.allow` that is not an array'],
    ['an object ask', { permissions: { ask: { a: 'Bash(git push *)' } } }, 'has `permissions.ask` that is not an array']
  ])('refuses %s, and changes nothing', (_name, original, message) => {
    const settings = JSON.parse(JSON.stringify(original)) as Record<string, unknown>

    expect(() => mergePermissionsInto(settings, ['Bash(sf status *)'], [], ['Bash(sf agents route --record*)'])).toThrow(new ClaudeSettingsShapeError(message))
    expect(settings).toEqual(original)
  })
})

describe('mergeHooksInto on hooks of another shape (#935)', () => {
  // Review of #935, row 3: `"hooks": []` took the event keys on an array and JSON.stringify dropped them
  it.each([
    ['an array hooks', { hooks: [] }, 'has `hooks` that is not an object'],
    ['a string event', { hooks: { SessionStart: 'echo hi' } }, 'has `hooks.SessionStart` that is not an array'],
    ['a group without hooks', { hooks: { SessionStart: [{ matcher: 'x' }] } }, 'has an entry of `hooks.SessionStart` that is not a hook group']
  ])('refuses %s, and changes nothing', (_name, original, message) => {
    const settings = JSON.parse(JSON.stringify(original)) as Record<string, unknown>

    expect(() => mergeHooksInto(settings, HARNESS_HOOKS)).toThrow(new ClaudeSettingsShapeError(message))
    expect(settings).toEqual(original)
  })

  it('checks every event before it changes any: a bad later event leaves the earlier ones as they were', () => {
    const original = { hooks: { SessionStart: [], PostToolUse: 3 } }
    const settings = JSON.parse(JSON.stringify(original)) as Record<string, unknown>

    expect(() => mergeHooksInto(settings, { SessionStart: HARNESS_HOOKS.SessionStart, PostToolUse: HARNESS_HOOKS.SessionStart })).toThrow('hooks.PostToolUse')
    expect(settings).toEqual(original)
  })

  it('accepts hooks of events it does not add to in any shape', () => {
    const settings: Record<string, unknown> = { hooks: { Notification: 'whatever', Stop: [{ nonsense: true }] } }

    expect(() => mergeHooksInto(settings, HARNESS_HOOKS)).not.toThrow()
    expect(settings.hooks).toMatchObject({ Notification: 'whatever', Stop: [{ nonsense: true }] })
  })

  it('does not write a file it cannot merge into: the file-based merges throw first', async () => {
    const dir = join(tmpdir(), `sf-settings-shape-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(dir, '.claude'), { recursive: true })
    const odd = JSON.stringify({ hooks: [], permissions: { allow: 'x' } })
    await writeFile(join(dir, '.claude', 'settings.json'), odd)

    await expect(mergeClaudeSettingsHooks(dir, HARNESS_HOOKS)).rejects.toBeInstanceOf(ClaudeSettingsShapeError)
    await expect(mergeClaudeSettingsPermissions(dir, ['Bash(sf status *)'])).rejects.toBeInstanceOf(ClaudeSettingsShapeError)

    expect(await readFile(join(dir, '.claude', 'settings.json'), 'utf8')).toBe(odd)
    await rm(dir, { recursive: true, force: true })
  })
})
