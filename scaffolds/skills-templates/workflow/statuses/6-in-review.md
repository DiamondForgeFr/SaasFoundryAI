---
status: In Review
banner_ai: Monitor CI until green, answer review comments, implement requested changes
banner_human: Review + merge the PR — your merge is what triggers Done
next_status: Done
---

# STATUS: In Review

Code review with a mandatory green CI.

## Ticket type

- **Epic**: never enters In Review and never produces a PR. It stays `In progress` until every delivery-parent child is `Done`.
- **`nature:bundled-pr` child**: never enters In Review; it goes AI Testing → Done, and the CLI rejects `update-status <ticket> "In review"` for it.
- **Release ticket**: enters when its RC pull request is ready. Late, once the RC is merged and its branch deleted, the guard accepts the verified merge in place of an open PR
  ([pull-requests.md](../reference/pull-requests.md), "A release ticket").
- **Story / Task / Issue with its own PR**: the steps below, one PR per ticket. It arrives after Human Testing (the non-regression tests pushed), or after AI Testing when it is `nature:internal`
  ("Nature axis" in `SKILL.md`).

## Steps

1. **The PR is ready.** After Human Testing the developer marked the draft ready; without Human Testing (`nature:internal`) you ran `ready-pr <ticket>` at the end of AI Testing. Keep the ticket link,
   the change summary, the test plan and results (the `## Test plan` and `## Test report` comments) and the tests created in its description, and assign the configured reviewers.
2. **Confirm the ticket is `In Review`.** The configured GitHub Ready for review listener performs the guarded transition. Without it, run `workflow-cli.sh update-status <ticket> "In review"`: it
   exits non-zero when no open, non-draft PR has a head branch matching `feature/<N>-…` or `fix/<N>-…`, and a PR opened from a differently-named branch is the one case for an escape hatch, which is
   the developer's (escape-hatches.md). Investigate a listener error instead of bypassing a guard.
3. **Monitor CI.** Readiness starts the complete applicable suite and later non-draft pushes rerun it; a draft-skipped check is not a validation. On red, read the logs, fix, commit, push, wait for
   green.
4. **Monitor the review:** answer questions and implement the requested changes. When the reviewer asks for extra tests, create them, run them locally, commit, push, wait for green CI and resolve the
   conversation.
5. **Human retesting needed:** `workflow-cli.sh draft-pr <ticket>` returns the PR to draft and cancels obsolete CI under the configured policy; fix and rerun AI Testing before the ticket returns to
   Human Testing.
6. **Delegated ticket:** a defect found in review, a red CI or a requested change goes back to the ticket's own agent, in the same worktree and on the same branch (the hand-back of Human Testing); the
   session answers the reviewer and does not code it. The agent returns the ticket to AI Testing when the change calls for retesting ([Delegated ticket delivery](../reference/delegation.md)). A defect
   or a requested change in the delegated work is a rework of that delegation: `sf agents outcome mark <ticket> rework` records it for the routing.
7. **Wait for the developer's approval and a green CI, then for their merge:** do not merge yourself unless they explicitly ask, and do not ask for the merge on a red CI. Done when the developer
   merged the PR into the target branch.

## Branch convention

The `→ In Review` guard and the `→ Done` PR-merged guard match branches by the ticket number, as `.saasfoundry.json` → `workflow.branchNaming` declares it (`feature/{N}-{description}`,
`fix/{N}-{description}`). A branch without the `{N}` prefix (such as `fix/some-name`) silently fails both and forces an escape hatch on every ticket: realign `branchNaming`, never "fix" the regex.
Quick check (the exit code should be 0): `echo "fix/32-detection-dropdown" | grep -Eq '^(feature|fix)/32(-|$)'`.
