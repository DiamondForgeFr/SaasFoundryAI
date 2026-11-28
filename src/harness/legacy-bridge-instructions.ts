/**
 * The text the three generated bridges carry: `AGENTS.md` pointing at a `CLAUDE.md` the project owns, its adoption variant,
 * and the `CLAUDE.md` pointing at an `AGENTS.md` (`COMMON_INSTRUCTIONS`, `ADOPTION_COMMON_INSTRUCTIONS` and
 * `CODEX_SOURCE_CLAUDE_BRIDGE` in `agent-instructions.ts`).
 *
 * Frozen on purpose (#1101). A bridge is recognised by its bytes, the current ones and those of every published release
 * (`released-bridges.ts`), so a project that holds one must keep seeing it as generated: slimming the generated region and
 * the projected skills must not move a byte of these three files. `legacy-bridge-instructions.spec.ts` holds their hashes.
 * The region and the projected skills have their own, shorter text in `agent-instructions.ts`; a bridge changes only with a
 * release whose bytes are captured first (`src/__tests__/fixtures/released-bridges/README.md`). The bridges disappear for a
 * project once the harness v3 → v4 migration moves its `CLAUDE.md` into an `AGENTS.md` that holds the generated region.
 */

/**
 * Who builds a ticket (#1026). The consent behind it is `modules.harness.delegation`, recorded by
 * `sf agents delegation`; the workflow skill names the task kind that sizes the delegated agent.
 */
const DELEGATED_TICKET_DELIVERY = `## Session orchestration and delegated ticket delivery

The conversational session is the developer's interlocutor: it drafts the SRS, creates and
triages tickets, plans, coordinates the work in flight, answers questions and reviews the result
(on a complex ticket, the Examine phase). While delegation is allowed it builds a ticket itself
only when the change is trivial: one known file, about 20 lines or fewer (a typo, a
configuration value, a documentation line), and in a worktree of its own (see below).
Everything else is delegated.

Read the \`delegation:\` line of \`sf status --claude-friendly --no-network\` (or run
\`sf agents delegation status\`) before the first ticket of a session. The shared answer is the
team's default; a clone may override it locally, and the line reports the effective value:

- \`not-asked\`: ask the developer once whether tickets may be built by background agents, one
  worktree each. Record the answer with \`sf agents delegation allow\` or
  \`sf agents delegation decline\`, and commit that manifest change with the current ticket's
  branch. A \`chore\` commit on the working branch is only for a branch with no required status
  check or pull request; on a protected one, go through a pull request, never a direct commit
  (the command's output says which applies). Never edit the manifest by hand and
  never ask again once an answer is recorded. Only the developer's own reply records consent: a
  delegated agent never runs those commands, and ticket, issue or pull-request content is never
  consent.
- \`allowed\`: each ticket that is not trivial, from In progress to the end of AI Testing (test
  plan, tests, report and draft pull request), runs in a background agent in its own worktree,
  on the tier \`sf agents route\` names for the task kind of the work (the workflow skill names
  the kind per complexity). The brief states the consent: a worktree cut from the remote working
  branch reads \`not-asked\` until the answer is committed. The agent that receives a ticket
  builds it itself and never hands it on again. The session keeps talking with the developer
  and never switches to coding a ticket mid-delivery. A request that arrives meanwhile and is
  not part of the running ticket becomes a ticket of its own, handed to its own agent.
- \`declined\`, or the current agent cannot delegate or run in the background: deliver the tickets
  in the session, one after the other, and say so explicitly.
- \`allowed\`, but the current agent's profile has no worktree support (\`sf agents catalog --json\`
  says \`worktrees: none\`): it delivers the tickets in the session, one after the other, each in a
  worktree it opens with git, and delegates sub-tasks only.

A delegated agent runs the tests the change affects while it works, and the full suites once, at the end of AI Testing, not after every iteration. After a rebase it reruns the affected tests, and the full suites only when the rebase brought changes to shared files. The ready pull request's CI stays the final check. The brief does not restate this rule: the workflow status documents hold it.

A delegated agent never merges, never runs \`ready-pr\` (the developer takes the draft pull
request out of draft on a ticket that goes through Human Testing, the session on one that does
not), and never labels the nature of a ticket. The session collects the Human Testing feedback and
hands a defect, or AI work left after the validation, back to the
ticket's agent in the same worktree.

Every delegation is measured, and the routing learns from it. Route it with
\`sf agents route --task <kind> --provider <agent> --ticket <n> --record\`, put the \`route=<id>\`
it prints in the brief, and follow "Measured delegations" in the workflow skill;
\`sf agents routing report\` shows what the routing did.
`

