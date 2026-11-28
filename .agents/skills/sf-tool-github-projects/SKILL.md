---
name: sf-tool-github-projects
description: "GitHub Projects V2 adapter of the workflow: create tickets, subtasks and epics, put tickets on the board, move statuses, set complexity, issue types and milestones, open and track pull requests, through github-projects-cli.sh. Triggers on \"github project\", \"create ticket\", \"create subtask\", \"update ticket status\", \"github issue\", \"project board\", \"set complexity\"."
---

## Execution capabilities

A skill may name tools or hooks that another host lacks: read them as capabilities, and do not
assume Claude Code hooks, tool permissions or credentials transfer. Run preconditions
explicitly, and stop to report a missing capability when no equivalent exists. Delegate natively
when the host can, otherwise execute the same steps sequentially: a sequential self-review is not
an independent review, so report that limitation and retain any required human review. The
project manifest and workflow rules take precedence over generic skill examples, including branch
names, commit formats, staging, pushing and approval requirements. When a guard refuses a
command, report it and ask: an escape hatch is the developer's to apply, and a hook refuses an
agent call that sets one (`escape-hatches.md` of the workflow skill lists them).

Before you delegate or open a worktree, follow "Session orchestration and delegated ticket delivery" and "Parallel implementation and Git worktrees" in the project instructions (`AGENTS.md`), and read the `delegation:` line of `sf status --agent-friendly --no-network`.

# GitHub Projects Tool

Every board and ticket call goes through `.claude/skills/sf-tool-github-projects/github-projects-cli.sh <cmd> [args]`, never through raw `gh api graphql` or `gh issue create`: the CLI runs the guards
those skip. A command run without its arguments prints its usage, and `workflow-cli.sh` routes its tool calls here (`retag` runs `set-complexity`). It needs `gh` signed in with the `project` and
`repo` scopes, and reads `workflow.projectUrl` and `workflow.workingBranch` from `.saasfoundry.json` ([manifest schema](../../../.claude/docs/manifest-schema.md)).

## Data model

Three axes on every ticket, each kept in one place:

- **Status**: the Projects V2 `Status` field, the workflow phase. Never encode status in a label.
- **Complexity**: the label `complexity: bug|low|medium|complex`, the rigor of each phase. Never on the board.
- **Type**: the organisation-level issue type `sf-epic`/`sf-story`/`sf-task`/`sf-issue`, one set for every repository of the organisation; the `sf-` prefix keeps them apart from the organisation's own
  types.

Ticket titles, bodies and comments follow `language.tickets` in `.saasfoundry.json` (English by default), never the language of the conversation.

## Commands

- `create-ticket <story|task|issue> <title> [--body-file <f>] [--complexity <c>] [--nature <n>] [--milestone <m>] [--ui]`: a top-level ticket on the board in Backlog, with its issue type and labels.
- `create-epic <title> [body]`: a top-level Epic.
- `create-subtask <parent> <title> [body] [--milestone <m>] [--ui]`: a native sub-issue of `<parent>`, typed, in the parent's milestone unless `--milestone` names another. A checkbox, a title prefix
  or a `gh issue create` makes no child: the parent's Done guard reads only the native links.
