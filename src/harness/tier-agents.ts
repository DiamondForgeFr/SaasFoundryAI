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
  /** What the tier is, in one sentence. A host that writes the model in its file says which model and effort here; one that binds it per call has none to say. */
  summary: string
  /** When to use the tier and when not to: the kinds it serves and the tier to use for the others. */
  usage: string
  model: string
  effort: string
  /**
   * The alias a call passes to run on this candidate, for a host that binds the model per call (`modelBinding: call-alias`):
   * its file carries no model, so the route names the alias. Undefined for a host whose file carries the model.
   */
  alias?: string
  /** Where the file comes from and how to change it, said in the host's own comment syntax by the renderer. */
  origin: string
  instructions: string
}

/**
 * The alias a call passes to run on a candidate, `sf-<model>-<effort>`: named after the candidate and not after the tier,
 * so it follows an override of the tier's candidate. A dot in the model name becomes a dash (`k3.1-pro` at `high` is
 * `sf-k3-1-pro-high`), so the alias is a bare TOML key and does not depend on how the host validates quoted ones.
 */
export function modelAlias(candidate: { model: string; effort: string }): string {
  const slug = (text: string): string =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  return `sf-${slug(candidate.model)}-${slug(candidate.effort)}`
}

/**
 * The tools a Kimi Code tier agent may use: the same for every tier, as an explicit list (a file with no `tools` keeps
 * every tool). It leaves out what a delegate must not do: hand work on (`Agent`, `AgentSwarm`), ask the developer
 * (`AskUserQuestion`, `NotifyUser`, `ExitPlanMode`) or schedule work (`Cron*`). `mcp__*` lets the MCP tools of the
 * session reach a delegate the way they reach one of Claude Code's.
 */
const KIMI_TOOLS = ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'ReadMediaFile', 'Bash', 'WebSearch', 'FetchURL', 'TodoList', 'Skill', 'TaskList', 'TaskOutput', 'TaskStop', 'WaitFor', 'mcp__*'] as const

/**
 * Kimi Code renders an agent file's body as a template, so `${base_prompt}` embeds the default system prompt (the
 * environment, the workspace instructions and the skills stay in effect) and any other `${...}` would be substituted, or
 * left verbatim, by the host. The body is `${base_prompt}` and then our own text, which must not hold one.
 */
const KIMI_BASE_PROMPT = '${base_prompt}'

/** Kimi Code gives a custom agent no hand-off framing of its own, so the file says what the final message is. */
const KIMI_HANDOFF_LINE =
  'Your last message is the whole result the coordinating agent receives: Kimi Code adds no hand-off framing to a custom agent, so make that message complete and self-contained.'

/**
 * The renderers, one per file format a profile can declare (`capabilities.tierAgents.format`). They are the only
 * provider-specific code of tier-agent generation, and only the file syntax differs between them: Claude Code reads
 * Markdown with YAML frontmatter, Codex reads TOML, Kimi Code reads Markdown with YAML frontmatter and no model field.
 * The record is keyed by the registry's format list, so a format a profile declares without a renderer here does not compile.
 */
