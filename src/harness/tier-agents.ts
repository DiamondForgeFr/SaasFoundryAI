import { agentsWith, getAgentProfile, type TierAgentFormat, type TierAgentsCapability } from './agent-registry'
import { ROUTING_GRID_VERSION, isRoutingProvider, listTierAssignments, type AutoKinds, type RoutingOverrides, type RoutingProvider, type TaskKind, type TierAssignment } from './routing-grid'
import type { HarnessAgent } from '../types'

/** One line per task kind, so a description says what the kind covers without the docs. */
const KIND_GLOSSES: Record<TaskKind, string> = {
  exploration: 'read-only codebase search and questions',
  'scoped-edit': 'a small change confined to one or two files',
  'bug-fix': 'diagnosing and fixing a defect',
  'multi-file-feature': 'a feature spread over several files',
  tests: 'writing or repairing tests',
  review: 'reviewing a diff or a pull request',
  planning: 'planning a ticket, a design or an approach',
  'terminal-ci': 'shell, build and CI work',
  prose: 'documentation and other prose'
}

export interface TierAgentFile {
  path: string
  content: string
}

/**
 * What every host's tier agent says, before any file format gets hold of it (FR-MAH-020): the same name, description,
 * model, effort and instructions whichever host reads it. A format renderer only lays these out.
 */
export interface TierAgentModel {
  name: string
  description: string
  model: string
  effort: string
  /** Where the file comes from and how to change it, said in the host's own comment syntax by the renderer. */
  origin: string
  instructions: string
}

/**
 * The renderers, one per file format a profile can declare (`capabilities.tierAgents.format`). They are the only
 * provider-specific code of tier-agent generation, and only the file syntax differs between them: Claude Code reads
 * Markdown with YAML frontmatter, Codex reads TOML. The record is keyed by the registry's format list, so a format a
 * profile declares without a renderer here does not compile.
 */
const FORMATS: Record<TierAgentFormat, { extension: string; render: (model: TierAgentModel) => string }> = {
  'claude-md': {
    extension: 'md',
    // JSON strings are valid YAML double-quoted scalars, whatever the description contains.
    render: (model) =>
      [
        '---',
        `name: ${model.name}`,
        `description: ${JSON.stringify(model.description)}`,
        `model: ${model.model}`,
        `effort: ${model.effort}`,
        '---',
        '',
        `<!-- ${model.origin} -->`,
        '',
        model.instructions,
        ''
      ].join('\n')
  },
  'codex-toml': {
    extension: 'toml',
    // JSON strings are valid TOML basic strings; the instructions never contain a triple quote.
    render: (model) =>
      [
        `# ${model.origin}`,
        `name = ${JSON.stringify(model.name)}`,
        `description = ${JSON.stringify(model.description)}`,
        `model = ${JSON.stringify(model.model)}`,
        `model_reasoning_effort = ${JSON.stringify(model.effort)}`,
        `developer_instructions = """`,
        model.instructions,
        '"""',
        ''
      ].join('\n')
  }
}

/** The tier-agent file of a tier for a host that declares tier agents: its directory, `sf-<tier>` and the format's extension. */
export const tierAgentPath = (target: TierAgentsCapability, tier: string): string => `${target.dir}/sf-${tier}.${FORMATS[target.format].extension}`

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The tier-agent files this module may own, whichever host: one alternative per profile that declares tier agents. Local ownership and template refreshes recognise them by it. */
export const TIER_AGENT_PATH = new RegExp(
  `^(?:${agentsWith('tierAgents')
    .map((id) => getAgentProfile(id).capabilities.tierAgents!)
    .map((target) => `${escapeRegExp(target.dir)}/sf-[a-z][a-z0-9-]*\\.${FORMATS[target.format].extension}`)
    .join('|')})$`
)

function describe(assignment: TierAssignment): string {
  const others = new Map<string, TaskKind[]>()
  for (const { kind, tier } of assignment.elsewhere) others.set(tier, [...(others.get(tier) ?? []), kind])
  const notFor = [...others].map(([tier, kinds]) => `${kinds.join(', ')} (use sf-${tier})`).join('; ')
  return (
    `SaaSFoundry ${assignment.tier} tier: ${assignment.candidate.model} at ${assignment.candidate.effort} effort. ` +
    `Use for ${assignment.kinds.map((kind) => `${kind} (${KIND_GLOSSES[kind]})`).join(', ')}.` +
    (notFor ? ` Do not use for ${notFor}.` : '')
  )
}

/**
 * What a tier agent does when the brief hands it a whole ticket rather than one subtask (#1026,
 * Examine finding 1). Exported so a spec can hold it against the workflow skill and its status
 * documents: the prompt must not forbid what the skill requires.
 */
