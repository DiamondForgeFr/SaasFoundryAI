import { copy, ensureDir, move, pathExists, remove } from 'fs-extra'
import { lstat, readFile, readdir, writeFile } from 'fs/promises'
import { join, relative, resolve, sep } from 'path'

import { resolveInstructionFile } from '../harness/agent-instructions'
import type { ModuleInstaller } from '../migrations/module/types'
import { WorkflowConfig, skillsTemplatesPath } from '../types'
import { hashFileContent } from '../utils'

export const workflowSkillInstallerMeta: ModuleInstaller = {
  name: 'workflow-skill',
  currentVersion: 1,
  migrations: []
}

/** Where the workflow skill is installed, relative to the project root. */
export const WORKFLOW_SKILL_DIR = '.claude/skills/sf-workflow'

/** The two status document sets the template ships: Team under `statuses/`, Solo under `statuses-solo/`. */
const STATUS_SETS = ['statuses', 'statuses-solo'] as const

/** The suffix of a status document a preset switch set aside because it was edited (#1248). */
export const RETIRED_STATUS_SUFFIX = '.saasfoundry.old'

interface InstallWorkflowSkillParams {
  targetPath: string
  workflow: WorkflowConfig
  projectUrl?: string
  /** False for a monorepo app: its AGENTS.md sits under the root one, which carries the section. */
  injectSection?: boolean
  /**
   * The project's `manifest.fileHashes`: a status document whose bytes still match its baseline is the
   * CLI's own and can be removed when the preset no longer ships it (#1248).
   */
  baselines?: Record<string, string>
  /**
   * False when `sf workflow use` switches the preset of a project that already has its harness (#1248):
   * the PR-review listener belongs to the first install, not to every preset switch.
   */
  depositListener?: boolean
}

export interface WorkflowSkillInstallResult {
  /** Project-relative paths of every file the install wrote. */
  written: string[]
  /** Status documents the previous preset shipped and this one does not, removed because they were unchanged. */
  removed: string[]
  /** Status documents the previous preset shipped and the user edited: kept beside the set, under a `.saasfoundry.old` name. */
  kept: { path: string; keptAs: string }[]
}

/**
 * Install workflow skill from template.
 *
 * This function:
 * 1. Copies workflow skill template from scaffolds/skills-templates/workflow/
 * 2. Keeps only the status documents of the configured preset, and retires those of a previous one
 * 3. Replaces placeholders in SKILL.md
 * 4. Injects workflow section into the project instructions (AGENTS.md)
 *
 * Configuration is read from .saasfoundry.json (no .env needed).
 *
 * Used by builders when workflow is configured during project generation, and by `sf workflow use`.
 */
export async function installWorkflowSkill({
  targetPath,
  workflow,
  projectUrl,
  injectSection = true,
  baselines = {},
  depositListener = true
}: InstallWorkflowSkillParams): Promise<WorkflowSkillInstallResult> {
  // Source: scaffolds/skills-templates/workflow/
  const templatePath = resolve(skillsTemplatesPath, 'workflow')
  const targetSkillPath = `${targetPath}/${WORKFLOW_SKILL_DIR}`
  const statusesPath = `${targetSkillPath}/statuses`

  // Keep only the status docs of the configured preset — a 5-status solo
  // project must never ship orphan Human Testing / Ready docs.
  const presetSet = workflow.template === 'SaaSFoundry Solo' ? 'statuses-solo' : 'statuses'
  const presetDocs = new Set(await readdir(resolve(templatePath, presetSet)))

  // Everything but the two status sets is copied as it is; the preset's set lands in `statuses/`.
  const isStatusSet = (source: string) => {
    const rel = relative(templatePath, source)
    return STATUS_SETS.some((set) => rel === set || rel.startsWith(`${set}${sep}`))
  }
  await ensureDir(targetSkillPath)
  await remove(`${targetSkillPath}/statuses-solo`)
  await copy(templatePath, targetSkillPath, { filter: (source) => !isStatusSet(source) })

  // A re-install (`sf workflow use` switching presets) retires the documents of the previous set (#1248):
  // removed when they are still the CLI's bytes, set aside when the user edited them, so the workflow CLI,
  // which resolves a status by its slug, never reads a previous preset's document.
  const { removed, kept } = await retireStatusDocs(templatePath, statusesPath, presetDocs, baselines)
  await copy(resolve(templatePath, presetSet), statusesPath)

  // Install the trusted-base board listener only for GitHub Projects. Existing
  // project workflows are user-owned and must never be overwritten on refresh.
  if (workflow.tool === 'github-projects' && depositListener) {
    const actionsDir = resolve(targetPath, '.github/workflows')
    await ensureDir(actionsDir)
    await copy(resolve(templatePath, 'github/pr-review-sync.yml'), resolve(actionsDir, 'pr-review-sync.yml'), { overwrite: false, errorOnExist: false })
  }

  // Replace placeholders in SKILL.md
  const skillMdPath = `${targetSkillPath}/SKILL.md`
  let skillMdContent = await readFile(skillMdPath, 'utf8')
  const workflowName = workflow.template || workflow.tool
  const toolDisplayName =
    workflow.tool === 'github-projects' ? 'GitHub Projects' : workflow.tool === 'jira' ? 'Jira' : workflow.tool === 'notion' ? 'Notion' : workflow.tool === 'linear' ? 'Linear' : workflow.tool
  const statusesList = (workflow.statuses || [])
    .map((s, i) => {
      const slug = s.name.toLowerCase().replace(/\s+/g, '-')
      return `${i + 1}. **${s.name}**${s.color ? ` (${s.color})` : ''} — Read \`statuses/${i + 1}-${slug}.md\` for full description`
    })
    .join('\n')

  skillMdContent = skillMdContent
    .replace(/\{\{WORKFLOW_NAME\}\}/g, workflowName || '')
    .replace(/\{\{TOOL\}\}/g, toolDisplayName || '')
    .replace(/\{\{STATUSES_LIST\}\}/g, statusesList || 'No statuses configured.')
    .replace(/\{\{DRAFTING_STATUSES_LIST\}\}/g, draftingStatusesList(presetDocs))
  await writeFile(skillMdPath, skillMdContent)

  if (injectSection) await injectWorkflowSection({ targetPath, workflow, projectUrl })

  const written = (await listFiles(templatePath))
    .filter((file) => !STATUS_SETS.some((set) => file.startsWith(`${set}/`)))
    .concat([...presetDocs].map((doc) => `statuses/${doc}`))
    .map((file) => `${WORKFLOW_SKILL_DIR}/${file}`)
    .sort()
  return { written, removed, kept }
}

