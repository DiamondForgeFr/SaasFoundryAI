---
status: Done
banner_ai: Cleanup: checkout workingBranch, rebase-pull, delete the feature branch, rebase other in-progress branches
banner_human: Nothing — cycle complete
next_status: N/A (end of cycle)
---

# STATUS: Done

Finalization and cleanup after the merge.

## Ticket type

- **Epic**: `Done` is derived. Close the Epic issue once the last delivery-parent child is `Done`.
- **Story / Task / Issue with its own PR**: the steps below; the merge happens at the ticket level.
- **`nature:bundled-pr` child**: no PR of its own; it moves to `Done` straight after AI Testing. Branch cleanup is the delivery parent's: the shared branch is deleted when its PR merges.
- **Release ticket**: needs two merge commits, its RC pull request into the release branch, then one release → working branch synchronization pull request that closes no ticket
  ([pull-requests.md](../reference/pull-requests.md), "A release ticket").

## Steps

1. **Check the merge:** `gh pr view <N> --json state` prints `MERGED`. Reviewer approval is not a Done signal: the ticket stays in `In Review` until the merge.
2. **A parent or an Epic:** `github-projects-cli.sh list-incomplete-children <N>` returns `[]`: every native child's project-board Status is exactly `Done`.
3. **Move the ticket:** `workflow-cli.sh update-status <ticket> Done`. The PR-merged guard exits non-zero unless a matching PR is verified merged into the configured working branch (the branch
   convention of [6-in-review.md](6-in-review.md) applies); Epics and verified bundled children are exempt, and an escape hatch is the developer's to apply (escape-hatches.md).
4. **Clean up locally** (a bundled child shares the parent's branch: skip it), with the working branch from `jq -r '.workflow.workingBranch' .saasfoundry.json`: `git checkout <workingBranch>`, then
   `git pull origin <workingBranch> --rebase`, then `git branch -d <feature-branch>`.
5. **Rebase the other in-progress branches** on the refreshed working branch, after a real merge. Per branch, one command per call: `git checkout <other>`, then `git rebase <workingBranch>`, resolve
   the conflicts, then `git push --force-with-lease`.

Done when the ticket is `Done`, the local feature branch is deleted (where it applies) and the other in-progress branches are rebased (where it applies).

## Where the release now stands

`update-status … Done` prints the milestone's progress by itself: you run nothing, and it makes one API call, only when the ticket belongs to a milestone. It **reports**: the transition has already
succeeded before this runs, no exit code is read and nothing here can undo it. A milestone never blocks a release, and it must not block a ticket either.

You see it on a **change of state**, not on every close:

- a quarter crossed: `◆ « v1.0.0 » — 25/100 closed (25%), 75 still open.`
- the last ticket: `◆ « v1.0.0 » is complete — 49/49.` followed by the cut being named as the next step

Silence means the version moved inside the same quarter. That is deliberate: a note after every single close is how a signal becomes wallpaper.

When it says the release is complete, the next move is **not** to tag on the spot. Run `workflow-cli.sh milestone readiness "<name>"` for the full picture, and remember the tag stays a joint call with
the user.
