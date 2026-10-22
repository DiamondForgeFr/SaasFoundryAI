import chalk from 'chalk'
import { lstat, readFile } from 'fs/promises'
import { join } from 'path'

import { isReferenceOnlyAdoption } from './agent-instructions'
import { CLAUDE_CAPTURE_HOOKS, isLegacyCaptureCommand } from './delegation-hooks'
import type { ModuleMigrationPreview } from '../migrations/module/types'
import type { SaaSFoundryManifest } from '../types'
import { ClaudeHooksConfig, mergeClaudeSettingsHooks, mergeClaudeSettingsPermissions, mergeHooksInto, mergePermissionsInto, writeSettingsText } from '../utils/claude-settings'

/**
 * What the harness keeps in a project's `.claude/settings.json`: the hooks and the permission rules.
 * One source for every path that writes them — the first install, `sf agents refresh`, `sf update`
 * (every run, and the harness v4 → v5 migration) and the scaffold `settings.json` templates — so a
 * rule added here reaches new and installed projects alike (#935).
 */
export const HARNESS_HOOKS: ClaudeHooksConfig = {
  SessionStart: [{ hooks: [{ type: 'command', command: 'sf status --claude-friendly --no-network' }] }],
  // Every routed delegation appends its outcome to the clone ledger the routing adjusts itself from (#1035).
  ...CLAUDE_CAPTURE_HOOKS
}

const WORKFLOW_CLI = '.claude/skills/sf-workflow/workflow-cli.sh'
const BOARD_CLI = '.claude/skills/sf-tool-github-projects/github-projects-cli.sh'

/**
 * The read-only commands the harness itself tells the agent to run at every workflow step
 * (#947). Undeclared, each one asked the developer for permission, all day, in every project
 * not running in bypass mode. Commands that change a ticket, a board or a pull request stay out.
 */
export const HARNESS_ALLOWED_COMMANDS: readonly string[] = [
  `Bash(${WORKFLOW_CLI} status *)`,
  `Bash(${WORKFLOW_CLI} next *)`,
  `Bash(${WORKFLOW_CLI} help)`,
  ...['status', 'get-ticket', 'get-labels', 'get-complexity', 'get-parent', 'get-issue-type', 'list', 'list-incomplete-children'].map((command) => `Bash(${BOARD_CLI} ${command} *)`),
  'Bash(sf status *)',
  'Bash(sf agents list *)',
  // The consent to delegate ticket delivery is read at the start of a session (#1026); `allow`, `decline` and `clear` still ask.
  'Bash(sf agents delegation status)',
  'Bash(sf agents delegation status *)',
  // Reading a route and the measured outcomes changes nothing (#1035). `sf agents outcome record` and `mark`, and the forms of
  // `sf agents route` that write a route record (`--record`, `--retry-of`), write evidence the routing acts on, so they ask:
  // the read form is allowed here, the writing forms are in HARNESS_ASK_COMMANDS, which the host evaluates first.
  'Bash(sf agents route *)',
  'Bash(sf agents routing report)',
  'Bash(sf agents routing report *)',
  'Bash(gh project item-list *)',
  'Bash(gh project view *)',
  'Bash(gh project field-list *)'
]

/** Rules an earlier build of this branch pre-approved and a refresh takes away again: the commands ask. */
export const HARNESS_REVOKED_COMMANDS: readonly string[] = ['Bash(sf agents outcome mark *)', 'Bash(sf agents outcome record *)']

/**
 * The forms of an allowed command that write evidence the routing acts on. A permission pattern cannot say "not this
 * flag", so `sf agents route *` stays allowed for reading and these ask: Claude Code evaluates `ask` before `allow`.
 * The flag comes right after `route` or after other options, hence two patterns each.
 */
export const HARNESS_ASK_COMMANDS: readonly string[] = ['--record', '--retry-of'].flatMap((flag) => [`Bash(sf agents route ${flag}*)`, `Bash(sf agents route * ${flag}*)`])

/** What a merge of the harness hooks replaces: the bare-`sf` capture command the first build wrote. */
export const HARNESS_SUPERSEDED_HOOKS = { supersedes: isLegacyCaptureCommand }

/** Merge the harness hooks and permission rules into `<targetPath>/.claude/settings.json`; an unreadable file throws. */
export async function mergeHarnessSettings(targetPath: string): Promise<void> {
  await mergeClaudeSettingsHooks(targetPath, HARNESS_HOOKS, HARNESS_SUPERSEDED_HOOKS)
  await mergeClaudeSettingsPermissions(targetPath, HARNESS_ALLOWED_COMMANDS, HARNESS_REVOKED_COMMANDS, HARNESS_ASK_COMMANDS)
}

export const HARNESS_SETTINGS_PATH = '.claude/settings.json'
export const HARNESS_SETTINGS_SIDECAR_SUFFIX = '.saasfoundry.new'

