---
status: Done
banner_ai: Cleanup: checkout workingBranch, rebase-pull, delete the feature branch, rebase other in-progress branches
banner_human: Nothing — cycle complete
complexity_profiles: [bug, low, medium, complex]
entry_conditions:
  - One of:
      - PR merged into the working branch (verified via `gh pr view <N> --json state` → `MERGED`) — standard path from `In Review`
      - AI Testing passed + ticket carries `nature:bundled-pr` (no individual PR is opened at this Sub level)
  - Tickets without a PR (Epic groupers, doc-only chores, `nature:bundled-pr` Subs) skip the merge check
mandatory_actions:
  - Move ticket to `Done`
  - Local branch cleanup — checkout working branch, rebase-pull, delete feature branch (skip for `nature:bundled-pr` Subs — they share the parent Epic's branch)
  - Rebase any other in-progress branches on the fresh working branch (after a real merge)
exit_conditions:
  - Ticket marked `Done`
  - Local feature branch deleted (where applicable)
  - Other in-progress branches rebased (where applicable)
next_status: N/A (end of cycle)
---

# STATUS: Done

Finalization and cleanup after merge.

## Ticket type

- **Epic** — `Done` is **derived** only when every child Story/Task/Issue is `Done` (each child either merged its own PR or completed AI Testing as a `nature:bundled-pr` Sub). Close the Epic issue
  once the last child reaches `Done` and, if the Epic uses bundled-PR Subs, after the Epic's own bundled PR is merged.
- **Story / Task / Issue with its own PR** — full cleanup flow below; merge happens at the ticket level.
- **`nature:bundled-pr` Sub** — no individual PR. Move directly to `Done` after AI Testing. Branch cleanup is owned by the parent Epic (the shared Epic branch is deleted when the Epic's PR merges).

## Action checklist

- [ ] **Move ticket to Done** via `workflow-cli.sh update-status <ticket> Done`
- [ ] **Local cleanup** (working branch from `jq -r '.workflow.workingBranch' .saasfoundry.json`):
  - `git checkout <workingBranch>`
  - `git pull origin <workingBranch> --rebase`
  - `git branch -d <feature-branch>`
- [ ] **Rebase other in-progress branches** on the refreshed working branch:
  - per branch: `git checkout <other> && git rebase <workingBranch>` → resolve conflicts → `git push --force-with-lease`

## Errors to avoid

- Moving to Done before the actual merge — `update-status` blocks this when an open PR exists for the ticket. The PR merge event is what triggers Done; reviewer approval is **not** a Done signal
  (the ticket stays in `In Review` until merged).
- Forgetting to rebase other in-progress branches

## Guard

`workflow-cli.sh update-status <N> Done` exits non-zero if `gh pr list --state open` finds a PR whose head branch matches `feature/<N>-…` or `fix/<N>-…`. Escape hatch (rare, e.g. force-closed PR
re-opened by mistake): `SF_WORKFLOW_BYPASS_PR_MERGED_GUARD=1`.

> [!note] Convention sanity check
>
> This guard — and the `→ In Review` PR-existence guard — only match when branches carry the ticket number, exactly the convention declared in `.saasfoundry.json` → `workflow.branchNaming` (`feature/{N}-{description}`, `fix/{N}-{description}`). The two must stay in lock-step. Quick check (should print `ok`): `echo "fix/32-detection-dropdown" | grep -Eq '^(feature|fix)/32(-|$)' && echo ok`. A branch missing the `{N}` ticket prefix (e.g. `fix/some-name`) silently fails the guard and forces `SF_WORKFLOW_BYPASS_*` on every ticket — realign `branchNaming`, never "fix" the regex. A non-regression test locks both sides together: `src/__tests__/unit/skill/branch-naming-pr-regex.spec.ts`.
