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

export const SRS_INTENT_HOOK_COMMAND = '.claude/skills/sf-srs/scripts/srs-intent-hook.sh'

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

/** Keep only the SaaSFoundry SRS hook in sync with the installed SRS skill. */
export async function reconcileSrsIntentHook(targetPath: string, srsEnabled: boolean): Promise<void> {
  const settingsPath = join(targetPath, '.claude', 'settings.json')
  if (!(await fileExists(settingsPath)) && !srsEnabled) return

  const settings: Record<string, unknown> = (await fileExists(settingsPath)) ? JSON.parse(await readFile(settingsPath, 'utf8')) : {}
  const hooks = (settings.hooks ?? {}) as ClaudeHooksConfig
  const groups = hooks.UserPromptSubmit ?? []
  const withoutManagedHook = groups.map((group) => ({ ...group, hooks: group.hooks.filter((hook) => hook.command !== SRS_INTENT_HOOK_COMMAND) })).filter((group) => group.hooks.length > 0)
  const hadManagedHook = groups.some((group) => group.hooks.some((hook) => hook.command === SRS_INTENT_HOOK_COMMAND))
  const hasScript = srsEnabled && (await fileExists(join(targetPath, SRS_INTENT_HOOK_COMMAND)))

  if (hasScript === hadManagedHook) return
  if (hasScript) withoutManagedHook.push({ hooks: [{ type: 'command', command: SRS_INTENT_HOOK_COMMAND }] })
  if (withoutManagedHook.length > 0) hooks.UserPromptSubmit = withoutManagedHook
  else delete hooks.UserPromptSubmit
  settings.hooks = hooks
  await mkdir(dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
}
