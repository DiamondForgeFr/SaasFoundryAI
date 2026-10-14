import { createHash } from 'crypto'
import { lstat, readFile, readdir } from 'fs/promises'
import { join, posix, resolve } from 'path'

import { safeWriteAgentFile } from './agent-file-writer'
import { getAgentProfile, needsSharedSkills } from './agent-registry'
import type { RoutingOverrides } from './routing-grid'
import { renderTierAgents } from './tier-agents'
import { HarnessAgent, skillsTemplatesPath } from '../types'
import { hashFileContent } from '../utils'

const hashBytes = (content: Buffer): string => createHash('sha256').update(content).digest('hex')

export type { HarnessAgent } from '../types'

export interface AgentInstructionsReport {
  written: string[]
  unchanged: string[]
  conflicts: string[]
  warnings: string[]
  /** Baselines for successfully installed files only; merge these into the manifest. */
  fileHashes: Record<string, string>
}

export class AgentInstructionsError extends Error {
  readonly cause: unknown
  readonly report: AgentInstructionsReport

  constructor(path: string, report: AgentInstructionsReport, cause: unknown) {
    super(`Failed to install ${path}. Inspect the destination and the partial report, then retry the agent instruction installation.`)
    this.name = 'AgentInstructionsError'
    this.cause = cause
    this.report = report
  }
}

export interface InstallAgentInstructionsParams {
  targetPath: string
  agents: HarnessAgent[]
  manifest?: { fileHashes?: Record<string, string>; modules?: { harness?: { routing?: RoutingOverrides } } }
  /** Adoption references source instructions without copying or normalizing skills. */
  referenceOnly?: boolean
}

const WORKTREE_ORCHESTRATION = `## Parallel implementation and Git worktrees

Propose parallel worktrees only when the user's request contains independent writing streams
that can be delivered concurrently. Read-only exploration and review may use parallel agents
without separate worktrees. Work with sequential dependencies, overlapping file ownership or
unclear boundaries must use one feature worktree and sequential execution.

Before proposing parallel implementation, read \`.saasfoundry.json\` and use
\`workflow.workingBranch\`; never hardcode a branch name. Keep the primary checkout on that
configured working branch. Do not let feature workers write in the primary checkout while
parallel worktrees are active.

For each independent writing stream, define one ticket, branch and worktree path, plus its owned
files and dependency boundary. Start from a synchronized configured working branch. Each worker
must stay inside its assigned worktree and ownership boundary, preserve other agents' changes
and never revert unrelated work. The agent proposes this execution shape; the user retains
control when parallel implementation was not already authorized. If authorization, clean
separation, Git support or a synchronized base is unavailable, explain the constraint and use
one worktree or sequential execution.

After each stream is complete, commit and push through the configured workflow. After its merge,
return to the primary checkout, check out and synchronize the configured working branch, verify
the merge, then remove the completed worktree and local branch only when they are merged and no
longer in use. Never remove or overwrite user-owned worktrees, branches, uncommitted changes,
stashes or credentials implicitly.
`

const CAPABILITIES = `## Execution capabilities

Use the current agent's native tools for reading, editing, shell commands and delegation.
When delegation is available and authorized, assign independent work to agents; otherwise
execute the same steps sequentially. A sequential self-review is not an independent review:
report that limitation and retain any required human review. Tool names in legacy examples
describe capabilities, not required APIs. Use the user's current request as skill arguments.
Do not assume Claude Code hooks, model selection, tool permissions or credentials transfer.
Run preconditions explicitly, and stop to report a missing capability when no equivalent exists.
Never bypass CLI guards, required approvals, tests or workflow status exit conditions.
The project manifest and workflow rules take precedence over generic skill examples,
including branch names, commit formats, staging, pushing and approval requirements.
Legacy /task examples name roles: use native delegation if available and authorized,
or perform the role's work sequentially with the review limitation stated above.

${WORKTREE_ORCHESTRATION}
`

