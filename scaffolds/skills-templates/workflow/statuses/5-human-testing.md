---
status: Human Testing
banner_ai: Waiting — supporting reproduction and fixing whatever you report
banner_human: Execute the manual test plan and report pass/fail on the ticket
next_status: In Review (the developer marks the draft PR ready)
---

# STATUS: Human Testing

Manual validation in a draft PR, followed by non-regression tests. The developer, not the agent, takes the PR out of draft. Draft PR events skip test and build CI; a skipped check is not proof that
tests passed.

The status is mandatory for `nature:user-facing` tickets (or any ticket without a `nature:*` label) and skipped for `nature:internal` ones, which go AI Testing → In Review ("Nature axis" in
`SKILL.md`). An Epic never enters it: it has no manual test or PR and stays `In progress` until every delivery-parent child is `Done`.

Start when an open draft PR holds the `## Test plan` and `## Test report` comments and the project's required local CI statuses are green on its head: the local CI guard of
`update-status … "Human testing"` reads them, and a hatch for it is the developer's to apply (escape-hatches.md).

## Steps

1. **Keep the draft PR current.** Reuse the PR opened at the end of AI Testing (`workflow-cli.sh create-pr <ticket> --draft`) and keep its description, test plan and results current (the
   `## Test plan` and `## Test report` comments). Never promote it yourself.
2. **Wait for the developer's manual validation.** The session stays their interlocutor and answers.
3. **On a reported bug,** read the comments and summarize the fix plan as a reply. A defect means the delegation that delivered the work did not do the job: run
   `sf agents outcome mark <ticket> human-defect` so the routing counts it as a failure (the original record stays as it was). With delegation `allowed`, the session does not code the fix: it hands
   the defect to the ticket's own agent, in the same worktree and on the same branch, and starts no new agent, branch or worktree for it ([Delegated ticket delivery](../reference/delegation.md)); with
   delegation not allowed, the session fixes it itself. Fix, commit, push, then return to **AI Testing** and rerun the automated tests: the agent that fixes it moves the ticket back. The
   pushed-commits guard checks the fix is committed and pushed first, and the local CI statuses must be green again on the new head before the ticket comes back to Human Testing.
4. **On approval, create the non-regression tests** (and any other AI work the validation leaves, such as follow-ups): the session hands them to the ticket's own agent the same way. Create them only
   after the developer validated. Complex or critical: E2E tests (Playwright). Edge-case bug fix: a unit non-regression test. Typo, doc or CSS change: none, and say so in a comment. Cover the main
   scenarios, the edge cases and the critical workflows.
5. **Verify locally** with `npm run test:e2e` (or the relevant runner): green before any push.
6. **Commit and push** the tests: `test(#<N>): add E2E tests for <feature>` (pattern from `jq -r '.workflow.commitFormat.pattern' .saasfoundry.json`).
7. **Hand over for review.** Once the tests are pushed, ask the developer to mark the PR **Ready for review**, and do not run `ready-pr` yourself: on this route the click is the developer's approval.
   The `ready_for_review` event starts full CI, and when the GitHub review listener and `SF_PROJECTS_TOKEN` are installed on the default branch it also moves the ticket to In review. Otherwise run the
   guarded `update-status <ticket> "In review"` once the PR is out of draft.

Done when the developer validated the feature, the non-regression tests (when applicable) are pushed and pass locally, and the PR is still a draft until the developer's click.
