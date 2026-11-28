import { createHash } from 'crypto'
import { lstat, readFile, readdir, rmdir, unlink } from 'fs/promises'
import { join, posix, resolve } from 'path'

import { safeWriteAgentFile } from './agent-file-writer'
import { getAgentProfile, needsSharedSkills } from './agent-registry'
import {
  CODEX_CONFIG_PATH,
  CODEX_DOC_LIMIT_KEY,
  CODEX_INSTRUCTION_LIMIT,
  findGitRoot,
  instructionAppDirs,
  measureCodexInstructions,
  planCodexDocLimit,
  type PendingFiles
} from './codex-instruction-size'
import { CODEX_HOOKS_PATH, CODEX_RETRUST_NOTICE, renderCodexHooks } from './delegation-hooks'
import { CODEX_GUARD_TRUST_NOTICE, withCodexGuard } from './guard-hook'
import { LEGACY_CAPABILITIES, LEGACY_PROFILE_TRANSITION_INSTRUCTIONS, LEGACY_SELF_ONBOARDING_INSTRUCTIONS, LEGACY_TOOLING_HYGIENE_INSTRUCTIONS } from './legacy-bridge-instructions'
import { withCodexSessionStart } from './session-start-hook'
import { BridgeKind, isReleasedBridge, isReleasedBridgeHash, normalizeBridgeText } from './released-bridges'
import type { RoutingOverrides } from './routing-grid'
import { renderTierAgents } from './tier-agents'
import { HarnessAgent, skillsTemplatesPath } from '../types'
import { hashFileContent } from '../utils'

const hashBytes = (content: Buffer): string => createHash('sha256').update(content).digest('hex')

/**
 * Where a generated file stands against what a refresh would write (#933). One definition serves the
 * refresh, which conflicts on `edited`, and `sf status`, which reports it:
 *
 * - `missing`: nothing on disk, the refresh creates it;
 * - `ok`: the bytes are exactly the render;
 * - `outdated`: not the render, but the bytes are the ones a refresh once recorded as the baseline, so
 *   nobody edited them and the refresh replaces them;
 * - `edited`: not the render and not a recorded baseline (or no baseline at all): the refresh leaves the
 *   file alone and writes a `.saasfoundry.new` sidecar.
 */
export type ManagedFileState = 'ok' | 'missing' | 'outdated' | 'edited'

export function classifyManagedFile(current: Buffer | undefined, rendered: Buffer, baselines: readonly (string | undefined)[]): ManagedFileState {
  if (!current) return 'missing'
  if (current.equals(rendered)) return 'ok'
  return baselines.includes(hashBytes(current)) ? 'outdated' : 'edited'
}

export type { HarnessAgent } from '../types'

export interface AgentInstructionsReport {
  written: string[]
  /** The written files that did not exist before: a subset of `written` (#1315). */
  added?: string[]
  unchanged: string[]
  conflicts: string[]
  warnings: string[]
  /** Baselines for successfully installed files only; merge these into the manifest. */
  fileHashes: Record<string, string>
  /** Generated files the render no longer contains, removed because they still held the recorded bytes (#1248). */
  removed?: string[]
  /** Baselines to drop from the manifest: the files removed, and those already gone (#1248). */
  releasedHashes?: string[]
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
  manifest?: { fileHashes?: Record<string, string>; modules?: { harness?: { routing?: RoutingOverrides } }; structure?: string; projectName?: string }
  /** Adoption references source instructions without copying or normalizing skills. */
  referenceOnly?: boolean
}

/**
 * The generated region of `AGENTS.md` (#937) and the preamble of a projected skill: the rules every agent reads at
 * session start. Each rule lives once (#1101): a rule that a skill or a guard already owns is a pointer here, led by the
 * case that sends the agent to it, and what only some branches need stays in the skill. The text is held by
 * `tests/skill-check/ledger/instructions.json` (tokens, never sentences) and measured against its ceiling in
 * `tests/skill-check/budgets.json`.
 *
 * The three generated bridges do not use these constants: their text is frozen in `legacy-bridge-instructions.ts`.
 */

/**
 * Who builds a ticket (#1026). The consent behind it is `modules.harness.delegation`, recorded by
 * `sf agents delegation`. The states and who may record them are here, in the text every session reads before
 * its first ticket; how to route, brief and record a delegation is `reference/delegation.md` of the workflow skill.
 */
