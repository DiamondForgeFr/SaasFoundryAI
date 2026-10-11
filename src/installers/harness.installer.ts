import { lstat, readFile, readdir, writeFile } from 'fs/promises'
import { join, resolve, sep } from 'path'

import { installClaudeDocs } from './claude-docs.installer'
import { installCoreSkills } from './core-skills.installer'
import { harnessMigrations } from './harness.migrations'
import { installOptionalSkills } from './optional-skills.installer'
import { installToolSkill } from './tool-skill.installer'
import { injectWorkflowSection, installWorkflowSkill } from './workflow-skill.installer'
import { AgentInstructionsReport, HarnessAgent, installAgentInstructions } from '../harness/agent-instructions'
import { needsSharedInstructions, resolveHarnessAgents } from '../harness/agent-registry'
import type { ModuleInstaller } from '../migrations/module/types'
import { SaaSFoundryManifest, WorkflowConfig, skillsTemplatesPath } from '../types'
import { ClaudeHooksConfig, mergeClaudeSettingsHooks, mergeClaudeSettingsPermissions } from '../utils/claude-settings'
import { computeFileHashes, fileExists } from '../utils'

export const harnessInstallerMeta: ModuleInstaller = {
  name: 'harness',
  currentVersion: 3,
  migrations: harnessMigrations
}

/**
 * Scope of the harness hash tracking that drives the conflict-aware refresh
 * in `sf update`:
 * - `.claude/docs/**` — entirely deposit-owned
 * - `.claude/skills/sf-*` — the `sf-` prefix is reserved for SaaSFoundryAI
 *   deposits; user-authored skills outside that prefix are never tracked,
 *   never touched
 * AGENTS.md (or a pre-#937 CLAUDE.md) and .claude/settings.json are deliberately NOT
 * tracked: both are user-owned and managed through targeted merges (section re-injection /
 * hook merging), never through the file sweep.
 */
export const HARNESS_SKILL_PREFIX = 'sf-'

async function inspectHarnessTree(path: string): Promise<void> {
  const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (!stat) return
  if (stat.isSymbolicLink()) throw new Error(`Unsafe harness path: ${path} is a symbolic link.`)
  if (stat.isFile()) {
    if (stat.nlink > 1) throw new Error(`Unsafe harness path: ${path} is a hard-linked file.`)
    return
  }
  if (!stat.isDirectory()) throw new Error(`Unsafe harness path: ${path} is not a regular file or directory.`)
  for (const entry of await readdir(path)) await inspectHarnessTree(join(path, entry))
}