export const SELF_ONBOARDING_INSTRUCTIONS = `## Coding-agent identity and onboarding

At session initialization, use the coding-agent identity explicitly supplied by the current
host or session. Never infer an identity from a model or provider name, executable names,
instruction files, repository contents or PATH. If the host identity is absent or ambiguous,
ask the user to select one registered coding-agent profile and do not change the project.

Run \`sf agents list --json\` and compare that explicit identity with the effective shared and
local inventories. When a supported current agent is undeclared, report both inventories and
ask the user to choose exactly one action: add the current agent, replace the declaration with
an explicitly named non-empty set, or leave the project unchanged. A no-change decision runs
no mutating command.

Only after the user accepts add or replace, ask whether the declaration should be local to the
current machine/worktree or shared through the repository. Use \`sf agents enable <agent>\` for
an additive local change, \`sf agents enable <agent> --scope shared\` for an additive shared
change, and \`sf agents replace <agents...> --scope <local|shared>\` for an exact declaration.
Local onboarding must leave tracked files unchanged. Shared onboarding must produce reviewable
repository changes. Replacing a declaration never authorizes deleting existing instructions,
skills, hooks or settings.
`

export const PROFILE_TRANSITION_INSTRUCTIONS = `## Managed project capabilities

Treat the capability block from \`sf status --claude-friendly --no-network\` as authoritative.
When an eligible managed \`harness\` or \`stack\` project should become \`full\`, preview the
additive transition with \`sf update --target-profile full --dry-run --json\`. Do not run
\`sf new --profile full\` inside an existing repository. A retained external product stays on
the harness path; a throwaway POC uses the documented POC-preservation and clean-project flow.
`

/**
 * How to touch files and the shell so the host can check each call (#947). An interpreter
 * heredoc that writes files cannot be analysed and asks the developer every time, even in
 * bypass mode; sub-agents see no memory of that, only these instructions.
 */
export const TOOLING_HYGIENE_INSTRUCTIONS = `## File edits and shell calls

Edit files with the agent's native file tools (read, edit, write), never with interpreter
heredocs or scripts that rewrite files (\`python3 - <<EOF\`, \`node -e\`). Keep each shell call
to one plain command, run from the project root. The harness's read-only commands
(\`workflow-cli.sh status|next|help\`, \`sf status\`, \`sf agents list\`) are allowed in
\`.claude/settings.json\`; commands that change a ticket, a board or a pull request still ask.
`

/**
 * AGENTS.md is the project's own instructions (#937): its body comes from a scaffold template and
 * belongs to the project. Only the region between these markers is generated, and every refresh
 * rewrites it, so the blocks every agent needs follow the CLI version without touching user text.
 */
export const GENERATED_REGION_START = '<!-- saasfoundry:generated:start -->'
export const GENERATED_REGION_END = '<!-- saasfoundry:generated:end -->'

const AGENT_TOOLING_HYGIENE = `## File edits and shell calls

Edit files with the agent's native file tools (read, edit, write), never with interpreter
heredocs or scripts that rewrite files (\`python3 - <<EOF\`, \`node -e\`): a host cannot analyse
those calls before running them. Keep each shell call to one plain command, run from the
project root. Hosts that support it pre-approve the harness's read-only commands
(\`workflow-cli.sh status|next|help\`, \`sf status\`, \`sf agents list\`); commands that change a
ticket, a board or a pull request still ask.
`

export const GENERATED_INSTRUCTIONS = `${GENERATED_REGION_START}
<!-- Generated by SaaSFoundryAI; sf update rewrites this region. Edit the rest of the file freely. -->

${AGENT_TOOLING_HYGIENE}
${PROFILE_TRANSITION_INSTRUCTIONS.replace('--claude-friendly', '--agent-friendly')}
${SELF_ONBOARDING_INSTRUCTIONS}
${CAPABILITIES.trimEnd()}
${GENERATED_REGION_END}`

/** Refresh the generated region; undefined when the file has none (a user-authored AGENTS.md). */
export function withGeneratedInstructions(content: string): string | undefined {
  const start = content.indexOf(GENERATED_REGION_START)
  const end = content.indexOf(GENERATED_REGION_END, start)
  if (start < 0 || end < 0) return undefined
  return content.slice(0, start) + GENERATED_INSTRUCTIONS + content.slice(end + GENERATED_REGION_END.length)
}

/** Give a scaffolded root AGENTS.md its (empty) generated region; the planner fills it. */
export function withGeneratedRegion(content: string): string {
  if (content.includes(GENERATED_REGION_START)) return content
  return `${content.trimEnd()}\n\n${GENERATED_REGION_START}\n${GENERATED_REGION_END}\n`
}