/**
 * The settings text with the harness hooks and permissions merged in, as a pure function of the text
 * the project has. `existing` undefined means no file: the render is the harness's own settings, the
 * content of the scaffold templates. An `error` says why the text cannot be merged, never throws.
 */
export function renderHarnessSettings(existing?: string): { content: string; changed: boolean } | { error: string } {
  let settings: Record<string, unknown> = {}
  if (existing !== undefined && existing.trim()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(existing)
    } catch {
      return { error: 'is not valid JSON' }
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { error: 'is not a JSON object' }
    settings = parsed as Record<string, unknown>
  }
  const before = JSON.stringify(settings)
  try {
    mergeHooksInto(settings, HARNESS_HOOKS, HARNESS_SUPERSEDED_HOOKS)
    mergePermissionsInto(settings, HARNESS_ALLOWED_COMMANDS, HARNESS_REVOKED_COMMANDS, HARNESS_ASK_COMMANDS)
  } catch {
    return { error: 'has hooks or permissions in a shape the merge does not know' }
  }
  return { content: `${JSON.stringify(settings, null, 2)}\n`, changed: existing === undefined || !existing.trim() || JSON.stringify(settings) !== before }
}

/**
 * - `created`: no settings file yet, the harness's own was written;
 * - `merged`: the project's file gained hooks or rules, and kept everything it had;
 * - `unchanged`: nothing to add, the file was not touched;
 * - `sidecar`: the file is a link or not valid JSON, so it was left as it is and the merged proposal went
 *   to `settings.json.saasfoundry.new` for the developer to reconcile;
 * - `skipped`: the location cannot be written safely (a linked `.claude`, a directory in place of the file).
 */
export type HarnessSettingsStatus = 'created' | 'merged' | 'unchanged' | 'sidecar' | 'skipped'

export interface HarnessSettingsResult {
  /** Project-relative path of the settings file. */
  path: string
  status: HarnessSettingsStatus
  /** Project-relative path of the proposal, for a `sidecar`. */
  sidecar?: string
  /** Why a file was not merged, for a `sidecar` or a `skipped`. */
  reason?: string
}