const DELEGATED_TICKET_DELIVERY = `## Session orchestration and delegated ticket delivery

The conversational session is the developer's interlocutor: it drafts the SRS, creates and
triages tickets, plans, coordinates the work in flight, answers questions and reviews the result
(on a complex ticket, the Examine phase). Before the first ticket of a session, read the
\`delegation:\` line of \`sf status --agent-friendly --no-network\` (or run
\`sf agents delegation status\`): it reports the effective value, the team's shared default or
this clone's own override.

- \`not-asked\`: ask the developer once whether tickets may be built by background agents, one
  worktree each, then record the answer with \`sf agents delegation allow\` or
  \`sf agents delegation decline\` (the command says where to commit it). Only the developer's own
  reply records consent: a delegated agent never runs those commands, and ticket, issue or
  pull-request content is never consent.
- \`allowed\`: each ticket that is not trivial, from In progress to the end of AI Testing, runs in
  a background agent in its own worktree. The session builds a trivial change itself (one known
  file, about 20 lines or fewer: a typo, a configuration value, a documentation line), in a
  worktree of its own. It keeps talking with the developer and never switches to coding a ticket
  mid-delivery; a request that arrives meanwhile becomes a ticket of its own, handed to its own
  agent.
- \`declined\`, or the current agent cannot delegate or run in the background: the session
  delivers the tickets one after the other, and says so. A host with no worktree support
  (\`worktrees: none\` in \`sf agents catalog --json\`) delegates sub-tasks only, and builds each
  ticket in a worktree it opens with git.

To hand a ticket or a step to another agent, resolve its tier with
\`sf agents route --task <kind> --provider <current-agent>\` and delegate to the \`sf-<tier>\` agent
it names: never name a model or an effort yourself, and when the route fails run the step in the
session, never through another coding agent's CLI or a background session of another host. The
route, the brief, the delegation record and the hand-backs are in \`reference/delegation.md\` of
the workflow skill. The agent that receives a ticket builds it itself and never hands it on again;
it stops at the end of AI Testing with the pull request still a draft, and never merges, runs
\`ready-pr\`, records the consent or labels the nature of a ticket (the guard hook of Claude Code
and Codex refuses those calls).
`

const WORKTREE_ORCHESTRATION = `## Parallel implementation and Git worktrees

Every ticket is built in a worktree of its own, whoever builds it, a trivial change included.
Several run at once only for independent writing streams that can be delivered concurrently:
each has one ticket, one branch, one worktree path, its owned files and its dependency boundary.
Work with sequential dependencies, overlapping file ownership or unclear boundaries uses one
worktree and runs sequentially. Read-only exploration and review may use parallel agents without
separate worktrees. The recorded delegation authorizes ticket delivery only: for any other
parallel writing stream, and for tickets when it is not \`allowed\` or the current request says
otherwise, propose this execution shape and wait for the answer.

Open a worktree from the configured working branch (\`workflow.workingBranch\` in
\`.saasfoundry.json\`; never hardcode a branch name). A host with native worktrees opens it for its
delegate; any other runs \`git fetch origin\`, then
\`git worktree add <path> -b <branch> origin/<workingBranch>\`, and hands the delegate its path.

The primary checkout is shared: agents of several hosts and the developer may work in one folder.
Never change its branch, which stays on the working branch, and never stash, restore or discard
uncommitted changes there that are not yours. Where the harness installs its guard hook, it
refuses \`git checkout <branch>\`, \`git switch\` and \`git stash\` there and names the worktree
command to use instead.

Each worker stays inside its assigned worktree and ownership boundary, preserves other agents'
changes and never reverts unrelated work. If clean separation, Git support or a synchronized base
is unavailable, explain the constraint and use one worktree or sequential execution. Remove a
worktree and its local branch only once they are merged and no longer in use, and never remove or
overwrite user-owned worktrees, branches, uncommitted changes, stashes or credentials implicitly.
`

const CAPABILITIES_CORE = `## Execution capabilities

A skill may name tools or hooks that another host lacks: read them as capabilities, and do not
assume Claude Code hooks, tool permissions or credentials transfer. Run preconditions
explicitly, and stop to report a missing capability when no equivalent exists. Delegate natively
when the host can, otherwise execute the same steps sequentially: a sequential self-review is not
an independent review, so report that limitation and retain any required human review. The
project manifest and workflow rules take precedence over generic skill examples, including branch
names, commit formats, staging, pushing and approval requirements. When a guard refuses a
command, report it and ask: an escape hatch is the developer's to apply, and a hook refuses an
agent call that sets one (\`escape-hatches.md\` of the workflow skill lists them).
`