/** The SRS drafting phases, each with the document the installed preset ships for it (#1248: never another preset's name). */
const DRAFTING_PHASES = [
  ['ai-drafting', 'AI drafter runs against the configured backend'],
  ['human-review', 'spec owner reviews and approves'],
  ['spawning', 'children land in Backlog, drafting ticket reaches Done']
] as const

function draftingStatusesList(presetDocs: Set<string>): string {
  const docs = [...presetDocs].sort()
  return DRAFTING_PHASES.flatMap(([slug, description]) => {
    const doc = docs.find((name) => name.endsWith(`-${slug}.md`))
    return doc ? [`- \`statuses/${doc}\` — ${description}`] : []
  }).join('\n')
}

/**
 * Retire the status documents in `statusesPath` that another preset ships and the one being installed does
 * not. A document is the CLI's own when its bytes match its baseline in `fileHashes`, or a document either
 * status set of the template ships under that name: it is removed. Otherwise it was edited: it is moved to
 * `<name>.saasfoundry.old`, which the workflow CLI does not resolve, and reported. A document no preset ships
 * (one the user wrote for a status of their own) is not the CLI's to retire and stays where it is.
 */
async function retireStatusDocs(templatePath: string, statusesPath: string, presetDocs: Set<string>, baselines: Record<string, string>): Promise<Pick<WorkflowSkillInstallResult, 'removed' | 'kept'>> {
  const removed: string[] = []
  const kept: WorkflowSkillInstallResult['kept'] = []
  const otherPresetDocs = new Set<string>()
  for (const set of STATUS_SETS) for (const name of await readdir(resolve(templatePath, set))) if (!presetDocs.has(name)) otherPresetDocs.add(name)
  for (const name of [...otherPresetDocs].sort()) {
    const fullPath = join(statusesPath, name)
    const stat = await lstat(fullPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!stat?.isFile()) continue
    const relPath = `${WORKFLOW_SKILL_DIR}/statuses/${name}`
    const content = await readFile(fullPath)
    if (baselines[relPath] === hashFileContent(content) || (await isShippedStatusDoc(templatePath, name, content))) {
      await remove(fullPath)
      removed.push(relPath)
      continue
    }
    const keptAs = `${relPath}${RETIRED_STATUS_SUFFIX}`
    // An earlier sidecar is the user's too: never overwritten, the document then stays and is reported.
    if (await pathExists(`${fullPath}${RETIRED_STATUS_SUFFIX}`)) {
      kept.push({ path: relPath, keptAs: relPath })
      continue
    }
    await move(fullPath, `${fullPath}${RETIRED_STATUS_SUFFIX}`)
    kept.push({ path: relPath, keptAs })
  }
  return { removed, kept }
}

async function isShippedStatusDoc(templatePath: string, name: string, content: Buffer): Promise<boolean> {
  for (const set of STATUS_SETS) {
    const shipped = await readFile(resolve(templatePath, set, name)).catch(() => undefined)
    if (shipped?.equals(content)) return true
  }
  return false
}

async function listFiles(root: string, prefix = ''): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...(await listFiles(root, rel)))
    else if (entry.isFile()) files.push(rel)
  }
  return files
}

const WORKFLOW_SECTION_MARKER = '## Workflow System'

/** The project instructions already carry the generated "Workflow System" section. */
export async function hasWorkflowSection(targetPath: string): Promise<boolean> {
  const instructionFile = await resolveInstructionFile(targetPath)
  if (!instructionFile) return false
  return (await readFile(`${targetPath}/${instructionFile}`, 'utf8')).includes(WORKFLOW_SECTION_MARKER)
}

