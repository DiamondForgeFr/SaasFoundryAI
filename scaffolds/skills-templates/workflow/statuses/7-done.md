---
status: Done
complexity_profiles: [bug, low, medium, complex]
entry_conditions:
  - PR merged by the developer
  - Code is on the target branch
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

- Moving to Done before the actual merge
- Forgetting to rebase other in-progress branches