/** What only Claude Code does (hook, slash invocation, allowlist) — deposited when it is declared. */
export const CLAUDE_CODE_RULE_PATH = '.claude/rules/claude-code.md'

/**
 * Legacy bridge: AGENTS.md pointing at an authoritative CLAUDE.md. Still written for a project whose
 * CLAUDE.md predates #937 (until the harness v3 → v4 migration moves it, #938) and recognised by its bytes; a new install
 * never generates it.
 */
export const COMMON_INSTRUCTIONS = `# SaaSFoundry agent instructions

Read \`CLAUDE.md\` in this project before working: it remains the authoritative project
instructions during this additive compatibility phase. Read files that it references as well.
This preserves the existing project rules and developer customizations without duplicating them.
Do not rewrite paths to \`.claude/\`: the existing guarded scripts and docs remain there.

Read \`.saasfoundry.json\` and run \`sf status --claude-friendly --no-network\` before
asking about configured scope, tools or modules. Follow its output language and workflow.
Discover shared skills under \`.agents/skills/sf-*/SKILL.md\`. Before a status transition,
read the matching status document and execute the existing workflow CLI:
\`.claude/skills/sf-workflow/workflow-cli.sh\`. Use its configured board tool, not raw mutations.
Commit and push before AI testing; preserve Human testing requirements. Delivery tickets
need a verified merge before Done, except for a validated \`nature:bundled-pr\` child whose
commit ships in its non-Epic delivery parent's PR. An Epic has no PR: its first child entering
In progress starts it, and it reaches Done only after every native child has board status Done.

${TOOLING_HYGIENE_INSTRUCTIONS}
${PROFILE_TRANSITION_INSTRUCTIONS}

${SELF_ONBOARDING_INSTRUCTIONS}

${CAPABILITIES.trimEnd()}\n`

/** Legacy CLAUDE.md bridge to an authoritative AGENTS.md. Recognised by its bytes, no longer written: Claude Code reads AGENTS.md natively. */
export const CODEX_SOURCE_CLAUDE_BRIDGE = `# SaaSFoundry Claude compatibility instructions

@AGENTS.md

Read \`AGENTS.md\` as the authoritative project instructions and follow every file it
references. Claude Code must load applicable procedures manually from
\`.agents/skills/*/SKILL.md\`; do not copy skills into \`.claude/skills\`.
Follow the coding-agent identity and onboarding procedure in \`AGENTS.md\` before changing
any declaration.

${CAPABILITIES.trimEnd()}
Do not copy or change agent settings, hooks, permissions, credentials, secrets or models.
`

export const ADOPTION_COMMON_INSTRUCTIONS = `# SaaSFoundry agent adoption instructions

Read \`CLAUDE.md\` in this project before working: it remains the authoritative project
instructions. Read every file it references. Load applicable procedures manually from
\`.claude/skills/*/SKILL.md\`; do not copy or normalize them into another skill directory.

Read \`.saasfoundry.json\` and run \`sf status --claude-friendly --no-network\` before
asking about configured scope, tools or modules. Follow its output language and workflow.
Before a status transition, read the matching status document and execute the guarded CLI:
\`.claude/skills/sf-workflow/workflow-cli.sh\`. Use its configured board tool and preserve
all workflow guards, tests and approval requirements.

${TOOLING_HYGIENE_INSTRUCTIONS}
${PROFILE_TRANSITION_INSTRUCTIONS}

${SELF_ONBOARDING_INSTRUCTIONS}

${CAPABILITIES.trimEnd()}
Do not copy or change agent settings, hooks, permissions, credentials, secrets or models.
`

export interface InstructionSourceReport {
  source: 'claude' | 'codex' | 'mixed' | 'missing'
  claudeInstructions: boolean
  sharedInstructions: boolean
}

