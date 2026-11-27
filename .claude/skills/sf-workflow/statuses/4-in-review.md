---
status: In Review
banner_ai: Monitor CI until green, answer review comments, implement requested changes
banner_human: Review + merge the PR — this is the human gate of the solo workflow; your merge triggers Done
next_status: Done
---

# STATUS: In Review

The human gate of the solo workflow. There is no separate manual-testing status: the developer validates here, by reviewing the diff, reading the `## Test report` comment and testing manually when the
change warrants it. Make that review effortless: a clear PR description, a complete test report, green CI, and anything the reviewer should look at manually pointed out.

## Ticket type

- **Epic**: never enters In Review and never produces a PR. It stays `In progress` until every delivery-parent child is `Done`.
- **`nature:bundled-pr` child**: never enters In Review; it goes AI Testing → Done, and the CLI rejects `update-status <ticket> "In review"` for it.
- **Release ticket**: enters when its RC pull request is ready. Late, once the RC is merged and its branch deleted, the guard accepts the verified merge in place of an open PR
  ([pull-requests.md](../reference/pull-requests.md), "A release ticket").
- **Story / Task / Issue with its own PR**: the steps below, one PR per ticket.

## Steps

1. **The PR is ready.** You took it out of draft with `ready-pr <ticket>` at the end of AI Testing; its title is the ticket title and its description holds the ticket link, a change summary, the test
   plan and the tests created. If a draft is still open, run `workflow-cli.sh ready-pr <ticket>` first: a draft-skipped CI check is no validation.
2. **Move the ticket:** `workflow-cli.sh update-status <ticket> "In review"`. It exits non-zero when no open PR has a head branch matching `feature/<N>-…` or `fix/<N>-…`; a PR opened from a
   differently-named branch is the one case for an escape hatch, and the hatch is the developer's (escape-hatches.md).
3. **Monitor CI:** on red, read the logs, fix, commit, push, wait for green.
4. **Monitor the review:** answer questions and implement the requested changes. When the reviewer asks for extra tests, create them, run them locally, commit, push, wait for green CI and resolve the
   conversation.
5. **Delegated ticket:** a defect found in review, a red CI or a requested change goes back to the ticket's own agent, in the same worktree and on the same branch; the session answers the reviewer and
   does not code it. The agent returns the ticket to AI Testing when the change calls for retesting ([Delegated ticket delivery](../reference/delegation.md)).
6. **Wait for the developer's approval and a green CI, then for their merge:** do not merge yourself unless they explicitly ask, and do not ask for the merge on a red CI. Done when the developer
   merged the PR into the target branch.

## Branch convention

The `→ In Review` guard and the `→ Done` PR-merged guard match branches by the ticket number, as `.saasfoundry.json` → `workflow.branchNaming` declares it (`feature/{N}-{description}`,
`fix/{N}-{description}`). A branch without the `{N}` prefix (such as `fix/some-name`) silently fails both and forces an escape hatch on every ticket: realign `branchNaming`, never "fix" the regex.
Quick check (the exit code should be 0): `echo "fix/32-detection-dropdown" | grep -Eq '^(feature|fix)/32(-|$)'`.
