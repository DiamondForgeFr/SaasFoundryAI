import { randomUUID } from 'crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises'
import { dirname, join } from 'path'

import { fileExists } from '../utils'

export interface ClaudeHook {
  type: string
  command: string
  /** Seconds the host waits for the command; omitted keeps the host default. */
  timeout?: number
}

export interface ClaudeHookGroup {
  matcher?: string
  hooks: ClaudeHook[]
}

/** Hooks keyed by Claude Code event name (SessionStart, UserPromptSubmit, …). */
export type ClaudeHooksConfig = Record<string, ClaudeHookGroup[]>

export const SRS_INTENT_HOOK_COMMAND = '.claude/skills/sf-srs/scripts/srs-intent-hook.sh'

/**
 * Replace a settings file the way the host reads it: whole or not at all. A write that is cut short
 * (a killed process, a full disk) would leave the project's permissions and hooks half-written, and the
 * agent that reads the file next would run without them.
 */
async function writeSettings(settingsPath: string, settings: Record<string, unknown>): Promise<void> {
  await writeSettingsText(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
}

/** The same whole-or-nothing replacement for text a caller already rendered (#935). */
export async function writeSettingsText(settingsPath: string, content: string): Promise<void> {
  await mkdir(dirname(settingsPath), { recursive: true })
  const mode = await stat(settingsPath).then(
    (info) => info.mode & 0o777,
    () => 0o644
  )
  const temporary = `${settingsPath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { mode })
    await rename(temporary, settingsPath)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

export interface MergeHooksOptions {
  /** A command an earlier release wrote that this merge replaces: it is removed from the events the merge touches. */
  supersedes?: (command: string) => boolean
}

/**
 * The settings hold a shape the merge cannot add to without losing what is there (a `hooks` that is an
 * array, a `permissions.allow` that is a string): the message says which, and starts with "has" so it
 * reads after the file name (#935). Nothing is changed when it is thrown.
 */
export class ClaudeSettingsShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClaudeSettingsShapeError'
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Check, before anything is touched, that every event the merge adds to holds hook groups. */
function assertHooksShape(settings: Record<string, unknown>, events: readonly string[]): void {
  if (settings.hooks !== undefined && !isPlainObject(settings.hooks)) throw new ClaudeSettingsShapeError('has `hooks` that is not an object')
  const existing = (settings.hooks ?? {}) as Record<string, unknown>
  for (const event of events) {
    const groups = existing[event]
    if (groups === undefined) continue
    if (!Array.isArray(groups)) throw new ClaudeSettingsShapeError(`has \`hooks.${event}\` that is not an array`)
    if (groups.some((group) => !isPlainObject(group) || !Array.isArray(group.hooks) || group.hooks.some((hook: unknown) => !isPlainObject(hook)))) {
      throw new ClaudeSettingsShapeError(`has an entry of \`hooks.${event}\` that is not a hook group`)
    }
  }
}

/**
 * Merge hook groups into an in-memory settings object without clobbering anything the user already
 * configured. Idempotent: a hook command already registered for an event is never duplicated, and
 * every unrelated settings key is preserved as-is. Throws a `ClaudeSettingsShapeError`, before changing
 * anything, when `hooks` or one of the events it adds to is not made of hook groups.
 */