async function lstatOrUndefined(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

const settingsPathOf = (root: string): string => (root === '.' ? HARNESS_SETTINGS_PATH : `${root}/${HARNESS_SETTINGS_PATH}`)

export interface SyncHarnessSettingsOptions {
  /** Report what would happen and write nothing. */
  dryRun?: boolean
}

/**
 * Bring `<projectDir>/<root>/.claude/settings.json` up to the harness hooks and permissions, without
 * taking anything away from the project: its own keys, hooks and rules stay, a file with nothing to
 * add is not rewritten. The file is user-owned, so one that cannot be merged in place — a link, a hard
 * link, text that is not a JSON object — is left untouched and the proposal is written next to it in
 * `settings.json.saasfoundry.new`; nothing here throws for the state of that file.
 */
export async function syncHarnessSettings(projectDir: string, root = '.', { dryRun = false }: SyncHarnessSettingsOptions = {}): Promise<HarnessSettingsResult> {
  const path = settingsPathOf(root)
  const settingsPath = join(projectDir, path)
  const sidecarPath = `${settingsPath}${HARNESS_SETTINGS_SIDECAR_SUFFIX}`
  const sidecar = `${path}${HARNESS_SETTINGS_SIDECAR_SUFFIX}`

  const claudeDir = await lstatOrUndefined(join(projectDir, root, '.claude'))
  if (claudeDir && (claudeDir.isSymbolicLink() || !claudeDir.isDirectory())) return { path, status: 'skipped', reason: '.claude is a symbolic link or not a directory' }

  const file = await lstatOrUndefined(settingsPath)
  let existing: string | undefined
  let blocked: string | undefined
  if (file) {
    if (!file.isSymbolicLink() && !file.isFile()) return { path, status: 'skipped', reason: 'is not a regular file' }
    if (file.isSymbolicLink() || file.nlink > 1) {
      blocked = file.isSymbolicLink() ? 'is a symbolic link' : 'is a hard-linked file'
      // The proposal starts from what the link leads to, when that is readable.
      existing = await readFile(settingsPath, 'utf8').catch(() => undefined)
    } else {
      existing = await readFile(settingsPath, 'utf8')
    }
  }

  const rendered = renderHarnessSettings(existing)
  if (!('error' in rendered) && !rendered.changed) return { path, status: 'unchanged' }
  if ('error' in rendered) blocked ??= rendered.error

  if (blocked) {
    // A proposal needs a text to start from: the harness's own settings when the file cannot be read as JSON.
    const proposal = 'error' in rendered ? renderHarnessSettings(undefined) : rendered
    if ('error' in proposal) return { path, status: 'skipped', reason: proposal.error }
    const target = await lstatOrUndefined(sidecarPath)
    if (target && (target.isSymbolicLink() || !target.isFile() || target.nlink > 1)) return { path, status: 'skipped', reason: `${sidecar} is a link or not a regular file` }
    if (!dryRun && (await readFile(sidecarPath, 'utf8').catch(() => undefined)) !== proposal.content) await writeSettingsText(sidecarPath, proposal.content)
    return { path, status: 'sidecar', sidecar, reason: blocked }
  }

  const created = existing === undefined || !existing.trim()
  if (!dryRun) await writeSettingsText(settingsPath, (rendered as { content: string }).content)
  return { path, status: created ? 'created' : 'merged' }
}

/**
 * The project-relative directories whose `.claude/settings.json` the harness keeps (#935): where the
 * project has Claude Code and a harness the CLI manages.
 *
 * - none without a harness, with `managed: false` (common deposits only) or with a declaration that
 *   leaves Claude Code out; a legacy project that declares no agents is Claude Code's;
 * - none for a reference-only adoption, whose instructions ask the agent not to change hooks or permissions;
 * - the project root, and for a multirepo project its root and each app repository that has a `.claude`
 *   (a monorepo has a single `.claude`, at its root).
 */
export async function claudeSettingsRoots(projectDir: string, manifest: SaaSFoundryManifest): Promise<string[]> {
  const harness = manifest.modules?.harness
  if (!harness || harness.managed === false) return []
  if (harness.agents?.length && !harness.agents.includes('claude-code')) return []

  const candidates = manifest.structure === 'multirepo' ? ['.', `apps/${manifest.projectName}-api`, `apps/${manifest.projectName}-web`] : ['.']
  const roots: string[] = []
  for (const root of candidates) {
    // Only the project root of a monorepo or a single repository gets a `.claude` it does not have yet.
    if (manifest.structure === 'multirepo') {
      const claudeDir = await lstatOrUndefined(join(projectDir, root, '.claude'))
      if (!claudeDir?.isDirectory()) continue
    }
    if (await isReferenceOnlyAdoption(join(projectDir, root), root === '.' ? manifest.fileHashes : undefined)) continue
    roots.push(root)
  }
  return roots
}

/** Sync every root the harness keeps settings for. Nothing is written in a dry run. */
export async function syncHarnessSettingsForProject(projectDir: string, manifest: SaaSFoundryManifest, options: SyncHarnessSettingsOptions = {}): Promise<HarnessSettingsResult[]> {
  const results: HarnessSettingsResult[] = []
  for (const root of await claudeSettingsRoots(projectDir, manifest)) results.push(await syncHarnessSettings(projectDir, root, options))
  return results
}

export interface HarnessSettingsSummaryLine {
  text: string
  /** A sidecar or a skip asks the developer to act; a merge is informational. */
  needsAttention: boolean
}

/** One line per result that changed or needs the developer; a file already up to date is not mentioned. */
export function summarizeHarnessSettings(results: HarnessSettingsResult[], { dryRun = false }: { dryRun?: boolean } = {}): HarnessSettingsSummaryLine[] {
  return results
    .filter((result) => result.status !== 'unchanged')
    .map((result): HarnessSettingsSummaryLine => {
      switch (result.status) {
        case 'sidecar':
          return {
            needsAttention: true,
            text: `${result.path} ${result.reason}: left as it is. ${dryRun ? 'Would write' : 'Wrote'} the merged proposal to ${result.sidecar} — review it and merge what you want.`
          }
        case 'skipped':
          return { needsAttention: true, text: `${result.path} ${result.reason}: left as it is; the delegation capture hooks were not added.` }
        case 'created':
          return { needsAttention: false, text: `${result.path}: ${dryRun ? 'would be written' : 'written'} with the delegation capture hooks and the harness permissions.` }
        default:
          return {
            needsAttention: false,
            text: `${result.path}: delegation capture hooks and harness permissions ${dryRun ? 'would be merged in' : 'merged in'}; your own keys, hooks and rules are kept.`
          }
      }
    })
}

/** Print the summary lines of a sync. */
export function logHarnessSettings(results: HarnessSettingsResult[], options: { dryRun?: boolean } = {}): void {
  for (const line of summarizeHarnessSettings(results, options)) console.log((line.needsAttention ? chalk.yellow : chalk.gray)(`  ${line.text}`))
}

/** The dry-run listing of what a sync would change (#938 preview shape). */
export function previewHarnessSettings(results: HarnessSettingsResult[]): ModuleMigrationPreview[] {
  return results
    .filter((result) => result.status !== 'unchanged')
    .map((result) => ({
      action: result.status === 'created' ? 'create' : result.status === 'merged' ? 'merge' : result.status === 'sidecar' ? 'propose' : 'keep',
      source: result.path,
      ...(result.sidecar ? { target: result.sidecar } : {}),
      reason:
        result.status === 'sidecar' || result.status === 'skipped'
          ? `${result.reason}: the file stays as it is${result.sidecar ? `, the merged proposal goes to ${result.sidecar}` : ''}`
          : 'delegation capture hooks and harness permissions are added; your own keys, hooks and rules are kept'
    }))
}
