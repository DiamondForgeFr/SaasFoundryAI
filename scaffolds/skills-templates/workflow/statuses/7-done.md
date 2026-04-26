---
status: Done
complexity_profiles: [bug, low, medium, complex]
entry_conditions:
  - PR merged into the working branch (verified via `gh pr view <N> --json state` → `MERGED`)
  - Code is on the target branch
  - Tickets without a PR (Epic groupers, doc-only chores) skip the merge check
mandatory_actions:
  - Move ticket to `Done`
  - Local branch cleanup — checkout working branch, rebase-pull, delete feature branch
  - Rebase any other in-progress branches on the fresh working branch
exit_conditions:
  - Ticket marked `Done`
  - Local feature branch deleted
  - Other in-progress branches rebased
next_status: N/A (end of cycle)
---

# STATUS: Done

Finalization and cleanup after merge.

## Ticket type

- **Epic** — `Done` is **derived** only when every child Story/Task/Issue is merged and closed. No branch to delete. Close the Epic issue once the last child reaches `Done`.
- **Story / Task / Issue** — full cleanup flow below.

## Action checklist

- [ ] **Move ticket to Done** via `workflow-cli.sh update-status <ticket> Done`
- [ ] **Local cleanup** (working branch from `jq -r '.workflow.workingBranch' .saasfoundry.json`):
  - `git checkout <workingBranch>`
  - `git pull origin <workingBranch> --rebase`
  - `git branch -d <feature-branch>`
- [ ] **Rebase other in-progress branches** on the refreshed working branch:
  - per branch: `git checkout <other> && git rebase <workingBranch>` → resolve conflicts → `git push --force-with-lease`

## Errors to avoid

- Moving to Done before the actual merge — `update-status` blocks this when an open PR exists for the ticket. The PR merge event is what triggers Done; reviewer "validation" / approval is **not** a
  Done signal (the ticket stays in `In review` until merged).
- Forgetting to rebase other in-progress branches

## Guard

`workflow-cli.sh update-status <N> Done` exits non-zero if `gh pr list --state open` finds a PR whose head branch matches `feature/<N>-…` or `fix/<N>-…`. Escape hatch (rare, e.g. force-closed PR
re-opened by mistake): `SF_WORKFLOW_BYPASS_PR_MERGED_GUARD=1`.