export function mergeHooksInto(settings: Record<string, unknown>, hooks: ClaudeHooksConfig, options: MergeHooksOptions = {}): void {
  assertHooksShape(settings, Object.keys(hooks))
  const existingHooks = (settings.hooks ?? {}) as Record<string, ClaudeHookGroup[]>

  for (const [event, groups] of Object.entries(hooks)) {
    let eventGroups = existingHooks[event] ?? []
    if (options.supersedes) {
      const supersedes = options.supersedes
      eventGroups = eventGroups.map((group) => ({ ...group, hooks: group.hooks.filter((hook) => !supersedes(hook.command)) })).filter((group) => group.hooks.length > 0)
    }
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
}

/**
 * Merge hook groups into `<targetPath>/.claude/settings.json` without
 * clobbering anything the user already configured. Idempotent: a hook command
 * already registered for an event is never duplicated, and every unrelated
 * settings key is preserved as-is.
 */
export async function mergeClaudeSettingsHooks(targetPath: string, hooks: ClaudeHooksConfig, options: MergeHooksOptions = {}): Promise<boolean> {
  const settingsPath = join(targetPath, '.claude', 'settings.json')

  let settings: Record<string, unknown> = {}
  const existed = await fileExists(settingsPath)
  if (existed) {
    settings = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>
  }
  const before = JSON.stringify(settings)

  mergeHooksInto(settings, hooks, options)

  // Nothing to add: leave the file (and its formatting) exactly as the project has it.
  if (existed && JSON.stringify(settings) === before) return false
  await writeSettings(settingsPath, settings)
  return true
}

/**
 * Add permission rules to the `permissions` of an in-memory settings object. Same contract as the
 * hooks: idempotent, a rule already present is never duplicated, and every rule or key the user
 * configured is kept. `revoke` lists rules an earlier release pre-approved and this one does not: they
 * are removed, so the command asks again. `ask` lists rules added to `permissions.ask`, which the host
 * evaluates before `allow`: a command that matches both asks. That is how a wide rule
 * (`sf agents route *`) stays pre-approved for reading while the forms of the same command that write
 * evidence (`--record`, `--retry-of`) still ask: a pattern cannot say "not this flag". Returns whether
 * the settings changed, and the rules `revoke` took away (named, so the caller can say so). Throws a
 * `ClaudeSettingsShapeError`, before changing anything, when `permissions` is not an object or its `allow`
 * or `ask` is not an array: replacing it would lose what the project wrote.
 */
export function mergePermissionsInto(
  settings: Record<string, unknown>,
  allow: readonly string[],
  revoke: readonly string[] = [],
  ask: readonly string[] = []
): { changed: boolean; revoked: string[] } {
  if (settings.permissions !== undefined && !isPlainObject(settings.permissions)) throw new ClaudeSettingsShapeError('has `permissions` that is not an object')
  const permissions = (settings.permissions ?? {}) as Record<string, unknown>
  for (const key of ['allow', 'ask']) {
    if (permissions[key] !== undefined && !Array.isArray(permissions[key])) throw new ClaudeSettingsShapeError(`has \`permissions.${key}\` that is not an array`)
  }
  const existing = Array.isArray(permissions.allow) ? (permissions.allow as string[]) : []
  const revoked = existing.filter((rule) => revoke.includes(rule) && !allow.includes(rule))
  const kept = existing.filter((rule) => !revoked.includes(rule))
  const missing = allow.filter((rule) => !kept.includes(rule))
  const existingAsk = Array.isArray(permissions.ask) ? (permissions.ask as string[]) : []
  const missingAsk = ask.filter((rule) => !existingAsk.includes(rule))
  if (missing.length === 0 && kept.length === existing.length && missingAsk.length === 0 && settings.permissions) return { changed: false, revoked: [] }
  settings.permissions = { ...permissions, allow: [...kept, ...missing], ...(ask.length || existingAsk.length ? { ask: [...existingAsk, ...missingAsk] } : {}) }
  return { changed: true, revoked: [...new Set(revoked)] }
}

/** Add permission rules to `permissions.allow` of `<targetPath>/.claude/settings.json` (see `mergePermissionsInto`). */
export async function mergeClaudeSettingsPermissions(targetPath: string, allow: readonly string[], revoke: readonly string[] = [], ask: readonly string[] = []): Promise<boolean> {
  const settingsPath = join(targetPath, '.claude', 'settings.json')
  const settings: Record<string, unknown> = (await fileExists(settingsPath)) ? (JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>) : {}
  if (!mergePermissionsInto(settings, allow, revoke, ask).changed) return false
  await writeSettings(settingsPath, settings)
  return true
}

/** Keep only the SaaSFoundry SRS hook in sync with the installed SRS skill. */
export async function reconcileSrsIntentHook(targetPath: string, srsEnabled: boolean): Promise<void> {
  const settingsPath = join(targetPath, '.claude', 'settings.json')
  if (!(await fileExists(settingsPath)) && !srsEnabled) return

  let settings: Record<string, unknown>
  try {
    settings = (await fileExists(settingsPath)) ? JSON.parse(await readFile(settingsPath, 'utf8')) : {}
  } catch {
    // Text that is not JSON cannot be reconciled: the harness settings merge reports it and proposes a file beside it (#935),
    // and the update goes on instead of stopping here.
    return
  }
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
  await writeSettings(settingsPath, settings)
}
