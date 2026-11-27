---
name: sf-workflow
description: >-
  Development workflow of this project ({{WORKFLOW_NAME}}): ticket statuses and their guards, complexity labels (bug, low, medium, complex), branches and pull requests, driven through workflow-cli.sh.
  Read it before any ticket status change. Triggers on "workflow status", "check workflow", "what should I do", "next step", "workflow help", "current status", "complexity", "detect complexity".
---

# Workflow {{WORKFLOW_NAME}}

The lifecycle of a ticket on {{TOOL}}, driven by `.claude/skills/sf-workflow/workflow-cli.sh`. Statuses, branch names and the working branch come from `.saasfoundry.json` → `workflow` ([manifest schema](../../docs/manifest-schema.md)), never from memory.

## Move a ticket

1. **Read the status.** `workflow-cli.sh status <ticket>` prints the status of the ticket and its document: read all of it and follow it (`workflow-cli.sh next <ticket>` names the next status). Done when you can state its exit conditions.
2. **Settle the complexity** before the ticket leaves Backlog: `workflow-cli.sh detect-complexity <ticket>` suggests a level (`bug`, `low`, `medium`, `complex`), the developer decides, and `workflow-cli.sh retag <ticket> <level>` records it. Done when `get-complexity <ticket>` prints the level. More complexity means more rigor (analysis depth, plan detail, adversarial review, test coverage); each level is a YAML profile in `complexity/`, and [complexity/README.md](complexity/README.md) documents the schema.
3. **Move it** with `workflow-cli.sh update-status <ticket> "<status>"` once the document's exit conditions hold, one status at a time. Relay the `▶ AI` / `⏳ Dev` banner it prints. Done when the CLI prints the new status.
4. **A guard refuses the move?** Satisfy it with the command it names ("Guards"). When you cannot, stop, report the refusal and ask the developer.

The statuses, each with its document to read before acting:

{{STATUSES_LIST}}

## Guards

`update-status` enforces these. A refusal names its cause and the command to run.

- **Complexity guard**: refuses any target but Backlog on a ticket with no `complexity: *` label. Epics (type `sf-epic`) and `srs:*` tickets are exempt, and it fails open when labels cannot be read. `retag` satisfies it (step 2); `detect-complexity` only suggests.
- **Pushed-commits guard**: refuses `→ AI Testing` while tracked changes, or commits `origin` lacks, remain in the checkout that holds the ticket's work (untracked files only warn). Commit, then `git push`.
- **Nature guard**: refuses `→ In Review` from AI Testing when the workflow declares a Human Testing status and the ticket is not `nature:internal` (the default goes through Human Testing); a workflow without that status (Solo) asks for no label. It refuses `nature:bundled-pr` there, and `→ Done` from AI Testing is for `nature:bundled-pr` only ("Nature axis").
- **PR-state guard**: refuses `→ Human Testing` without an open draft PR and `→ In Review` without an open non-draft PR; an unknown PR state blocks both, and Epics have no PR ("Draft PR lifecycle").
- **Local CI guard**: refuses `create-pr` without `--draft`, `ready-pr` and `→ Human Testing` while the required local CI statuses are not green on the exact head of the PR. The AI Testing document says how to make them green; `workflow-cli.sh local-ci-gate <ticket>` runs the same check on its own.
- **UI mockup guard**: refuses a `ui` ticket without a complete validation record on its way to the developer's review: `record-ui-validation` ("UI mockup gate").
- **SRS guard**: refuses a testing or review status for a ticket labelled `srs:*`, and fails open when labels cannot be read: `transition-drafting` ("SRS handoff").
- **PR-merged guard**: refuses `→ Done` without a matching PR verified merged into the working branch (Epics and verified `nature:bundled-pr` children own none), and a parent or an Epic whose native children are not all `Done`.