- `unlink-subtask <parent> <child>`: detach a child; the issue stays open, and a child of another parent is refused.
- `list-incomplete-children <parent>`: the native children whose board Status is not exactly `Done`.
- `status <ticket>` reads the board Status. `update-status <ticket> <status-name>` writes it (case-insensitive; an unknown name prints the board's options) and, on `Done`, also closes the issue and
  fails if it stays open.
- `add-to-project <ticket> [--status <s>] [--json]`: put an issue on the board, in Backlog by default; one already there keeps its status. `--json` prints the status the board holds afterwards.
- `set-complexity <ticket> <bug|low|medium|complex>` replaces the `complexity:` label. `get-complexity`, `get-labels`, `get-parent`, `get-issue-type` and `get-ticket` read the complexity, every label,
  the native parent, the issue type, and the title and body.
- `list [status]`: the board items, optionally of one status.

## Tickets on an SRS project

With `tools.srs.backend` set in `.saasfoundry.json`, `create-ticket`, `create-subtask` and `create-epic` exit with code `2` unless the ticket comes from the SRS spawner (`sf-srs`) or carries
`--bypass-srs <reason>`; a feature is drafted in the SRS first. The hatch is the developer's to authorize: read [escape-hatches.md](../sf-workflow/escape-hatches.md) for its legitimate reasons and the
record to leave. The CLI posts the reason as a comment on the new ticket, so use a grep-able token (`meta-srs-tooling`, `bootstrap-epic-<N>`).

## Pull requests

- `create-pr <ticket> [--draft] [--head <branch>]`: push the branch and open the ticket's PR against `workingBranch`, or reuse it with its draft state.
- `ready-pr <ticket> [--head <branch> | --pr <number>]` takes the ticket's PR out of draft, through the local CI gate; `draft-pr <ticket> [--head <branch> | --pr <number>]` returns it to draft.
- `local-ci-gate <ticket> [--head <branch> | --pr <number>]`: check that the PR's head carries every required local CI status; it changes nothing.
- **The ticket's branch** is the current branch when it follows `workflow.branchNaming`. On a branch the host named (`worktree-agent-<id>`), push first with
  `git push origin HEAD:feature/<N>-<description>`: `create-pr` then finds the ticket's branch at `HEAD` on `origin`, or takes `--head <branch>`. A branch that is missing, behind `HEAD`, another
  ticket's or one of several is refused, and the message names `--head`.
- **The primary checkout**, on the working branch while the ticket branch lives in an agent's worktree: `ready-pr` and `draft-pr` find the ticket's one open PR on GitHub, and `--pr <number>` picks one
  of several. Run them there, never inside the agent's worktree.
- **`Resolves #<ticket>`** is the body line `create-pr` writes: keep it as written. Before the first `ready-pr`, read "Draft PR lifecycle" in [the workflow skill](../sf-workflow/SKILL.md): it says who
  takes a PR out of draft on each route, and how a PR for several tickets, a stacked one, a `Part of #<ticket>` one and a release one are linked.
- **The local CI gate**: `create-pr` without `--draft`, `ready-pr` and `local-ci-gate` refuse a head on which a required status is missing or not green, and name the status, where the list comes from
  ("Local CI guard" in the workflow skill) and the command that publishes it. `--skip-local-ci "<reason>"` bypasses the gate and records the reason on the PR: it is the developer's, never an agent's.

## The `ui` marker

`set-ui <ticket>` and `clear-ui <ticket>` (or `--ui` at creation) put and remove the label `ui`.
`record-ui-validation <ticket> (--mockup <link-or-path> --approved-by <name> | --supplied "<what the developer supplied>") [--date <d>]` records the developer's validation as a ticket comment that
starts with `<!-- sf-ui-validation:v1 -->`, and `get-ui-validation <ticket>` prints the latest complete record as one line of JSON (nothing when there is none, exit 1 when the comments cannot be
read). The guard of `update-status` reads that record; to know who sets the label and when to record a validation, read "UI mockup gate" in [the workflow skill](../sf-workflow/SKILL.md).

## Issue types

Types live at the organisation level, and `workflow.issueTypes` in `.saasfoundry.json` lists them: `ensure-issue-types [--dry-run]` creates the missing ones, `assign-type <issue> <type>` attaches one,
`delete-issue-type <type>` removes a legacy one. `create-subtask` assigns the type itself, and warns with the command to rerun when it cannot. These three write organisation configuration and need the
`admin:org` scope: `gh auth refresh --hostname github.com --scopes admin:org`.

## Labels

A label is missing from the repository (`sf new` creates them, and `set-ui` creates `ui`): read [github-labels.md](../../../.claude/docs/github-labels.md) for the names, colours and commands.
