import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'

import { fileExists } from '../utils'

export interface ClaudeHook {
  type: string
  command: string
}

export interface ClaudeHookGroup {
  matcher?: string
  hooks: ClaudeHook[]
}

/** Hooks keyed by Claude Code event name (SessionStart, UserPromptSubmit, …). */
export type ClaudeHooksConfig = Record<string, ClaudeHookGroup[]>

/**
 * Merge hook groups into `<targetPath>/.claude/settings.json` without
 * clobbering anything the user already configured. Idempotent: a hook command
 * already registered for an event is never duplicated, and every unrelated
 * settings key is preserved as-is.
 */
export async function mergeClaudeSettingsHooks(targetPath: string, hooks: ClaudeHooksConfig): Promise<void> {
  const settingsPath = join(targetPath, '.claude', 'settings.json')

  let settings: Record<string, unknown> = {}
  if (await fileExists(settingsPath)) {
    settings = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>
  }

  const existingHooks = (settings.hooks ?? {}) as Record<string, ClaudeHookGroup[]>

  for (const [event, groups] of Object.entries(hooks)) {
    const eventGroups = existingHooks[event] ?? []
    const registered = new Set(eventGroups.flatMap((group) => group.hooks.map((hook) => hook.command)))

    for (const group of groups) {
      const missing = group.hooks.filter((hook) => !registered.has(hook.command))
      if (missing.length === 0) continue
      eventGroups.push({ ...group, hooks: missing })
      missing.forEach((hook) => registered.add(hook.command))
    }

    existingHooks[event] = eventGroups
  }

  settings.hooks = existingHooks

  await mkdir(dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
}