A guard refuses and the command it names does not fix it: stop, report the refusal and ask the developer. The escape hatches (the `SF_WORKFLOW_BYPASS_*` variables, `--bypass-srs`, `--bypass-reason`, `--skip-local-ci`) are the developer's to apply: an agent never sets one, and a guard hook refuses an agent's Bash call that sets one, labels the nature of its own ticket or (for a delegated agent) merges or marks a pull request ready. [escape-hatches.md](escape-hatches.md) catalogues what each switches off, when it is legitimate and the record to leave. The developer applies a hatch with `!` in Claude Code or from their own terminal, at the primary checkout.

## Nature axis

The `nature:*` label is the developer's alone to set. It chooses the route after AI Testing:

- `nature:user-facing` (the default when a ticket has no `nature:*` label): `AI Testing → Human Testing → In Review → Done`.
- `nature:internal` (refactor, scaffolding, internal tooling, documentation): `AI Testing → In Review → Done`.
- `nature:bundled-pr`: a child whose one atomic commit lands on its delivery parent's branch and that has no PR of its own: `AI Testing → Done`. The manual validation happens on the delivery parent's PR, once its children are validated.

A workflow that declares no Human Testing status (Solo) has no testing step to skip: `AI Testing → In Review` needs no label, whatever the ticket is, and the pull request review is the human gate. The axis then matters for `nature:bundled-pr` only.

## UI mockup gate

A ticket labelled `ui` (the marker of a user-interface change, set by the session or the developer) is validated on a mockup before its visual work reaches the developer's review: the UI mockup guard refuses the move to review until a complete validation record is on the ticket.

A ticket carries the `ui` label: read [reference/ui-gate.md](reference/ui-gate.md) for the commands (`set-ui`, `record-ui-validation`, `get-ui-validation`), the record format and "Working a `ui` ticket", which is how the agent that holds the ticket works.

## Ticket hierarchy

- **Epic** (issue type `sf-epic`): groups delivery parents and owns no branch, commit or PR. Its status is derived: the first native child entering `In progress` brings it there (through `Ready` on a board that declares it), the last child reaching `Done` brings it to `Done`. It never enters testing or review and may span several milestones.
- **Delivery parent** (Story, Task or Issue): owns a branch and a PR. When several deliverables must ship in one PR, make their immediate parent a delivery parent; the Epic only groups it.
- **Child ticket**: a native sub-issue made with `workflow-cli.sh create-subtask <parent> "<title>"`. A normal child owns its branch and PR; a `nature:bundled-pr` child lands one atomic commit on the parent's branch.

Close each child as it lands: a normal child reaches `Done` after its own PR is verified merged, a bundled child after its commit is validated on the parent's branch. Verify `gh issue view <child> --json state` prints `CLOSED` before the next sibling, and never batch closures. A parent or an Epic reaches `Done` only when `github-projects-cli.sh list-incomplete-children <N>` returns `[]`.

## One agent per ticket

A ticket between In progress and Done stays with its one agent until Done, hand-backs included. Several tickets may be in flight when each has its own agent and worktree; the session never stops delivering one ticket to start another. With delegation `declined` or unavailable, drive the current ticket to Done before claiming another, unless the developer asks to pause.

## Delegating work

You hand a ticket or a step to another agent (task kind, `sf agents route`, the brief, hand-backs, the `SF-DELEGATION` line): read [reference/delegation.md](reference/delegation.md), which holds "Delegation routing", "Delegated ticket delivery" and "Measured delegations".

## SRS handoff

A ticket that needs requirements (US, UR, FR, DS, TC) goes to the `sf-srs` skill (`.claude/skills/sf-srs/SKILL.md`), which picks the backend from `.saasfoundry.json` → `tools.srs.backend`. Write SRS pages through `.claude/skills/sf-srs/scripts/srs-cli.sh` (the actions write, draft, spawn, validate and eval), never by hand; `srs-cli.sh validate` smoke-tests the backend adapter.

A ticket labelled `srs:drafting`, `srs:update` or `srs:new` stays in the `In progress` column and moves through its own phases with `workflow-cli.sh transition-drafting <ticket> <ai-draft|human-review|spawning|done>`, never `update-status`. Each phase has a document:

{{DRAFTING_STATUSES_LIST}}