/** Reject linked/special destinations before a legacy harness install writes. */
export async function assertHarnessWritePathsSafe(targetPath: string): Promise<void> {
  const root = resolve(targetPath)
  const rootStat = await lstat(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Harness installation requires a real project directory.')

  const claudeRoot = join(root, '.claude')
  const claudeStat = await lstat(claudeRoot).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (claudeStat?.isSymbolicLink() || (claudeStat && !claudeStat.isDirectory())) throw new Error(`Unsafe harness path: ${claudeRoot} must be a real directory.`)

  await inspectHarnessTree(join(root, 'AGENTS.md'))
  await inspectHarnessTree(join(root, 'CLAUDE.md'))
  await inspectHarnessTree(join(root, '.claude', 'rules'))
  await inspectHarnessTree(join(root, '.claude', 'settings.json'))
  await inspectHarnessTree(join(root, '.claude', 'docs'))

  const skillsRoot = join(root, '.claude', 'skills')
  const skillsStat = await lstat(skillsRoot).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (skillsStat?.isSymbolicLink() || (skillsStat && !skillsStat.isDirectory())) throw new Error(`Unsafe harness path: ${skillsRoot} must be a real directory.`)
  if (skillsStat) {
    for (const entry of await readdir(skillsRoot)) {
      if (entry.startsWith(HARNESS_SKILL_PREFIX)) await inspectHarnessTree(join(skillsRoot, entry))
    }
  }

  // A GitHub-backed workflow also deposits the PR synchronization action.
  // Inspect both ancestors explicitly so an intermediate `.github` symlink
  // cannot redirect an otherwise regular-looking leaf outside the project.
  const githubRoot = join(root, '.github')
  const githubStat = await lstat(githubRoot).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (githubStat?.isSymbolicLink() || (githubStat && !githubStat.isDirectory())) throw new Error(`Unsafe harness path: ${githubRoot} must be a real directory.`)
  await inspectHarnessTree(join(githubRoot, 'workflows'))
}

/** Is this project-root-relative path inside the harness-tracked scope? */
export function isHarnessTrackedPath(relPath: string): boolean {
  if (relPath.startsWith('.claude/docs/')) return true
  return relPath.startsWith(`.claude/skills/${HARNESS_SKILL_PREFIX}`)
}

/**
 * Hash every file of the harness deposits, keyed by project-root-relative
 * path — the entries `installHarness` and the `sf update` refresh store in
 * `manifest.fileHashes` so user edits are detected (same mechanism as the
 * scaffold template tracking and `writeMigratedFile`).
 */
export async function computeHarnessFileHashes(targetPath: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {}
  for (const dir of ['.claude/skills', '.claude/docs']) {
    const dirPath = join(targetPath, dir)
    if (!(await fileExists(dirPath))) continue
    const dirHashes = await computeFileHashes(dirPath)
    for (const [relPath, hash] of Object.entries(dirHashes)) {
      // Normalize to forward slashes so baselines committed from Windows
      // still match on POSIX (and vice versa).
      const projectRelPath = `${dir}/${relPath.split(sep).join('/')}`
      if (isHarnessTrackedPath(projectRelPath)) hashes[projectRelPath] = hash
    }
  }
  return hashes
}

export interface InstallWorkflowArtifactsParams {
  targetPath: string
  workflow?: WorkflowConfig
  /** False for a monorepo app: the root AGENTS.md carries the workflow section. */
  injectSection?: boolean
}

/**
 * Workflow-related deposits shared by every install path: the sf-workflow
 * skill (with the AGENTS.md section injection) and the tool-specific skill.
 * Builders (full profile) and the standalone harness install both delegate
 * here, so the deposited files stay identical across profiles.
 */
export async function installWorkflowArtifacts({ targetPath, workflow, injectSection }: InstallWorkflowArtifactsParams): Promise<void> {
  if (!workflow || workflow.tool === 'none') return

  await installWorkflowSkill({
    targetPath,
    workflow,
    projectUrl: workflow.projectUrl,
    injectSection
  })

  await installToolSkill({
    targetPath,
    tool: workflow.tool as 'github-projects' | 'jira' | 'notion' | 'linear'
  })
}

export interface InstallHarnessParams {
  targetPath: string
  projectName: string
  version: string
  mainBranch?: string
  workflow?: WorkflowConfig
  advancedSkills?: string[]
  /** Declared coding-agent adapters. Omission keeps the legacy Claude declaration. */
  agents?: HarnessAgent[]
  /**
   * The project carries a generated technical stack (`hasTechnicalStack`), so
   * the stack skills are deposited. Read from the manifest, never from
   * `targetPath`: `sf update` deposits into an empty temp directory.
   */
  stackPresent?: boolean
}

const HARNESS_HOOKS: ClaudeHooksConfig = {
  SessionStart: [{ hooks: [{ type: 'command', command: 'sf status --claude-friendly --no-network' }] }]
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
  'Bash(gh project item-list *)',
  'Bash(gh project view *)',
  'Bash(gh project field-list *)'
]

async function mergeHarnessSettings(targetPath: string): Promise<void> {
  await mergeClaudeSettingsHooks(targetPath, HARNESS_HOOKS)
  await mergeClaudeSettingsPermissions(targetPath, HARNESS_ALLOWED_COMMANDS)
}

export interface MergeHarnessUserFilesParams {
  targetPath: string
  projectName: string
  version: string
  mainBranch?: string
  workflow?: WorkflowConfig
}

/** Neither AGENTS.md nor a pre-#937 CLAUDE.md: the project has no instructions of its own yet. */
async function hasNoInstructions(targetPath: string): Promise<boolean> {
  return !(await fileExists(join(targetPath, 'AGENTS.md'))) && !(await fileExists(join(targetPath, 'CLAUDE.md')))
}

/** Deposit the harness AGENTS.md template with its placeholders resolved. */
async function depositAgentsMd(targetPath: string, projectName: string, version: string, mainBranch: string): Promise<void> {
  const content = (await readFile(resolve(skillsTemplatesPath, 'harness', 'AGENTS.md'), 'utf8'))
    .replace(/\{\{PROJECT_NAME\}\}/g, projectName)
    .replace(/\{\{VERSION\}\}/g, version)
    .replace(/\{\{MAIN_BRANCH\}\}/g, mainBranch)
  await assertHarnessWritePathsSafe(targetPath)
  await writeFile(join(targetPath, 'AGENTS.md'), content)
}

/**
 * The merge-managed (non-swept) side of a harness install: AGENTS.md
 * (template deposited only when the project has no instructions, workflow
 * section re-injected idempotently) and the Claude Code hooks. Used by the
 * conflict-safe install path of `sf update` after the three-way deposit
 * merge, which by design never touches these user-owned files. Returns the
 * instruction report when it deposited AGENTS.md, so its baselines are recorded.
 */
export async function mergeHarnessUserFiles({ targetPath, projectName, version, mainBranch = 'main', workflow }: MergeHarnessUserFilesParams): Promise<AgentInstructionsReport | undefined> {
  await assertHarnessWritePathsSafe(targetPath)
  const depositedAgentsMd = await hasNoInstructions(targetPath)
  if (depositedAgentsMd) await depositAgentsMd(targetPath, projectName, version, mainBranch)

  if (workflow && workflow.tool !== 'none') {
    await assertHarnessWritePathsSafe(targetPath)
    await injectWorkflowSection({ targetPath, workflow, projectUrl: workflow.projectUrl })
  }

  await assertHarnessWritePathsSafe(targetPath)
  await mergeHarnessSettings(targetPath)
  return depositedAgentsMd ? addAgentInstructions(targetPath, resolveHarnessAgents()) : undefined
}

/**
 * Install the AI harness onto an EXISTING repository (harness profile):
 * core skills, shared docs, optional tool skills, workflow artefacts,
 * Claude Code hooks and a minimal AGENTS.md when the repo has no instructions.
 *
 * The user's files are respected: existing instructions (AGENTS.md, or a
 * CLAUDE.md that predates #937) are only appended to (workflow section
 * injection), and .claude/settings.json is merged, never overwritten.
 */
export async function installHarness({
  targetPath,
  projectName,
  version,
  mainBranch = 'main',
  workflow,
  advancedSkills = [],
  agents,
  stackPresent = false
}: InstallHarnessParams): Promise<AgentInstructionsReport | undefined> {
  await assertHarnessWritePathsSafe(targetPath)
  const declaredAgents = resolveHarnessAgents(agents)

  // Adding discovery must not reinstall the user's customized legacy skills.
  // Refreshing those files belongs to the conflict-aware update flow.
  if (needsSharedInstructions(declaredAgents) && (await fileExists(join(targetPath, '.claude', 'skills')))) {
    if (await hasNoInstructions(targetPath)) {
      throw new Error(
        'Existing Claude skills have no AGENTS.md or CLAUDE.md instruction source. Reconcile this partial harness before adding shared agent instructions; existing files were left unchanged.'
      )
    }
    return addAgentInstructions(targetPath, declaredAgents)
  }
  if (await hasNoInstructions(targetPath)) await depositAgentsMd(targetPath, projectName, version, mainBranch)

  await assertHarnessWritePathsSafe(targetPath)
  await installCoreSkills({ targetPath, includeStackSkills: stackPresent })
  await assertHarnessWritePathsSafe(targetPath)
  await installClaudeDocs({ targetPath })

  if (advancedSkills.length > 0) {
    await assertHarnessWritePathsSafe(targetPath)
    await installOptionalSkills({ targetPath, selectedSkills: advancedSkills })
  }

  await assertHarnessWritePathsSafe(targetPath)
  await installWorkflowArtifacts({ targetPath, workflow })

  await assertHarnessWritePathsSafe(targetPath)
  await mergeHarnessSettings(targetPath)

  // Fills the generated region of AGENTS.md and the declared hosts' additions.
  // Omission retains the legacy Claude-only declaration.
  return addAgentInstructions(targetPath, declaredAgents)
}

async function addAgentInstructions(targetPath: string, agents: HarnessAgent[]): Promise<AgentInstructionsReport> {
  const manifestPath = join(targetPath, '.saasfoundry.json')
  const manifest: SaaSFoundryManifest | undefined = (await fileExists(manifestPath)) ? JSON.parse(await readFile(manifestPath, 'utf8')) : undefined
  const report = await installAgentInstructions({ targetPath, agents, manifest })
  for (const warning of report.warnings) console.warn(warning)
  for (const conflict of report.conflicts) console.warn(`Agent instructions need reconciliation: ${conflict}`)
  return report
}