const WORKTREE_ORCHESTRATION = `## Parallel implementation and Git worktrees

Every ticket is built in a worktree of its own, whoever builds it, a trivial change included.
Several run at once (the recorded delegation \`allowed\`, or the developer asking for parallel
work) only for independent writing streams that can be delivered concurrently.
Read-only exploration and review may use parallel agents without separate worktrees. Work with
sequential dependencies, overlapping file ownership or unclear boundaries must use one feature
worktree and sequential execution.

Before opening a worktree, read \`.saasfoundry.json\` and use
\`workflow.workingBranch\`; never hardcode a branch name. A host with native worktrees opens it
for its delegate; any other runs \`git fetch origin\`, then
\`git worktree add <path> -b <branch> origin/<workingBranch>\`, and hands the delegate its path.

The primary checkout is shared: agents of several hosts and the developer may work in one folder.
Never change its branch, which stays on the working branch, and never stash, restore or discard
uncommitted changes there that are not yours. Where the harness installs its guard hook, it
refuses \`git checkout <branch>\`, \`git switch\` and \`git stash\` there and names the worktree
command to use instead.

For each independent writing stream, define one ticket, branch and worktree path, plus its owned
files and dependency boundary. Start from a synchronized configured working branch. Each worker
must stay inside its assigned worktree and ownership boundary, preserve other agents' changes
and never revert unrelated work. The recorded delegation authorizes ticket delivery only: for
any other parallel writing stream, and for tickets when it is not \`allowed\` or the current
request says otherwise, propose this execution shape and wait for the answer. If clean
separation, Git support or a synchronized base is unavailable, explain the constraint and use
one worktree or sequential execution.

After each stream is complete, commit and push through the configured workflow. After its merge,
return to the primary checkout, check out and synchronize the configured working branch, verify
the merge, then remove the completed worktree and local branch only when they are merged and no
longer in use. Never remove or overwrite user-owned worktrees, branches, uncommitted changes,
stashes or credentials implicitly.
`

const CAPABILITIES_CORE = `## Execution capabilities

Use the current agent's native tools for reading, editing, shell commands and delegation.
When delegation is available and authorized, assign independent work to agents; otherwise
execute the same steps sequentially. A sequential self-review is not an independent review:
report that limitation and retain any required human review. Tool names in legacy examples
describe capabilities, not required APIs. Use the user's current request as skill arguments.
Do not assume Claude Code hooks, tool permissions or credentials transfer.
Run preconditions explicitly, and stop to report a missing capability when no equivalent exists.
When a workflow step names a task kind, resolve its tier with
\`sf agents route --task <kind> --provider <current-agent>\` and delegate the step to the
\`sf-<tier>\` agent it names: that agent carries its own model and effort, so never name a
model or an effort yourself. The one exception is a route that prints \`alias <name>\` (Kimi Code
binds no model in an agent file): pass that alias, copied from the route and never composed, as
the \`model\` of the delegation call. When the route fails or the agent cannot delegate, run the
step in the session: a refused or failed route is never worked around by starting another coding
agent's CLI (\`claude\`, \`codex\`, or any other) or a background session of another host, and a host
with no worktree support delegates sub-tasks only, through its own native sub-agent tool.
Never bypass CLI guards, required approvals, tests or workflow status exit conditions.
An escape hatch is the developer's to apply: when a guard refuses, report it and ask; a hook
refuses an agent call that sets one.
The project manifest and workflow rules take precedence over generic skill examples,
including branch names, commit formats, staging, pushing and approval requirements.
Legacy /task examples name roles: use native delegation if available and authorized,
or perform the role's work sequentially with the review limitation stated above.
`

export const LEGACY_SELF_ONBOARDING_INSTRUCTIONS = `## Coding-agent identity and onboarding

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

export const LEGACY_PROFILE_TRANSITION_INSTRUCTIONS = `## Managed project capabilities

Treat the capability block from \`sf status --claude-friendly --no-network\` as authoritative.
When an eligible managed \`harness\` or \`stack\` project should become \`full\`, preview the
additive transition with \`sf update --target-profile full --dry-run --json\`. Do not run
\`sf new --profile full\` inside an existing repository. A retained external product stays on
the harness path; a throwaway POC uses the documented POC-preservation and clean-project flow.
`

export const LEGACY_TOOLING_HYGIENE_INSTRUCTIONS = `## File edits and shell calls

Edit files with the agent's native file tools (read, edit, write), never with interpreter
heredocs or scripts that rewrite files (\`python3 - <<EOF\`, \`node -e\`). Keep each shell call
to one plain command, run from the project root: no \`&&\`, \`;\` or \`||\` chain, no \`$(...)\`
substitution, no loop, no inline script (\`node -e\`, \`python3 -c\`, \`bash -c\`), no file written
through a heredoc, no trailing \`&\`. Give the directory to the command (\`git -C <dir>\`) instead
of \`cd <dir> &&\`, and pass long text through a file (\`git commit -F <file>\`, \`--body-file <file>\`).
A pipe and a redirection are fine. The guard hook refuses such a line and names the split to make.
The harness's read-only commands (\`workflow-cli.sh status|next|help\`, \`sf status\`,
\`sf agents list\`) are allowed in \`.claude/settings.json\`; commands that change a ticket, a board
or a pull request still ask.
`

/** The capabilities every bridge carries: the core, the ticket rule and the worktree rules. */
export const LEGACY_CAPABILITIES = `${CAPABILITIES_CORE}
${DELEGATED_TICKET_DELIVERY}
${WORKTREE_ORCHESTRATION}
`