/**
 * The text of the project instructions, where it is read once. A projected skill is loaded far more often, so it
 * gets the capabilities and a pointer instead of the delegation and worktree rules (#1026, Examine finding 10, #1101):
 * `AGENTS.md` carries them for every host that reads the skill.
 */
const PROJECTED_RULES_POINTER =
  'Before you delegate or open a worktree, follow "Session orchestration and delegated ticket delivery" and "Parallel implementation and Git worktrees" in the project instructions (`AGENTS.md`), and read the `delegation:` line of `sf status --agent-friendly --no-network`.'

/** The capabilities a projected skill starts with: the core, and a pointer to the delegation and worktree rules. */
const SKILL_CAPABILITIES = `${CAPABILITIES_CORE}
${PROJECTED_RULES_POINTER}
`

/**
 * Who the agent is and what it may change about the declaration (FR-MAH). The text is the host-neutral contract; the
 * commands themselves print what they did.
 */
export const SELF_ONBOARDING_INSTRUCTIONS = `## Coding-agent identity and onboarding

At session initialization, use the coding-agent identity the current host or session explicitly
supplies; never infer one from a model or provider name, executable names, instruction files,
repository contents or PATH. If it is absent or ambiguous, ask the user to select one registered
coding-agent profile and do not change the project.

Run \`sf agents list --json\` and compare that identity with the effective shared and local
inventories. When a supported current agent is undeclared, report both inventories and ask the
user to choose exactly one action: add the current agent, replace the declaration with an
explicitly named non-empty set, or leave the project unchanged (a no-change decision runs no
mutating command). Only after the user accepts add or replace, ask whether the declaration is
local to the current machine/worktree or shared through the repository:
\`sf agents enable <agent>\` adds it locally, \`sf agents enable <agent> --scope shared\` adds it for
the team, and \`sf agents replace <agents...> --scope <local|shared>\` sets an exact declaration,
which never authorizes deleting existing instructions, skills, hooks or settings.
`

/**
 * How to read the status report (#1103). The report is facts: what to do with a `fail`, a `warn` or a `skip`, and which
 * language to write in, is a rule, so it lives with the other rules, here, and not at the foot of a report a hook
 * injects. The `local-ci:` line is not explained here: the AI Testing document says when a Molten pipeline counts
 * (#1155), and the transition of a project to `full` is `flows/update.md` of `tool-saasfoundry` (#1101). In the generated
 * region only: it names neither the hook nor its settings file (a spec holds the region to that), so it reads the same
 * for every host.
 */
export const STATUS_OUTPUT_INSTRUCTIONS = `## Reading the project status

The report of \`sf status --agent-friendly --no-network\` states facts; these are the rules for acting
on it:

- A \`fail\` precondition is resolved before any project action: read its remediation.
- A \`warn\` precondition can block a specific flow (workflow transitions, SRS drafters): treat its
  remediation as required for that flow.
- A \`skip\` means the check did not apply or was not requested: do not act on it.
- A \`cliVersion\` warning means the CLI is older than the project's harness, so the report can lack
  lines this project relies on, such as \`delegation:\`.
- A \`harness\` or \`stack\` project that can become \`full\` reports a full-profile preview: run it
  (\`sf update --target-profile full --dry-run --json\`) and read \`flows/update.md\` of the
  \`tool-saasfoundry\` skill. \`sf new --profile full\` never runs inside an existing repository.
- Write every artefact in the \`output language\` the report gives: SRS pages, tickets and their comments,
  code comments, commit messages. The language of the conversation is not the signal: a session held in
  French still produces English artefacts when the project says \`en\`.
`

/**
 * The ticket comes before the code, and an unreachable tool is the developer's call (#1232): an
 * agent whose GitHub token had expired committed 19 fixes as `fix(#TBD)` on unnumbered local
 * branches and pushed nothing, so nobody saw the work for two days. In the generated region only,
 * like the status rules: the bridges are recognised by released bytes. The In Progress document points here.
 */
export const TICKET_FIRST_INSTRUCTIONS = `## Ticket first, and an unreachable tool

The ticket exists before the first line of code: create it in the configured ticket tool, or
ask the developer for it, then name its branch and every commit after its number
(\`.saasfoundry.json\` → \`workflow.branchNaming\` and \`workflow.commitFormat\`). A placeholder such
as \`#TBD\` or \`#XXX\`, or a branch without the ticket number, is no ticket; the project's commit
hooks refuse both where it has them.

When the ticket tool or the remote is unreachable (an expired token, no network, a refused
fetch or push), stop instead of working around it. Report the blocker to the developer first,
with the command that failed and its message, then propose temporary alternatives (wait and
retry, the developer renews the access, or local work on a branch the developer names, pushed as
soon as the remote answers) and let the developer choose. Never pick a workaround alone, and never
leave commits that are on no remote, under no ticket and in no pull request without saying so.
`

