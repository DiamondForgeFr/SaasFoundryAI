---
status: In Progress
banner_ai: Branch from workingBranch, deliver child tickets, validate (build/lint/tests), push
banner_human: Nothing yet — next involvement at Human Testing (or PR review for nature:internal)
complexity_profiles: [bug, low, medium, complex]
entry_conditions:
  - Assignment or confirmation received in Ready
  - Ready to start development
mandatory_actions:
  - Create feature branch from `workingBranch` (manifest)
  - Move ticket to `In Progress`
  - Create subtasks as real GitHub issues (NOT checkboxes)
  - Deliver each child ticket in its declared mode; close it immediately when its PR is merged or its bundled commit is validated
  - Final validation — build, lint, unit tests green
  - Push branch
exit_conditions:
  - Code compiles without errors
  - Lint passes
  - Existing tests pass
  - Branch pushed to remote
next_status: AI Testing
---

# STATUS: In Progress

Active development — subtask creation, iterative commits, final validation.

## Ticket type

- **Epic** (`sf-epic` issue type): optional grouping ticket; no branch, commit, or PR. Only create and coordinate delivery-parent children. Epic status is **derived** from those children.
- **Story / Task / Issue**: full flow below.
- **Child ticket**: always a native GitHub sub-issue created with `create-subtask`. A normal child owns its branch and PR; a `nature:bundled-pr` child contributes one atomic commit on this parent's
  branch and has no own PR.

## SRS drafting tickets (`srs:drafting | srs:update | srs:new`)

These stay in the `In progress` board column but flow through a **separate lifecycle** — see `statuses/3a-ai-drafting.md`. Drive with
`workflow-cli.sh transition-drafting <ticket> <ai-draft|human-review|spawning|done>`. Never use `update-status` — the SRS guard blocks code-path transitions.

## Action checklist — Story / Task / Issue

- [ ] **Who builds it** — read `sf agents delegation status`. `allowed`: the session hands the ticket, from here to the end of AI Testing, to one background agent in its own worktree, on the task kind
      of the profile's `steps.execute.taskKind`, and keeps talking with the developer; the agent that receives it builds it itself and does not hand it on again. `declined`, or an agent that cannot
      delegate: the session builds it, one ticket at a time, and says so (SKILL.md → Delegated ticket delivery)
- [ ] **Branch** — from `jq -r '.workflow.workingBranch' .saasfoundry.json`, pattern `jq -r '.workflow.branchNaming.feature'`
  - `git checkout <workingBranch> && git pull --rebase && git checkout -b feature/<N>-<description>`
  - **Empty repository** (no commit yet): there is no `workingBranch` to branch from. Run `workflow-cli.sh bootstrap <ticket>` instead: it commits the setup on the main branch, creates `workingBranch`
    and closes this first ticket
- [ ] **Move ticket to "In Progress"** via `workflow-cli.sh update-status <ticket> "In progress"`
- [ ] **Create child tickets** — `workflow-cli.sh create-subtask <parent> "<title>" ["<body>"]` (auto-links as a native sub-issue); mark bundled children with `nature:bundled-pr`
- [ ] **Delegated implementation** — name the task kind (`scoped-edit`, `multi-file-feature`, `bug-fix`, `tests`, `prose`) and state the file set, expected result and check in the child body; a child
      that cannot state them is split or kept in the session (SKILL.md → Delegation routing)
- [ ] **Per normal child:** branch → code → PR → verify merge → `update-status <child> Done`; per bundled child: one atomic commit on the parent's branch → validate → `update-status <child> Done`
- [ ] **Before leaving In Progress:** finish the parent's implementation and validation → `npm run build && npm run lint` → `npm test` → push. Child tickets may continue through their own lifecycle.

## Errors to avoid

- Coding without creating a branch first
- Mixing multiple tickets in the same branch
- Moving to AI Testing with lint/build errors
- Forgetting to push before AI Testing
- Leaving delivered child tickets open, or marking the parent Done before every child is Done
- Switching mid-delivery to another ticket: one agent per ticket. With delegation `allowed`, another ticket gets its own agent and worktree while this one stays with its agent; otherwise finish this
  one first (unless the developer explicitly asks to pause)
- The session building a ticket itself while delegation is `allowed`
