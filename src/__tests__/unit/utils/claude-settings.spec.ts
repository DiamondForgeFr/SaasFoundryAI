import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { ClaudeHooksConfig, SRS_INTENT_HOOK_COMMAND, mergeClaudeSettingsHooks, mergePermissionsInto, reconcileSrsIntentHook } from '../../../utils/claude-settings'

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

    expect(mergePermissionsInto(settings, ['Bash(sf status *)'], [], ['Bash(sf agents route --record*)'])).toBe(true)
    expect(settings.permissions).toEqual({ allow: ['Bash(make test)', 'Bash(sf status *)'], deny: ['Bash(rm *)'], ask: ['Bash(sf agents route --record*)'] })
    expect(mergePermissionsInto(settings, ['Bash(sf status *)'], [], ['Bash(sf agents route --record*)'])).toBe(false)
  })
})