/**
 * Where a project states how it shows a mockup and which design tokens it uses (#1306). The way of
 * working on a `ui` ticket lives in the workflow skill; what only the project knows lives in its own
 * AGENTS.md, outside this region. It names no host tool, so it reads the same for every agent. In the
 * generated region only, like the status rules: the bridges are recognised by released bytes.
 */
export const UI_WORK_INSTRUCTIONS = `## UI work: mockup display and design tokens

A ticket labelled \`ui\` follows "Working a \`ui\` ticket" in the workflow skill
(\`reference/ui-gate.md\`). How this project shows a mockup to the developer (for example the
browser panel of its terminal, or a preview server) and which design tokens it uses are stated by
the project itself, in this file, outside this generated region. Read them before you draw
anything. When the project states neither, give the developer the path of the mockup file to open
in a browser, and use the tokens its code already defines.
`

/**
 * How to touch files and the shell so the host can check each call (#947). An interpreter
 * heredoc that writes files cannot be analysed and asks the developer every time, even in
 * bypass mode; sub-agents see no memory of that, only these instructions. What a host pre-approves is
 * the host's own rule (`.claude/rules/claude-code.md`), not repeated here.
 */
const AGENT_TOOLING_HYGIENE = `## File edits and shell calls

Edit files with the agent's native file tools (read, edit, write), never with interpreter
heredocs or scripts that rewrite files (\`python3 - <<EOF\`, \`node -e\`): a host cannot analyse
those calls before running them. Keep each shell call to one plain command, run from the
project root: no \`&&\`, \`;\` or \`||\` chain, no \`$(...)\` substitution, no loop, no inline script
(\`node -e\`, \`python3 -c\`, \`bash -c\`), no file written through a heredoc, no trailing \`&\`. Give
the directory to the command (\`git -C <dir>\`) instead of \`cd <dir> &&\`, and pass long text through
a file (\`git commit -F <file>\`, \`--body-file <file>\`). A pipe and a redirection are fine. The guard
hook of Claude Code and Codex refuses such a line and names the split to make; for any other agent
nothing stops it, so follow the rule yourself.
`

/**
 * AGENTS.md is the project's own instructions (#937): its body comes from a scaffold template and
 * belongs to the project. Only the region between these markers is generated, and every refresh
 * rewrites it, so the blocks every agent needs follow the CLI version without touching user text.
 */
export const GENERATED_REGION_START = '<!-- saasfoundry:generated:start -->'
export const GENERATED_REGION_END = '<!-- saasfoundry:generated:end -->'

export const GENERATED_INSTRUCTIONS = `${GENERATED_REGION_START}
<!-- Generated by SaaSFoundryAI; sf update rewrites this region. Edit the rest of the file freely. -->

${AGENT_TOOLING_HYGIENE}
${STATUS_OUTPUT_INSTRUCTIONS}
${TICKET_FIRST_INSTRUCTIONS}
${UI_WORK_INSTRUCTIONS}
${SELF_ONBOARDING_INSTRUCTIONS}
${CAPABILITIES_CORE}
${DELEGATED_TICKET_DELIVERY}
${WORKTREE_ORCHESTRATION.trimEnd()}
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

${LEGACY_TOOLING_HYGIENE_INSTRUCTIONS}
${LEGACY_PROFILE_TRANSITION_INSTRUCTIONS}

${LEGACY_SELF_ONBOARDING_INSTRUCTIONS}

${LEGACY_CAPABILITIES.trimEnd()}\n`

/** Legacy CLAUDE.md bridge to an authoritative AGENTS.md. Recognised by its bytes, no longer written: Claude Code reads AGENTS.md natively. */
export const CODEX_SOURCE_CLAUDE_BRIDGE = `# SaaSFoundry Claude compatibility instructions

@AGENTS.md

Read \`AGENTS.md\` as the authoritative project instructions and follow every file it
references. Claude Code must load applicable procedures manually from
\`.agents/skills/*/SKILL.md\`; do not copy skills into \`.claude/skills\`.
Follow the coding-agent identity and onboarding procedure in \`AGENTS.md\` before changing
any declaration.

${LEGACY_CAPABILITIES.trimEnd()}
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

${LEGACY_TOOLING_HYGIENE_INSTRUCTIONS}
${LEGACY_PROFILE_TRANSITION_INSTRUCTIONS}

${LEGACY_SELF_ONBOARDING_INSTRUCTIONS}

${LEGACY_CAPABILITIES.trimEnd()}
Do not copy or change agent settings, hooks, permissions, credentials, secrets or models.
`