export const WHOLE_TICKET_LINE =
  'A whole ticket is the exception: when the brief hands you a ticket to deliver (not a subtask of one), you own it from In progress to the end of AI Testing ' +
  '(the branch in your own worktree, the children, the test plan, the checks, the report and the draft pull request), through the workflow CLIs, ' +
  'and stop there with the ticket still in AI Testing. Build it yourself and never hand it on again. ' +
  "Never merge, never run `ready-pr` (the developer or the session takes the pull request out of draft), and never record the delegation consent (`sf agents delegation allow|decline`): only the developer's own reply does. " +
  "An escape hatch, and the nature label of a ticket, are the developer's to apply: when a guard refuses, stop and report it, and a hook refuses your call if you set one."

/**
 * What every tier agent ends its final message with (#1035). The host hooks know what a delegation cost;
 * only the delegate knows whether it did the job, so it says so in one line the harness parses. The kind,
 * ticket and trial come from the route record the id points to, not from the delegate. Kept short: it is
 * paid on every delegation. Exported so a spec can hold it against the parser and the workflow skill.
 */
export const DELEGATION_REPORT_LINE =
  'End your final message with one line, `SF-DELEGATION: <pass|fail> route=<id from the brief> checks=<codes>`, ' +
  'the codes being what you really ran among type-check, automated-tests, affected-tests, integration-tests, independent-review, security-tests, self-review (`none` if nothing): ' +
  '`pass` only if the check the brief named was run and met. Without the line the outcome is recorded as unknown.'

/**
 * Waiting for one's own background work (#1241). A delegate that ended its turn while a job it started still ran was
 * stopped early, wrote `fail` about unfinished work, and the routing read it. The capture now records such a stop as
 * interim; the line keeps the delegate from producing it, and names the `pending` keyword for a turn that ends anyway.
 */
export const BACKGROUND_WORK_LINE =
  'Never write your final message while a background job you started (a test suite, a commit hook, `molten ci run`) still runs: ' +
  'wait for it (on Claude Code, the Monitor tool with an until-loop), never with a foreground sleep, and stop the monitors you no longer need. ' +
  'If a turn ends while one still runs (the host wakes you when it reports), end that turn with `SF-DELEGATION: pending route=<id>`, never with a verdict.'

function instructions(assignment: TierAssignment): string {
  const lines = [
    `You are the ${assignment.tier} tier delegate of this project. The coordinating agent hands you one task of kind ${assignment.kinds.join(', ')}.`,
    '',
    '- Follow the project instructions in AGENTS.md and the rules they point to.',
    '- Stay inside the delegated scope. Do not change ticket, board or pull-request state unless the brief hands you a whole ticket (next point): otherwise the coordinating agent owns the workflow.',
    // A whole ticket is the one task that moves statuses and opens the draft PR (#1026): the line
    // below and the workflow skill's "Delegated ticket delivery" say the same thing.
    `- ${WHOLE_TICKET_LINE}`,
    '- Report back what you changed or found, with file:line references, and anything you could not finish.',
    `- ${BACKGROUND_WORK_LINE}`,
    `- ${DELEGATION_REPORT_LINE}`
  ]
  if (assignment.excludedFor.length) {
    lines.push('', `The project routes ${assignment.excludedFor.join(', ')} here although the grid excludes this candidate for it: say so if the result looks weak.`)
  }
  return lines.join('\n')
}

function origin(assignment: TierAssignment): string {
  const source = assignment.source === 'project' ? 'modules.harness.routing' : `routing grid v${ROUTING_GRID_VERSION}`
  return `Generated by SaaSFoundry from the ${source}. Change modules.harness.routing in .saasfoundry.json and run sf agents refresh instead of editing this file.`
}

/** The one model of a tier agent, built once per tier whichever host it is for. */
function tierAgentModel(assignment: TierAssignment): TierAgentModel {
  return {
    name: `sf-${assignment.tier}`,
    description: describe(assignment),
    model: assignment.candidate.model,
    effort: assignment.candidate.effort,
    origin: origin(assignment),
    instructions: instructions(assignment)
  }
}

/**
 * One file per tier that serves at least one kind, for every declared coding agent the grid routes and whose profile
 * declares tier agents. `auto` is the clone's automatic moves (#1035): the files that are committed are rendered
 * without them; it exists to tell which of those files a move would change.
 */
export function renderTierAgents(agents: readonly HarnessAgent[], overrides?: RoutingOverrides, auto?: Partial<Record<RoutingProvider, AutoKinds>>): TierAgentFile[] {
  const files: TierAgentFile[] = []
  for (const provider of [...new Set(agents)].filter(isRoutingProvider)) {
    const target = getAgentProfile(provider).capabilities.tierAgents
    // A routed host the harness writes no subagent file for (its profile says why) has a route and no tier agent.
    if (!target) continue
    for (const assignment of listTierAssignments(provider, overrides, auto?.[provider])) {
      files.push({ path: tierAgentPath(target, assignment.tier), content: FORMATS[target.format].render(tierAgentModel(assignment)) })
    }
  }
  return files
}
