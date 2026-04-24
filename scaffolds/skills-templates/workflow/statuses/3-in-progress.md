---
status: In Progress
complexity_profiles: [bug, low, medium, complex]
entry_conditions:
  - Assignment or confirmation received in Ready
  - Ready to start development
mandatory_actions:
  - Create feature branch from `workingBranch` (manifest)
  - Move ticket to `In Progress`
  - Create subtasks as real GitHub issues (NOT checkboxes)
  - Develop iteratively — one commit per subtask, close each subtask right after its commit lands
  - Final validation — build, lint, unit tests green
  - Push branch
exit_conditions:
  - All subtasks closed on GitHub (`gh issue list --state open --search "parent #<N>"` returns [])
  - Code compiles without errors
  - Lint passes
  - Existing tests pass
  - Branch pushed to remote
next_status: AI Testing
---

# STATUS: In Progress

Active development — subtask creation, iterative commits, final validation.

## Ticket type

- **Epic** (`type: epic`): no branch, no commit, no PR. Skip "Branch + develop" + "Final validation" below. Only create children via `create-subtask` and coordinate. Epic status is **derived** — moves
  to `In progress` automatically when the first child does.
- **Story / Task / Issue**: full flow below.
- **Subtask**: a commit on the current branch, not a GitHub issue. Do not use `create-subtask`.

## SRS drafting tickets (`srs:drafting | srs:update | srs:new`)

These stay in the `In progress` board column but flow through a **separate lifecycle** — see `statuses/3a-ai-drafting.md`. Drive with
`workflow-cli.sh transition-drafting <ticket> <ai-draft|human-review|spawning|done>`. Never use `update-status` — the SRS guard blocks code-path transitions.

## Action checklist — Story / Task / Issue

- [ ] **Branch** — from `jq -r '.workflow.workingBranch' .saasfoundry.json`, pattern `jq -r '.workflow.branchNaming.feature'`
  - `git checkout <workingBranch> && git pull --rebase && git checkout -b feature/<N>-<description>`
- [ ] **Move ticket to "In Progress"** via `workflow-cli.sh update-status <ticket> "In progress"`
- [ ] **Create subtasks** — `workflow-cli.sh create-subtask <parent> "<title>" ["<body>"]` (auto-links as sub-issue)
- [ ] **Per subtask:** move to In Progress → code → commit (`<type>(#<N>): <description>`) → `update-status <sub> Done` → `gh issue view <sub> --json state` must print `CLOSED` (never batch closures)
- [ ] **All subtasks done:** verify zero open children (`gh issue list --state open --search "parent #<N>"` → `[]`) → `npm run build && npm run lint` → `npm test` → push

## Errors to avoid

- Coding without creating a branch first
- Mixing multiple tickets in the same branch
- Moving to AI Testing with lint/build errors
- Forgetting to push before AI Testing
- Batching subtask closures at the end — close each one right after its commit lands
- Starting another ticket while this one is still In Progress / AI Testing / Human Testing / In Review (unless the developer explicitly asks to pause)
