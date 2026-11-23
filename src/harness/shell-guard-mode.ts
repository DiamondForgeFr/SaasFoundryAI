import { readFileSync } from 'fs'
import { dirname, isAbsolute, join, resolve } from 'path'

import type { ShellShapeMode } from './tool-call-guard'

/**
 * What the guard does with a shell line that is not one plain command (#1251): the value of
 * `modules.harness.guard.shellShape` in `.saasfoundry.json`.
 *
 * - `refuse`: the guard denies the call and names the split to make. It is the default: **absence means refuse**,
 *   in a new project and in one that was already there when the rule shipped, so `sf update` writes nothing.
 * - `warn`: the call goes on through the host's own permission flow, with the same text as context.
 * - `off`: the guard does not look at the shape of a line (the rules of the escape hatches still apply).
 *
 * Only `sf agents shell-guard` records it; the guard hook only reads it, on every call, from the manifest nearest to
 * the working directory the host reports, so a change takes effect on the next call.
 */
export const SHELL_SHAPE_MODES: readonly ShellShapeMode[] = ['refuse', 'warn', 'off']
export const DEFAULT_SHELL_SHAPE: ShellShapeMode = 'refuse'

/**
 * `modules.harness.guard` in `.saasfoundry.json`: how the guard hook behaves. A block of its own so that a later
 * setting (an allow-list, a mode per rule) has a home. Optional with "refuse" as its absence, so manifests written
 * before it keep validating and need no migration (see .claude/docs/migration-framework.md, "When NOT to add a
 * migration"): the schema keeps validating older manifests, and an older CLI that reads one with the block ignores it.
 */
export interface HarnessGuard {
  shellShape?: ShellShapeMode
}

export const isShellShapeMode = (value: unknown): value is ShellShapeMode => (SHELL_SHAPE_MODES as readonly unknown[]).includes(value)

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The mode a manifest records, or `undefined` when it records none (or an unknown one: the default applies). */
export function recordedShellShape(manifest: unknown): ShellShapeMode | undefined {
  const harness = isObject(manifest) && isObject(manifest.modules) ? manifest.modules.harness : undefined
  const guard = isObject(harness) ? harness.guard : undefined
  const mode = isObject(guard) ? guard.shellShape : undefined
  return isShellShapeMode(mode) ? mode : undefined
}

/** Validate the recorded block; a key this release does not know is kept, so that a later release can add one. */
export function validateGuardConfig(value: unknown): void {
  if (!isObject(value)) throw new Error('Invalid manifest harness guard: expected an object.')
  if (value.shellShape !== undefined && !isShellShapeMode(value.shellShape)) throw new Error(`Invalid manifest harness guard: shellShape must be ${SHELL_SHAPE_MODES.join(', ')}.`)
}

/** The manifest nearest to `start`, walking up: its parsed content, or `null` when it cannot be read, `undefined` when there is none. */
function nearestManifest(start: string): unknown {
  let dir = resolve(start)
  for (;;) {
    try {
      return JSON.parse(readFileSync(join(dir, '.saasfoundry.json'), 'utf8')) as unknown
    } catch (error) {
      // A file that is there but cannot be read or parsed stops the search: it is the project's manifest, damaged.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ENOTDIR') return null
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/**
 * The line `sf update` prints about the shell shape check (#1251): it writes nothing to the manifest, since absence
 * means `refuse`, so a project updated to this release is told what its guard now does and how to change it.
 */
export function shellShapeNotice(mode: ShellShapeMode): string {
  if (mode === 'warn')
    return 'The guard hook flags a shell line that is not one plain command (a chain, a substitution, a loop, an inline script) without refusing it: shell shape is warn. sf agents shell-guard refuse restores the refusal.'
  if (mode === 'off') return 'The guard hook does not check the shape of a shell line: shell shape is off. sf agents shell-guard refuse restores the refusal.'
  return 'The guard hook now refuses a shell line that is not one plain command (a chain, a substitution, a loop, an inline script) and names the split to make. To flag it without refusing, run sf agents shell-guard warn; to stop checking the shape of a line, run sf agents shell-guard off.'
}

/**
 * The mode a hook call runs under: the manifest nearest to the working directory of the call (a worktree of an
 * agent has its own copy), then the one of `CLAUDE_PROJECT_DIR`. No manifest, an unreadable one, or a value this
 * release does not know means `refuse`. Synchronous and dependency-free: the guard hook pays for it on every call
 * that reaches Node.
 */
export function readShellShapeMode(cwd?: string, projectDir: string | undefined = process.env.CLAUDE_PROJECT_DIR): ShellShapeMode {
  for (const start of [cwd, projectDir]) {
    if (start === undefined || start === '' || !isAbsolute(start)) continue
    const manifest = nearestManifest(start)
    if (manifest !== undefined) return recordedShellShape(manifest) ?? DEFAULT_SHELL_SHAPE
  }
  return DEFAULT_SHELL_SHAPE
}