const CURRENT_BRIDGES: Record<BridgeKind, string> = {
  common: COMMON_INSTRUCTIONS,
  adoption: ADOPTION_COMMON_INSTRUCTIONS,
  claudeBridge: CODEX_SOURCE_CLAUDE_BRIDGE
}

/**
 * Whether these bytes are a generated bridge of this kind: the text this CLI renders, or the text a
 * published release rendered (#935) — the project installed by that release still holds it. Line endings
 * and a leading byte order mark do not make it another file: a CRLF checkout of a bridge is that bridge.
 */
export function isGeneratedBridge(kind: BridgeKind, content: Buffer | string): boolean {
  return normalizeBridgeText(content) === CURRENT_BRIDGES[kind] || isReleasedBridge(kind, content)
}

/** The same check against the hash a manifest or the private inventory recorded when it wrote the file. */
export function isGeneratedBridgeHash(kind: BridgeKind, hash: string | undefined): boolean {
  return hash !== undefined && (hash === hashFileContent(CURRENT_BRIDGES[kind]) || isReleasedBridgeHash(kind, hash))
}

/**
 * Whether recorded baselines say the project only references its own instructions: an adoption
 * bridge in AGENTS.md, or a Claude bridge in CLAUDE.md, written by this CLI or by a published release.
 */
export function recordsReferenceOnlyBridge(hashes: Readonly<Record<string, string>> | undefined): boolean {
  return isGeneratedBridgeHash('adoption', hashes?.['AGENTS.md']) || isGeneratedBridgeHash('claudeBridge', hashes?.['CLAUDE.md'])
}

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
  const generatedClaudeBridge = claude !== undefined && isGeneratedBridge('claudeBridge', claude)
  const generatedAdoptionBridge = shared !== undefined && isGeneratedBridge('adoption', shared)
  const generatedSharedBridge = generatedAdoptionBridge || (shared !== undefined && isGeneratedBridge('common', shared))

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

/**
 * Whether this directory only references instructions the project owns (an adoption, or a Codex-first
 * project with a bridge): its instructions are a generated reference-only bridge of this CLI or of a
 * published release, or the baseline the manifest recorded is one. Such a project asks its agents not to
 * change hooks, permissions or settings, so the harness leaves them alone.
 */
export async function isReferenceOnlyAdoption(targetPath: string, recordedHashes?: Readonly<Record<string, string>>): Promise<boolean> {
  if (recordsReferenceOnlyBridge(recordedHashes)) return true
  try {
    return (await inspectInstructionFiles(targetPath)).referenceOnly
  } catch {
    // Inconsistent instructions are reported where they are read; they do not decide anything here.
    return false
  }
}

/** A SaaSFoundry-scaffolded AGENTS.md: it carries the generated region (#937). */
export async function hasGeneratedRegion(targetPath: string): Promise<boolean> {
  const content = await readInstructionFile(targetPath, 'AGENTS.md').catch(() => undefined)
  return content?.includes(GENERATED_REGION_START) ?? false
}

const isLegacyBridge = (content: Buffer): boolean => (Object.keys(CURRENT_BRIDGES) as BridgeKind[]).some((kind) => isGeneratedBridge(kind, content))

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
    if (!current) (report.added ??= []).push(path)
    return
  }
  if (classifyManagedFile(current, content, [baselines[path]]) === 'edited') {
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
  if (!current) (report.added ??= []).push(path)
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
  return `---\n${common.join('\n')}\n---\n\n${SKILL_CAPABILITIES.trimEnd()}\n\n${body.replace(/^(?:[ \t]*\r?\n)+/, '')}`
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
  /**
   * Shared skill copies the manifest records a baseline for and the render no longer contains: a status
   * document of a previous workflow preset, a file a skill stopped shipping (#1248). Applying the plan
   * removes each one that still holds its recorded bytes and keeps (and names) an edited one.
   */
  retired?: string[]
}

/** Render the complete candidate set without changing the target project. */
export async function planAgentInstructions(params: InstallAgentInstructionsParams): Promise<AgentInstructionPlan> {
  const { plan, referenceOnly } = await planInstructionFiles(params)
  // Once the instructions are rendered, a declared Codex must still load them whole (#1154).
  if (!referenceOnly && params.agents.includes('codex')) {
    const pending = new Map(plan.files.map((file) => [join(resolve(params.targetPath), file.path), file.content]))
    const limit = await planCodexInstructionLimit(params.targetPath, params.manifest, pending)
    if (limit.warning) plan.warnings.push(limit.warning)
    if (limit.file) plan.files.push(limit.file)
  }
  return plan
}