const FORMATS: Record<TierAgentFormat, { extension: string; render: (model: TierAgentModel) => string }> = {
  'claude-md': {
    extension: 'md',
    // JSON strings are valid YAML double-quoted scalars, whatever the description contains.
    render: (model) =>
      [
        '---',
        `name: ${model.name}`,
        `description: ${JSON.stringify(`${model.summary} ${model.usage}`)}`,
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
        `description = ${JSON.stringify(`${model.summary} ${model.usage}`)}`,
        `model = ${JSON.stringify(model.model)}`,
        `model_reasoning_effort = ${JSON.stringify(model.effort)}`,
        `developer_instructions = """`,
        model.instructions,
        '"""',
        ''
      ].join('\n')
  },
  'kimi-md': {
    extension: 'md',
    // The file names no model and no effort: the call passes the alias. The origin is a YAML comment, so it is not part of the prompt.
    render: (model) => {
      if (model.instructions.includes('${')) throw new Error(`The instructions of ${model.name} contain a \${...} placeholder, which Kimi Code would substitute in the agent prompt.`)
      return [
        '---',
        `# ${model.origin}`,
        `name: ${model.name}`,
        `description: ${JSON.stringify(model.summary)}`,
        `whenToUse: ${JSON.stringify(model.usage)}`,
        'tools:',
        ...KIMI_TOOLS.map((tool) => `  - ${JSON.stringify(tool)}`),
        '---',
        KIMI_BASE_PROMPT,
        '',
        KIMI_HANDOFF_LINE,
        '',
        model.instructions,
        ''
      ].join('\n')
    }
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

/** What a tier is, in one sentence: the model and effort when the file carries them, otherwise how the model is chosen. */
function summary(assignment: TierAssignment, target: TierAgentsCapability): string {
  return target.modelBinding === 'file'
    ? `SaaSFoundry ${assignment.tier} tier: ${assignment.candidate.model} at ${assignment.candidate.effort} effort.`
    : `SaaSFoundry ${assignment.tier} tier delegate. Pass the model alias that sf agents route names for the task.`
}

/** The kinds a tier serves and the tier to use for the others. */
function usage(assignment: TierAssignment): string {
  const others = new Map<string, TaskKind[]>()
  for (const { kind, tier } of assignment.elsewhere) others.set(tier, [...(others.get(tier) ?? []), kind])
  const notFor = [...others].map(([tier, kinds]) => `${kinds.join(', ')} (use sf-${tier})`).join('; ')
  return `Use for ${assignment.kinds.map((kind) => `${kind} (${KIND_GLOSSES[kind]})`).join(', ')}.` + (notFor ? ` Do not use for ${notFor}.` : '')
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
 * What a tier agent does on a host that opens no worktree for its delegate (`worktrees: none`, FR-MAH-022): it works on
 * a sub-task in the current worktree and never on a whole ticket, which the session that holds the worktree delivers
 * itself. It replaces `WHOLE_TICKET_LINE` for such a host, so the prompt does not hand a delegate a ticket it has no
 * worktree for. Exported so a spec can hold it against the workflow skill.
 */
export const SUBTASK_ONLY_LINE =
  'Sub-tasks only: this host opens no worktree for a delegate, so you work on the sub-task the brief hands you, in the current worktree, and never on a whole ticket. ' +
  'If the brief hands you a whole ticket, stop and say that this host delivers it in the session. ' +
  'Create no branch, worktree or pull request, never merge, and never run `ready-pr`. ' +
  "Never record the delegation consent (`sf agents delegation allow|decline`): only the developer's own reply does. " +
  "An escape hatch, and the nature label of a ticket, are the developer's to apply: when a guard refuses, stop and report it."

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

/** `subtaskOnly`: the host opens no worktree for its delegate (its profile says `worktrees: none`), so the agent is handed sub-tasks and never a whole ticket. */
function instructions(assignment: TierAssignment, subtaskOnly: boolean): string {
  const lines = [
    `You are the ${assignment.tier} tier delegate of this project. The coordinating agent hands you one task of kind ${assignment.kinds.join(', ')}.`,
    '',
    '- Follow the project instructions in AGENTS.md and the rules they point to.',
    subtaskOnly
      ? '- Stay inside the delegated scope. Do not change ticket, board or pull-request state: the coordinating agent owns the workflow.'
      : '- Stay inside the delegated scope. Do not change ticket, board or pull-request state unless the brief hands you a whole ticket (next point): otherwise the coordinating agent owns the workflow.',
    // A whole ticket is the one task that moves statuses and opens the draft PR (#1026): the line
    // below and the workflow skill's "Delegated ticket delivery" say the same thing. A host with no
    // worktree for its delegate hands it sub-tasks only.
    `- ${subtaskOnly ? SUBTASK_ONLY_LINE : WHOLE_TICKET_LINE}`,
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
function tierAgentModel(assignment: TierAssignment, target: TierAgentsCapability, subtaskOnly: boolean): TierAgentModel {
  return {
    name: `sf-${assignment.tier}`,
    summary: summary(assignment, target),
    usage: usage(assignment),
    model: assignment.candidate.model,
    effort: assignment.candidate.effort,
    ...(target.modelBinding === 'call-alias' ? { alias: modelAlias(assignment.candidate) } : {}),
    origin: origin(assignment),
    instructions: instructions(assignment, subtaskOnly)
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
    const capabilities = getAgentProfile(provider).capabilities
    const target = capabilities.tierAgents
    // A routed host the harness writes no subagent file for (its profile says why) has a route and no tier agent.
    if (!target) continue
    // Whether a delegate can be handed a whole ticket is the host's own capability, never a provider name.
    const subtaskOnly = capabilities.worktrees === 'none'
    for (const assignment of listTierAssignments(provider, overrides, auto?.[provider])) {
      files.push({ path: tierAgentPath(target, assignment.tier), content: FORMATS[target.format].render(tierAgentModel(assignment, target, subtaskOnly)) })
    }
  }
  return files
}