/** Refuse links in destinations, including linked ancestor directories. */
async function hasLinkedAncestor(root: string, relativePath: string): Promise<boolean> {
  let current = resolve(root)
  for (const part of relativePath.split('/')) {
    current = join(current, part)
    try {
      if ((await lstat(current)).isSymbolicLink()) return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }
  return false
}

async function readInstructionFile(root: string, path: 'CLAUDE.md' | 'AGENTS.md'): Promise<Buffer | undefined> {
  if (await hasLinkedAncestor(root, path)) throw new Error(`${path}: symbolic links are not allowed while inspecting instruction sources.`)
  const fullPath = join(root, path)
  try {
    const stat = await lstat(fullPath)
    if (!stat.isFile()) throw new Error(`${path}: expected a regular instruction file.`)
    return await readFile(fullPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

interface InspectedInstructionSource {
  report: InstructionSourceReport
  referenceOnly: boolean
}

async function inspectInstructionFiles(targetPath: string): Promise<InspectedInstructionSource> {
  const [claude, shared] = await Promise.all([readInstructionFile(targetPath, 'CLAUDE.md'), readInstructionFile(targetPath, 'AGENTS.md')])
  const claudeInstructions = claude !== undefined
  const sharedInstructions = shared !== undefined
  const generatedClaudeBridge = claude?.equals(Buffer.from(CODEX_SOURCE_CLAUDE_BRIDGE)) ?? false
  const generatedAdoptionBridge = shared?.equals(Buffer.from(ADOPTION_COMMON_INSTRUCTIONS)) ?? false
  const generatedSharedBridge = generatedAdoptionBridge || (shared?.equals(Buffer.from(COMMON_INSTRUCTIONS)) ?? false)

  if (generatedClaudeBridge && generatedSharedBridge) {
    throw new Error('CLAUDE.md and AGENTS.md form a generated instruction cycle; reconcile the authoritative instructions before retrying.')
  }
  if (generatedClaudeBridge && !sharedInstructions) {
    throw new Error('CLAUDE.md is a dangling generated bridge because AGENTS.md is missing; restore or reconcile the authoritative instructions before retrying.')
  }
  if (generatedSharedBridge && !claudeInstructions) {
    throw new Error('AGENTS.md is a dangling generated bridge because CLAUDE.md is missing; restore or reconcile the authoritative instructions before retrying.')
  }

  let source: InstructionSourceReport['source']
  if (!claudeInstructions && !sharedInstructions) source = 'missing'
  else if (generatedClaudeBridge || (!claudeInstructions && sharedInstructions)) source = 'codex'
  else if (generatedSharedBridge || (claudeInstructions && !sharedInstructions)) source = 'claude'
  else source = 'mixed'
  return { report: { source, claudeInstructions, sharedInstructions }, referenceOnly: generatedAdoptionBridge }
}

/** Identify the authoritative root without following links or interpreting user text. */
export async function inspectInstructionSource(targetPath: string): Promise<InstructionSourceReport> {
  return (await inspectInstructionFiles(targetPath)).report
}

/** A SaaSFoundry-scaffolded AGENTS.md: it carries the generated region (#937). */
export async function hasGeneratedRegion(targetPath: string): Promise<boolean> {
  const content = await readInstructionFile(targetPath, 'AGENTS.md').catch(() => undefined)
  return content?.includes(GENERATED_REGION_START) ?? false
}

const isLegacyBridge = (content: Buffer): boolean => [COMMON_INSTRUCTIONS, ADOPTION_COMMON_INSTRUCTIONS, CODEX_SOURCE_CLAUDE_BRIDGE].some((bridge) => content.equals(Buffer.from(bridge)))

/**
 * The file that holds this directory's project instructions, for the code that edits them
 * (workflow section, placeholders): AGENTS.md, or the CLAUDE.md of a project that predates #937.
 * A generated bridge is never the answer, and a custom CLAUDE.md keeps the role it had unless
 * AGENTS.md carries the generated region. Undefined when neither file holds instructions.
 */
export async function resolveInstructionFile(targetPath: string): Promise<'AGENTS.md' | 'CLAUDE.md' | undefined> {
  const read = async (path: 'AGENTS.md' | 'CLAUDE.md') => {
    const content = await readInstructionFile(targetPath, path).catch(() => undefined)
    return content && !isLegacyBridge(content) ? content : undefined
  }
  const [shared, claude] = await Promise.all([read('AGENTS.md'), read('CLAUDE.md')])
  if (shared && (!claude || shared.includes(GENERATED_REGION_START))) return 'AGENTS.md'
  return claude ? 'CLAUDE.md' : undefined
}

/**
 * An untracked existing file is user-owned, unlike writeMigratedFile's new-file
 * case. Preserve it and any existing reconciliation sidecar instead of replacing it.
 */
async function deposit(root: string, path: string, content: Buffer, mode: number, baselines: Record<string, string>, report: AgentInstructionsReport, merge = false): Promise<void> {
  if (await hasLinkedAncestor(root, path)) {
    report.conflicts.push(path)
    report.warnings.push(`${path}: symbolic link destination left untouched.`)
    return
  }
  const fullPath = join(root, path)
  let current: Buffer | undefined
  try {
    const stat = await lstat(fullPath)
    if (!stat.isFile()) {
      report.conflicts.push(path)
      report.warnings.push(`${path}: destination is not a regular file.`)
      return
    }
    current = await readFile(fullPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const hash = hashBytes(content)
  if (current?.equals(content)) {
    report.unchanged.push(path)
    if (!merge) report.fileHashes[path] = hash
    return
  }
  if (merge) {
    // The planner rendered this file from its current bytes: only its generated region changed.
    await safeWriteAgentFile(root, path, content, mode, current)
    report.written.push(path)
    return
  }
  if (current && (!baselines[path] || hashBytes(current) !== baselines[path])) {
    report.conflicts.push(path)
    const sidecar = `${path}.saasfoundry.new`
    if (await hasLinkedAncestor(root, sidecar)) {
      report.warnings.push(`${path}: conflict; symbolic link sidecar left untouched.`)
      return
    }
    try {
      await safeWriteAgentFile(root, sidecar, content, mode)
      report.warnings.push(`${path}: user content preserved; reconcile ${sidecar}.`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      report.warnings.push(`${path}: user content and existing ${sidecar} preserved; sidecar may be stale.`)
    }
    return
  }
  await safeWriteAgentFile(root, path, content, mode, current)
  report.written.push(path)
  report.fileHashes[path] = hash
}

export function normalizeSkill(content: string, name: string, path: string, warnings: string[]): string | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
  if (!match && content.startsWith('---')) {
    warnings.push(`${path}: malformed frontmatter; skill not installed.`)
    return undefined
  }
  // Serialize a narrow discovery schema instead of carrying host-specific YAML
  // (including malformed or duplicate fields) into another agent's parser.
  const fallback = `SaaSFoundry ${name.replace(/^sf-/, '').replace(/-/g, ' ')} procedures. Follow the project workflow and CLI guards.`
  const metadataLines = match?.[1].split(/\r?\n/) ?? []
  const descriptionIndex = metadataLines.findIndex((line) => /^description:/.test(line))
  let description = descriptionIndex >= 0 ? metadataLines[descriptionIndex].slice('description:'.length).trim() : ''
  if (!description || /^[|>][-+]?$/.test(description)) {
    const continuation: string[] = []
    for (let index = descriptionIndex + 1; descriptionIndex >= 0 && index < metadataLines.length && /^[ \t]+\S/.test(metadataLines[index]); index++) {
      continuation.push(metadataLines[index].trim())
    }
    description = continuation.join(' ')
  }
  if (!description) description = fallback
  const common = [`name: ${name}`, `description: ${JSON.stringify(description)}`]
  if (description === fallback) warnings.push(`${path}: generated discovery metadata for a legacy skill.`)
  if (match) {
    for (const field of match[1].matchAll(/^([\w-]+):/gm)) {
      if (!['name', 'description'].includes(field[1])) warnings.push(`${path}: omitted frontmatter '${field[1]}'; native configuration is unchanged.`)
    }
  }
  const body = translateSkillBody(match ? content.slice(match[0].length) : content)
  if (/\bTask\s*\(|\bsubagent_type\b|\b(?:haiku|sonnet|opus)\b|\bclaude\s+-[a-z]|\$\{?CLAUDE_|\/(?:task|sf-)\b|SessionStart|UserPromptSubmit/i.test(body)) {
    warnings.push(`${path}: legacy model/tool-specific examples remain; translate capabilities explicitly before executing them.`)
  }
  // One blank line between the capabilities and the skill, whatever blank lines the source opens with.
  return `---\n${common.join('\n')}\n---\n\n${CAPABILITIES.trimEnd()}\n\n${body.replace(/^(?:[ \t]*\r?\n)+/, '')}`
}

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const INLINE_CODE = /(`+)([\s\S]*?[^`])\1(?!`)/g

const DELEGATION = 'native delegation when available (otherwise execute the same work sequentially)'

/** Translate host-specific prose. Code never reaches this function. */
function translateProse(text: string): string {
  return text
    .replace(/\$ARGUMENTS\b/g, 'the current user request')
    .replace(/\bPARALLEL ONLY\b/g, 'Prefer parallel delegation when available; otherwise execute sequentially')
    .replace(/\bTask tool/gi, DELEGATION)
}

/**
 * Translate one prose line around its inline code spans, which are copied byte for byte. Two
 * spans are prose by meaning: `` !`cmd` `` where the `!` opens the span (Claude Code's context
 * injection, at line start or after whitespace), and the `` `Task` tool `` name.
 */
function translateLine(line: string): string {
  let out = ''
  let last = 0
  for (const match of line.matchAll(INLINE_CODE)) {
    const prose = line.slice(last, match.index)
    const span = match[0]
    const opensLine = last === 0
    last = match.index + span.length
    // A `!` that closes the previous span, as in `generate_handler!`, is not injection (#903).
    if (prose === '!' ? opensLine : /\s!$/.test(prose)) out += `${translateProse(prose.slice(0, -1))}run ${span} and read its output`
    else if (span === '`Task`' && /^ tool\b/i.test(line.slice(last))) {
      out += translateProse(prose) + DELEGATION
      last += ' tool'.length
    } else out += translateProse(prose) + span
  }
  return out + translateProse(line.slice(last))
}

/**
 * Translate a skill body for hosts other than Claude Code (#940). Prose is translated; fenced
 * blocks and inline code are copied byte for byte, so commands and examples stay exact.
 */
export function translateSkillBody(body: string): string {
  let fence: string | undefined
  let out = ''
  for (const line of body.split(/(?<=\n)/)) {
    const marker = FENCE_LINE.exec(line.replace(/\r?\n$/, ''))
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined
      out += line
    } else if (marker && !(marker[1][0] === '`' && marker[2].includes('`'))) {
      fence = marker[1]
      // Claude Code runs a ```! block and injects its output; another host has to be told.
      if (marker[2].trim() === '!') out += 'Run this block and read its output:\n\n'
      out += line
    } else {
      out += translateLine(line)
    }
  }
  return out
}

/** The package inventory is the boundary; local caches and private files are never deposits. */
async function bundledFiles(name: string): Promise<Set<string>> {
  const candidates = [join(skillsTemplatesPath, 'core', name), join(skillsTemplatesPath, 'optional', name)]
  if (name === 'sf-workflow') candidates.push(join(skillsTemplatesPath, 'workflow'))
  if (name === 'sf-srs') candidates.push(join(skillsTemplatesPath, 'sf-srs'))
  if (name.startsWith('sf-tool-')) candidates.push(join(skillsTemplatesPath, 'tools', name.slice('sf-tool-'.length)))
  const files = new Set<string>()
  async function visit(root: string, relative = ''): Promise<void> {
    let entries
    try {
      entries = await readdir(join(root, relative), { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const path = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) await visit(root, path)
      else if (entry.isFile()) files.add(path)
    }
  }
  for (const candidate of candidates) await visit(candidate)
  // The Solo installer moves this bundled directory to `statuses`. Keep the
  // installed names inside the trusted inventory as well as the source names.
  if (name === 'sf-workflow') {
    for (const file of [...files]) {
      if (file.startsWith('statuses-solo/')) files.add(`statuses/${file.slice('statuses-solo/'.length)}`)
    }
  }
  return files
}

function retainLegacyDocLinks(content: string, skillPath: string): string {
  return content.replace(/\]\(([^\s)]+)([^)]*)\)/g, (link, destination: string, title: string) => {
    if (!destination.startsWith('.')) return link
    const sourceTarget = posix.normalize(posix.join('.claude/skills', posix.dirname(skillPath), destination))
    if (!sourceTarget.startsWith('.claude/docs/')) return link
    const sharedDirectory = posix.join('.agents/skills', posix.dirname(skillPath))
    return `](${posix.relative(sharedDirectory, sourceTarget)}${title})`
  })
}

/**
 * Additive bridge after legacy harness deposition. No credentials, hooks, existing
 * Claude files or agent-specific settings are changed. Structural migration and
 * persisted agent selection belong to later lifecycle commands.
 */
export interface AgentInstructionFile {
  path: string
  content: Buffer
  mode: number
  /** A project-owned file whose generated region was refreshed: written over its own bytes, never hash-tracked. */
  merge?: boolean
}
export interface AgentInstructionPlan {
  files: AgentInstructionFile[]
  warnings: string[]
}

/** Render the complete candidate set without changing the target project. */
export async function planAgentInstructions({ targetPath, agents, manifest, referenceOnly = false }: InstallAgentInstructionsParams): Promise<AgentInstructionPlan> {
  const report: AgentInstructionsReport = { written: [], unchanged: [], conflicts: [], warnings: [], fileHashes: {} }
  const plan: AgentInstructionPlan = { files: [], warnings: report.warnings }
  const profiles = [...new Set(agents)].map((agent) => getAgentProfile(agent))
  const inspected = await inspectInstructionFiles(targetPath)
  const instructionSource = inspected.report
  const effectiveReferenceOnly =
    referenceOnly ||
    inspected.referenceOnly ||
    manifest?.fileHashes?.['AGENTS.md'] === hashFileContent(ADOPTION_COMMON_INSTRUCTIONS) ||
    manifest?.fileHashes?.['CLAUDE.md'] === hashFileContent(CODEX_SOURCE_CLAUDE_BRIDGE)
  // Project the skills only when a declared host does not discover the .claude/skills sources itself (#940).
  const projectSkills = needsSharedSkills(profiles.map((profile) => profile.id))
  for (const profile of profiles) {
    report.warnings.push(...profile.limitations.map((limitation) => `${profile.displayName}: ${limitation}`))
    if (profile.instructions === 'manual') report.warnings.push(`${profile.displayName}: Manual instruction loading is required; runtime discovery is not checked.`)
  }
  if (instructionSource.source === 'missing') {
    report.warnings.push('CLAUDE.md and AGENTS.md are missing: deposit or author the project instructions before installing compatibility bridges.')
    return plan
  }
  // One delegation agent per routing tier for each declared host the grid covers (#929). An adoption
  // only references the project's own setup, so it adds none.
  if (!effectiveReferenceOnly) {
    try {
      for (const file of renderTierAgents(
        profiles.map((profile) => profile.id),
        manifest?.modules?.harness?.routing
      ))
        plan.files.push({ path: file.path, content: Buffer.from(file.content), mode: 0o644 })
    } catch (error) {
      report.warnings.push(`Tier agents not generated: ${(error as Error).message}`)
    }
  }
  // Only declared hosts get an entrypoint (#937): an existing undeclared one is left as it is.
  const wrapperContent = Buffer.from('# SaaSFoundry shared instructions\n\n@AGENTS.md\n')
  const wrapperFiles: AgentInstructionFile[] = [
    ...new Set(profiles.filter((profile) => profile.sharedInstructions && profile.instructionFile !== 'AGENTS.md').map((profile) => profile.instructionFile))
  ].map((path) => ({ path, content: wrapperContent, mode: 0o644 }))
  // A scaffolded AGENTS.md carries the generated region: it is the project's instructions, and
  // only that region and the host additions are rendered. A user-authored one is left alone.
  const sharedPath = join(targetPath, 'AGENTS.md')
  const shared = instructionSource.sharedInstructions && !(await hasLinkedAncestor(targetPath, 'AGENTS.md')) ? await readFile(sharedPath) : undefined
  const refreshed = shared && withGeneratedInstructions(shared.toString('utf8'))
  if (refreshed !== undefined && shared) {
    plan.files.push({ path: 'AGENTS.md', content: Buffer.from(refreshed), mode: (await lstat(sharedPath)).mode & 0o777, merge: true })
    if (profiles.some((profile) => profile.id === 'claude-code')) {
      plan.files.push({ path: CLAUDE_CODE_RULE_PATH, content: await readFile(join(skillsTemplatesPath, 'harness', 'claude-code.md')), mode: 0o644 })
    }
    plan.files.push(...wrapperFiles)
    if (!projectSkills) return plan
  } else if (instructionSource.source === 'codex') {
    plan.files.push(...wrapperFiles)
    return plan
  } else {
    if (instructionSource.source === 'mixed') {
      report.warnings.push('CLAUDE.md and AGENTS.md both contain custom instructions. Reconcile their authority manually; AGENTS.md will be reported as a normal conflict.')
    }
    plan.files.push({ path: 'AGENTS.md', content: Buffer.from(effectiveReferenceOnly ? ADOPTION_COMMON_INSTRUCTIONS : COMMON_INSTRUCTIONS), mode: 0o644 })
    plan.files.push(...wrapperFiles)
    if (effectiveReferenceOnly || !projectSkills) return plan
  }
  const baselines = manifest?.fileHashes ?? {}
  const source = '.claude/skills'
  if (await hasLinkedAncestor(targetPath, source)) {
    report.warnings.push(`${source}: symbolic link source skipped; use regular installed harness files.`)
    return plan
  }
  let skills
  try {
    skills = await readdir(join(targetPath, source), { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    report.warnings.push(`${source}: no installed compatibility skills found.`)
    return plan
  }
  for (const skill of skills.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!skill.name.startsWith('sf-')) continue
    if (!skill.isDirectory()) {
      report.warnings.push(`${source}/${skill.name}: non-directory or symbolic link skill skipped.`)
      continue
    }
    const inventory = await bundledFiles(skill.name)
    if (!inventory.has('SKILL.md')) {
      report.warnings.push(`${source}/${skill.name}: no bundled file inventory; custom skill left untouched.`)
      continue
    }
    const skillPath = `${source}/${skill.name}/SKILL.md`
    if (await hasLinkedAncestor(targetPath, skillPath)) {
      report.warnings.push(`${skillPath}: symbolic link skill skipped.`)
      continue
    }
    let original
    try {
      original = await readFile(join(targetPath, skillPath), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      report.warnings.push(`${skillPath}: missing skill entry point; skipped.`)
      continue
    }
    if (baselines[skillPath] && baselines[skillPath] !== hashFileContent(original)) {
      report.warnings.push(`${skillPath}: customized source preserved; review its generated shared adaptation.`)
    }
    const normalized = normalizeSkill(original, skill.name, skillPath, report.warnings)
    if (!normalized) continue
    const copyTree = async (relativePath: string): Promise<void> => {
      const entries = await readdir(join(targetPath, source, relativePath), { withFileTypes: true })
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const rel = `${relativePath}/${entry.name}`
        if (entry.isSymbolicLink() || entry.name.startsWith('.') || /\.(pem|key|p12)$/i.test(entry.name) || /^(credentials|node_modules)$/i.test(entry.name)) {
          report.warnings.push(`${source}/${rel}: link, private file or dependency directory skipped.`)
          continue
        }
        if (entry.isDirectory()) await copyTree(rel)
        else if (entry.isFile()) {
          if (!inventory.has(rel.slice(skill.name.length + 1))) {
            report.warnings.push(`${source}/${rel}: not in the bundled file inventory; skipped.`)
            continue
          }
          const sourcePath = join(targetPath, source, rel)
          let content = rel === `${skill.name}/SKILL.md` ? Buffer.from(normalized) : await readFile(sourcePath)
          if (rel.endsWith('.md')) content = Buffer.from(retainLegacyDocLinks(content.toString('utf8'), rel))
          plan.files.push({ path: `.agents/skills/${rel}`, content, mode: (await lstat(sourcePath)).mode & 0o777 })
        }
      }
    }
    await copyTree(skill.name)
  }
  return plan
}

export async function installAgentInstructions(params: InstallAgentInstructionsParams): Promise<AgentInstructionsReport> {
  const plan = await planAgentInstructions(params)
  return installPlannedAgentInstructions(params.targetPath, plan, params.manifest?.fileHashes)
}

/** Apply an already reviewed render without inspecting or rendering the source again. */
export async function installPlannedAgentInstructions(targetPath: string, plan: AgentInstructionPlan, baselines: Record<string, string> = {}): Promise<AgentInstructionsReport> {
  const report: AgentInstructionsReport = { written: [], unchanged: [], conflicts: [], warnings: [...plan.warnings], fileHashes: {} }
  for (const file of plan.files) {
    try {
      await deposit(targetPath, file.path, file.content, file.mode, baselines, report, file.merge)
    } catch (error) {
      throw new AgentInstructionsError(file.path, report, error)
    }
  }
  return report
}