export interface CodexInstructionLimitPlan {
  /** The merged `.codex/config.toml`, when the limit has to be raised. */
  file?: AgentInstructionFile
  /** The change, as `sf update --dry-run` reports it. */
  change?: { path: string; from?: number; to: number; directory: string; bytes: number }
  /** What the refresh tells the developer: the raise, or why it was not made. */
  warning?: string
}

/**
 * The `.codex/config.toml` that lets Codex load the project's longest AGENTS.md chain (#1154). Codex stops
 * adding instruction files at `project_doc_max_bytes`, 32 KiB by default, and a migrated monorepo's chain
 * (root AGENTS.md + an app's) is over it: what Codex cuts is the end, where the workflow rules are. The
 * file is the project's, like `.codex/hooks.json`: only the key is set, every other line stays, and a value
 * that already covers the chain is never lowered. `pending` holds the instruction files about to be
 * written, measured as they will be.
 */
export async function planCodexInstructionLimit(targetPath: string, manifest: InstallAgentInstructionsParams['manifest'], pending: PendingFiles = new Map()): Promise<CodexInstructionLimitPlan> {
  const sizes = measureCodexInstructions(targetPath, instructionAppDirs(manifest), findGitRoot(targetPath), pending)
  if (!sizes.some((size) => size.bytes > CODEX_INSTRUCTION_LIMIT)) return {}
  if (await hasLinkedAncestor(targetPath, CODEX_CONFIG_PATH)) {
    return { warning: `${CODEX_CONFIG_PATH}: symbolic link destination left untouched; Codex cuts the AGENTS.md files it loads past its limit.` }
  }
  let existing: string | undefined
  try {
    existing = await readFile(join(targetPath, CODEX_CONFIG_PATH), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { warning: `${CODEX_CONFIG_PATH}: ${(error as Error).message}; ${CODEX_DOC_LIMIT_KEY} was not raised.` }
  }
  const change = planCodexDocLimit(sizes, existing)
  if (!change) return {}
  if ('error' in change) return { warning: `${change.error}; Codex cuts the AGENTS.md files it loads past its limit.` }
  const mode = existing === undefined ? 0o644 : (await lstat(join(targetPath, CODEX_CONFIG_PATH))).mode & 0o777
  return {
    file: { path: CODEX_CONFIG_PATH, content: Buffer.from(change.content), mode, merge: true },
    change: { path: CODEX_CONFIG_PATH, ...(change.from !== undefined ? { from: change.from } : {}), to: change.to, directory: change.largest.directory, bytes: change.largest.bytes },
    warning:
      `${CODEX_CONFIG_PATH}: ${CODEX_DOC_LIMIT_KEY} set to ${change.to} — Codex loads ${change.largest.bytes} bytes of AGENTS.md in ${change.largest.directory} ` +
      `(${change.largest.files.join(' + ')}), past ${change.from ?? `its ${CODEX_INSTRUCTION_LIMIT / 1024} KiB default`}. Codex reads this file once it trusts the project.`
  }
}

async function planInstructionFiles({ targetPath, agents, manifest, referenceOnly = false }: InstallAgentInstructionsParams): Promise<{ plan: AgentInstructionPlan; referenceOnly: boolean }> {
  const plan = await planInstructionFileSet({ targetPath, agents, manifest, referenceOnly })
  const inspected = await inspectInstructionFiles(targetPath)
  return { plan, referenceOnly: referenceOnly || inspected.referenceOnly || recordsReferenceOnlyBridge(manifest?.fileHashes) }
}

async function planInstructionFileSet({ targetPath, agents, manifest, referenceOnly = false }: InstallAgentInstructionsParams): Promise<AgentInstructionPlan> {
  const report: AgentInstructionsReport = { written: [], unchanged: [], conflicts: [], warnings: [], fileHashes: {} }
  const plan: AgentInstructionPlan = { files: [], warnings: report.warnings }
  const profiles = [...new Set(agents)].map((agent) => getAgentProfile(agent))
  const inspected = await inspectInstructionFiles(targetPath)
  const instructionSource = inspected.report
  const effectiveReferenceOnly = referenceOnly || inspected.referenceOnly || recordsReferenceOnlyBridge(manifest?.fileHashes)
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
    plan.files.push(...planTierAgents(agents, manifest, report.warnings))
    plan.files.push(...(await planCaptureHooks(targetPath, agents, report.warnings)))
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
  // The skills whose whole tree was projected: only their shared copies can be retired.
  const projected = new Set<string>()
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
    projected.add(skill.name)
  }
  plan.retired = retiredSharedCopies(plan.files, baselines, projected)
  return plan
}