/**
 * Generate and inject workflow section into the project instructions: AGENTS.md,
 * or the CLAUDE.md of a project that predates #937 (see resolveInstructionFile).
 */
export async function injectWorkflowSection({ targetPath, workflow, projectUrl }: InstallWorkflowSkillParams) {
  const instructionFile = await resolveInstructionFile(targetPath)
  if (!instructionFile) return
  const instructionsPath = `${targetPath}/${instructionFile}`

  let instructionsContent = await readFile(instructionsPath, 'utf8')

  // Generate workflow section
  const workflowSection = generateWorkflowSection(workflow, projectUrl)

  const sectionMarker = WORKFLOW_SECTION_MARKER
  const gitWorkflowMarker = '## Git Workflow'
  const developmentCommandsMarker = '## Development Commands'

  if (instructionsContent.includes(sectionMarker)) {
    // Idempotent re-install (preset upgrade): replace the existing section,
    // which spans from its heading to the next top-level heading (or EOF).
    const sectionRegex = /## Workflow System[\s\S]*?(?=\n## |$)/
    instructionsContent = instructionsContent.replace(sectionRegex, `${workflowSection}\n`)
  } else if (instructionsContent.includes(gitWorkflowMarker) && instructionsContent.includes(developmentCommandsMarker)) {
    // Inject between Git Workflow and Development Commands
    instructionsContent = instructionsContent.replace(developmentCommandsMarker, `${workflowSection}\n\n${developmentCommandsMarker}`)
  } else {
    // Append at the end
    instructionsContent += `\n\n${workflowSection}`
  }

  await writeFile(instructionsPath, instructionsContent)
}

/**
 * Generate workflow section content for the project instructions
 */
function generateWorkflowSection(workflow: WorkflowConfig, projectUrl?: string): string {
  const workingBranch = workflow.workingBranch || 'develop'
  const prTargetBranch = workflow.prTargetBranch || workingBranch
  const workflowName = workflow.template || workflow.tool

  const sections: string[] = []

  sections.push('## Workflow System')
  sections.push('')
  sections.push('**This project uses an AI-assisted workflow system. All workflow documentation is managed by the `sf-workflow` skill.**')
  sections.push('')
  sections.push('### Quick Reference')
  sections.push('')
  sections.push('- **Tool**: ' + (workflow.tool === 'github-projects' ? 'GitHub Projects' : workflow.tool))
  if (projectUrl) {
    sections.push('- **Project URL**: ' + projectUrl)
  }
  sections.push('- **Working Branch**: `' + workingBranch + '`')
  sections.push('- **PR Target Branch**: `' + prTargetBranch + '`')
  if (workflowName) {
    sections.push('- **Workflow Template**: ' + workflowName)
  }
  sections.push('')

  // Branch naming
  if (workflow.branchNaming) {
    sections.push('### Branch Naming')
    sections.push('')
    if (workflow.branchNaming.feature) {
      sections.push('- Features: `' + workflow.branchNaming.feature + '`')
    }
    if (workflow.branchNaming.fix) {
      sections.push('- Fixes: `' + workflow.branchNaming.fix + '`')
    }
    if (workflow.branchNaming.release) {
      sections.push('- Releases: `' + workflow.branchNaming.release + '`')
    }
    sections.push('')
  }

  // Commit format
  if (workflow.commitFormat) {
    sections.push('### Commit Format')
    sections.push('')
    if (workflow.commitFormat.pattern) {
      sections.push('Pattern: `' + workflow.commitFormat.pattern + '`')
      sections.push('')
    }
    if (workflow.commitFormat.requireTicket) {
      sections.push('**Ticket reference is required in commit messages.**')
      sections.push('')
    }
    if (workflow.commitFormat.types && workflow.commitFormat.types.length > 0) {
      sections.push('Allowed types: ' + workflow.commitFormat.types.map((t) => `\`${t}\``).join(', '))
      sections.push('')
    }
  }

  // Workflow CLI commands
  sections.push('### Workflow Commands')
  sections.push('')
  sections.push('Use the `sf-workflow` skill CLI to check your current status and next steps:')
  sections.push('')
  sections.push('```bash')
  sections.push('# Check current ticket status and what to do')
  sections.push('.claude/skills/sf-workflow/workflow-cli.sh status <ticket-number>')
  sections.push('')
  sections.push('# Show next status in the workflow')
  sections.push('.claude/skills/sf-workflow/workflow-cli.sh next <ticket-number>')
  sections.push('')
  sections.push('# Display full workflow documentation')
  sections.push('.claude/skills/sf-workflow/workflow-cli.sh help')
  sections.push('```')
  sections.push('')
  sections.push(
    '**IMPORTANT**: The workflow skill contains detailed status descriptions, mandatory actions, and exit conditions for each workflow phase. Always consult it before moving tickets between statuses.'
  )

  return sections.join('\n')
}