Stories under an SRS Epic come from the spawner, never from hand-written tickets: `workflow-cli.sh transition-drafting <parent> spawning --epic <feature> [--version <version>] [--milestone <release>] --reconciliation-plan <path>`. Preview with `--dry-run`, then rerun the same command without it. On a project with `tools.srs.backend` set, `create-subtask` exits 2 without `--bypass-srs <reason>`: that hatch is the developer's, for meta tickets (SRS tooling), and never to duplicate an FR that already has a page; [escape-hatches.md](escape-hatches.md) lists the reasons and the record.

A conversation turn that looks like a new requirement, or a change to a Functional Requirement, follows `sf-srs` → "Conversational eval hook".

## Draft PR lifecycle

Every delivery ticket gets its pull request **as a draft, at the latest during AI Testing** (`workflow-cli.sh create-pr <ticket> --draft`; opening it at the first push is fine, and a retry reuses the existing PR without changing its draft state). Keep the test plan and results on it.

Who takes it out of draft depends on whether the ticket's route has a Human Testing step:

- **With Human Testing** (the workflow declares the status and the ticket is not `nature:internal`): **the developer**, with the **Ready for review** button, after Human Testing and once you have pushed the non-regression tests. The click is the approval, and the review listener moves the ticket to In Review. Ask for the click and never run `ready-pr` yourself, even after the developer approves.
- **Without Human Testing** (the workflow has no such status, or the ticket is `nature:internal`): **you**, at the end of AI Testing once the report is posted and every check is green: `workflow-cli.sh ready-pr <ticket>`, then `update-status <ticket> "In review"`.

Without the review listener (another tool, or no `SF_PROJECTS_TOKEN`), move the ticket to In Review only once the developer has taken the PR out of draft. `draft-pr <ticket>` returns a ready PR to human retesting. A delegated agent stops at the green report with the PR still a draft: the session makes the transition for the route. A `nature:bundled-pr` child has no PR; its delivery parent's PR follows the parent's route.

`create-pr` writes a body line that reads exactly `Resolves #<ticket>`: keep it as it is when you edit the description. A pull request to a branch other than the default one links its ticket only through that line, and `sync-pr-review` refuses the event, naming the reason, when the line is missing, repeated for the same ticket or extended (`Resolves #7 — summary`). A pull request that delivers only part of a ticket that must stay open replaces it with a line that reads exactly `Part of #<ticket>`, naming the branch ticket: the listener then moves nothing and leaves a notice. The pull request that completes the ticket carries the `Resolves` line.

Several tickets in one PR, a stacked PR, a release ticket or the review listener: read [reference/pull-requests.md](reference/pull-requests.md).

## Other commands

- Create a top-level ticket on the board, in Backlog, with its issue type and complexity: `workflow-cli.sh create-ticket task "<title>" --complexity low`. Ticket and board commands route to the tool skill the manifest names (`.claude/skills/sf-tool-github-projects/SKILL.md` for GitHub Projects).
- An empty repository has no branch to start from and no PR to merge: `workflow-cli.sh bootstrap <ticket>` commits the setup on the main branch, creates the working branch and closes that first ticket. The Done guard accepts only the ticket the repository's single root commit names.
- A release scope is a milestone: `workflow-cli.sh milestone create|list|show|scope|assign|associate`. A version is associated to a release, never equal to it: one milestone per release, and several SRS version pages may point at it. A milestone reports where the scope stands and never blocks a release (Epic #542).
- Before a command expected to take more than ~5 seconds (test suites, builds, commit and push hooks, Docker scenarios), say in one sentence what runs and for how long. Over ~60 seconds, run it in the background and stream its progress markers (`tail -f <log> | grep -E --line-buffered "PASS|FAIL|\[sf-progress\]"`), then report the outcome with numbers.

## Where this sits in a new project

This skill carries phases 5 to 7 (create the tickets, base setup, features) of the zero-to-project flow that the `tool-saasfoundry` skill maps under "The zero-to-project flow". On a resumed session, run `tool-saasfoundry`'s `scripts/recap.sh` before assuming a phase: it reads the manifest and the board, never the chat history.