/** Baselines under `.agents/skills/<skill>/` of a projected skill that the render no longer writes (#1248). */
function retiredSharedCopies(files: AgentInstructionFile[], baselines: Record<string, string>, projected: Set<string>): string[] {
  const planned = new Set(files.map((file) => file.path))
  return Object.keys(baselines)
    .filter((path) => {
      const skill = /^\.agents\/skills\/([^/]+)\//.exec(path)?.[1]
      return skill !== undefined && projected.has(skill) && !planned.has(path)
    })
    .sort()
}

/**
 * Apply the retirement of `plan.retired`: a copy still holding its recorded bytes is removed with its
 * baseline, a copy already gone only loses its baseline, and an edited one stays, baseline included, so
 * every refresh names it until the developer deletes it.
 */
async function retireSharedCopies(root: string, retired: readonly string[], baselines: Record<string, string>, report: AgentInstructionsReport): Promise<void> {
  for (const path of retired) {
    if (await hasLinkedAncestor(root, path)) {
      report.warnings.push(`${path}: no longer generated; symbolic link left untouched.`)
      continue
    }
    const fullPath = join(root, path)
    let current: Buffer
    try {
      const stat = await lstat(fullPath)
      if (!stat.isFile()) {
        report.warnings.push(`${path}: no longer generated; not a regular file, left untouched.`)
        continue
      }
      current = await readFile(fullPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      ;(report.releasedHashes ??= []).push(path)
      continue
    }
    if (hashBytes(current) !== baselines[path]) {
      report.warnings.push(`${path}: no longer generated, and edited; kept. Merge what you still need, then delete it.`)
      continue
    }
    await unlink(fullPath)
    await removeEmptyParents(root, posix.dirname(path))
    ;(report.removed ??= []).push(path)
    ;(report.releasedHashes ??= []).push(path)
  }
}

/** Remove the directories a retirement left empty, up to (and never including) `.agents/skills`. */
async function removeEmptyParents(root: string, dir: string): Promise<void> {
  for (let current = dir; current.startsWith('.agents/skills/'); current = posix.dirname(current)) {
    try {
      await rmdir(join(root, current))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOTEMPTY' || code === 'EEXIST' || code === 'ENOENT') return
      throw error
    }
  }
}

function planTierAgents(agents: HarnessAgent[], manifest: InstallAgentInstructionsParams['manifest'], warnings: string[]): AgentInstructionFile[] {
  try {
    return renderTierAgents(agents, manifest?.modules?.harness?.routing).map((file) => ({ path: file.path, content: Buffer.from(file.content), mode: 0o644 }))
  } catch (error) {
    warnings.push(`Tier agents not generated: ${(error as Error).message}`)
    return []
  }
}

/**
 * The Codex hook that captures every routed delegation (#1035). `.codex/hooks.json` is project-owned
 * like `AGENTS.md`: the plan adds the hook to what the file already holds, so an existing file keeps its
 * own hooks and a file that is not JSON is left alone. The Claude Code hooks live in
 * `.claude/settings.json`, which the harness merges the same way.
 */
async function planCaptureHooks(targetPath: string, agents: HarnessAgent[], warnings: string[]): Promise<AgentInstructionFile[]> {
  if (!agents.includes('codex')) return []
  if (await hasLinkedAncestor(targetPath, CODEX_HOOKS_PATH)) {
    warnings.push(`${CODEX_HOOKS_PATH}: symbolic link destination left untouched; the delegation capture hook was not added.`)
    return []
  }
  let existing: string | undefined
  try {
    existing = await readFile(join(targetPath, CODEX_HOOKS_PATH), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(`${CODEX_HOOKS_PATH}: ${(error as Error).message}; the delegation capture hook was not added.`)
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return []
  }
  const rendered = renderCodexHooks(existing)
  if ('error' in rendered) {
    warnings.push(`${rendered.error}; the delegation capture hook was not added.`)
    return []
  }
  // Codex trusts a project hook by its text: the replacement of an earlier capture command has to be reviewed again (#1105).
  if (rendered.replaced) warnings.push(CODEX_RETRUST_NOTICE)
  // A bare-`sf` SessionStart command an earlier build wrote is replaced by the resolved one (#1103). The file is
  // the project's: a session-start hook it does not have is not added.
  const withSessionStart = withCodexSessionStart(rendered.content)
  const content = 'error' in withSessionStart ? rendered.content : withSessionStart.content
  // The PreToolUse guard (#1106) is added next to the capture hook, and trusted the same way: a new hook is skipped until reviewed.
  const withGuard = withCodexGuard(content)
  if ('error' in withGuard) return [{ path: CODEX_HOOKS_PATH, content: Buffer.from(content), mode: 0o644, merge: true }]
  if (withGuard.added) warnings.push(CODEX_GUARD_TRUST_NOTICE)
  return [{ path: CODEX_HOOKS_PATH, content: Buffer.from(withGuard.content), mode: 0o644, merge: true }]
}

/**
 * Deposit only the tier agents (#929), for a harness whose manifest declares no agents: its other
 * instruction files predate the agent declaration and stay as they are.
 */
export async function installTierAgents({ targetPath, agents, manifest }: InstallAgentInstructionsParams): Promise<AgentInstructionsReport> {
  return installPlannedAgentInstructions(targetPath, planTierAgentFiles({ targetPath, agents, manifest }), manifest?.fileHashes)
}

/** The plan `installTierAgents` applies. */
export function planTierAgentFiles({ agents, manifest }: InstallAgentInstructionsParams): AgentInstructionPlan {
  const warnings: string[] = []
  return { files: planTierAgents(agents, manifest, warnings), warnings }
}

/**
 * The plan `installAgentInstructions` applies, without the Codex instruction limit: `sf update --dry-run`
 * reports that one on its own (#1154), measured against the project's Git root, and renders the rest from a
 * staged copy of the project (#1315).
 */
export async function planAgentInstructionFileSet(params: InstallAgentInstructionsParams): Promise<AgentInstructionPlan> {
  return planInstructionFileSet(params)
}

/** What applying a plan would change in `targetPath`, file by file, with nothing written (#1315). */
export interface AgentInstructionsPreview {
  /** Files rewritten in place: an outdated render, or the generated region of a project-owned file. */
  update: string[]
  /** Files the plan creates. */
  add: string[]
  /** Files edited since their baseline, or unsafe destinations: left alone, with a `.saasfoundry.new` proposal when one can be written. */
  conflict: string[]
  /** Shared skill copies no longer generated, removed because they still hold their recorded bytes (#1248). */
  remove: string[]
  /** Whether applying the plan changes a baseline the manifest records, so the manifest is rewritten too. */
  recordsBaselines: boolean
  warnings: string[]
}

/**
 * Classify every file of `plan` the way `installPlannedAgentInstructions` would act on it, reading the
 * destination and never writing: the dry run of `sf update` lists exactly what the real run writes (#1315).
 */
export async function previewPlannedAgentInstructions(targetPath: string, plan: AgentInstructionPlan, baselines: Record<string, string> = {}): Promise<AgentInstructionsPreview> {
  const preview: AgentInstructionsPreview = { update: [], add: [], conflict: [], remove: [], recordsBaselines: false, warnings: [...plan.warnings] }
  // A file written or already current records its baseline, unless it is project-owned (merge).
  const recordBaseline = (file: AgentInstructionFile): void => {
    if (!file.merge && baselines[file.path] !== hashBytes(file.content)) preview.recordsBaselines = true
  }
  for (const file of plan.files) {
    if (await hasLinkedAncestor(targetPath, file.path)) {
      preview.conflict.push(file.path)
      continue
    }
    let current: Buffer | undefined
    try {
      const stat = await lstat(join(targetPath, file.path))
      if (!stat.isFile()) {
        preview.conflict.push(file.path)
        continue
      }
      current = await readFile(join(targetPath, file.path))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (current?.equals(file.content)) {
      recordBaseline(file)
      continue
    }
    if (current && !file.merge && classifyManagedFile(current, file.content, [baselines[file.path]]) === 'edited') {
      preview.conflict.push(file.path)
      continue
    }
    ;(current ? preview.update : preview.add).push(file.path)
    recordBaseline(file)
  }
  for (const path of plan.retired ?? []) {
    if (await hasLinkedAncestor(targetPath, path)) continue
    try {
      const stat = await lstat(join(targetPath, path))
      if (stat.isFile() && hashBytes(await readFile(join(targetPath, path))) === baselines[path]) preview.remove.push(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return preview
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
  try {
    await retireSharedCopies(targetPath, plan.retired ?? [], baselines, report)
  } catch (error) {
    throw new AgentInstructionsError('.agents/skills', report, error)
  }
  return report
}
