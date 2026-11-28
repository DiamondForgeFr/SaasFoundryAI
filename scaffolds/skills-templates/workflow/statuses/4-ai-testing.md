---
status: AI Testing
banner_ai: Post the test plan, run automated + manual tests, fix on red, post the report
banner_human: Nothing yet — get ready to test manually (user-facing) or review the PR (internal)
next_status: Human Testing (default; the PR stays a draft) | In Review (nature:internal; you mark the PR ready) | Done (nature:bundled-pr)
---

# STATUS: AI Testing

The first automated validation and the test plan. The route after it depends on the ticket's nature ("Nature axis" in `SKILL.md`). Aggregate Epics never enter it; they stay `In progress` until their
last child is `Done`.

## Steps

1. **Post the test plan** as a ticket comment starting with the heading `## Test plan`: setup, nominal and edge scenarios, the expected result of each, the non-regression coverage.
2. **Move the ticket** with `workflow-cli.sh update-status <ticket> "AI testing"`. The pushed-commits guard checks the work first: a tracked file that is not committed, a commit `origin` does not
   have, a branch `origin` lacks or an unreachable `origin` refuses the move and names the command to run (commit, then `git push`). Untracked files only warn.
3. **Open the draft PR** if it is not open yet: `workflow-cli.sh create-pr <ticket> --draft`. On a branch the host named (`worktree-agent-<id>`), `create-pr` takes the ticket branch from the tip match
   or from `--head <branch>`, and needs it pushed at `HEAD` ([3-in-progress.md](3-in-progress.md)).
4. **Run the automated tests:** `npm run build`, `npm run lint`, `npm run type-check` (if TS), `npm run test:unit`: the full suites, once, here.
5. **Follow the test strategy.** The full suites run once, at the end of AI testing, not after every iteration. After a fix or a rebase, rerun the affected tests (the related tests of the touched
   files), and the full suites only when the rebase brought changes to shared files (build, configuration, test helpers). The local CI gate checks the exact head: a rebase that moves the head is
   followed by the heavy pipeline once, on that head, before Human Testing. The ready pull request's CI stays the final check.
6. **Run the heavy local validation** on the pushed commit before Human Testing. A Molten pipeline counts only when `.molten/project.json` declares at least one job in `ci.jobs` and `molten ci status`
   answers (exit 0, 1 or 2: a MoltenTerm runner is reachable): then run `molten ci run <branch>` and record its verdict with `molten ci status`. A file with no job in `ci.jobs` declares no pipeline
   (`molten ci status` says "the pipeline declares no CI job", `sf status` shows `local-ci: npm suite`). Otherwise run the project's configured build/integration suite (for example `npm test` and
   `npm run test:pre-push` when declared in `package.json`). Record command, commit and results. Repeat it only when a fix changes shared code (step 5), not after every iteration; ordinary pushes do
   not rerun it. A delegated run is `terminal-ci` ([delegation.md](../reference/delegation.md), "Delegation routing").
7. **Make the local CI gate green** on the exact pushed commit. The required statuses come from `workflow.localCi.requiredStatuses` when it is recorded (`sf workflow set-local-ci`; `sf workflow show`
   and `sf status` print the list and where it comes from); otherwise from `local-<job>` for each job of `.molten/project.json` when it publishes to GitHub (`"ci": { "statuses": "github" }`), which
   `molten ci run <branch>` publishes; otherwise it is the status `AI testing / Local CI`, which you publish once the project's suite (`npm test`, `npm run test:pre-push` when declared) is green on
   that commit: `workflow-cli.sh ai-status <ticket> "Local CI" success "<command, commit, result>"` (the draft PR must exist to carry it). No diff is too small for it: a narrower check (`lint`,
   `check`) does not count. `create-pr` (without `--draft`), `ready-pr` and the move to **Human Testing** refuse a head without them and name the command to run
   (`workflow-cli.sh local-ci-gate <ticket>` runs the same check on its own). When it cannot be made green, stop and ask the developer: an escape hatch for the gate is theirs to apply
   (escape-hatches.md).
8. **Show progress on the PR** around every heavy run: `workflow-cli.sh ai-status <ticket> "<step>" pending "<what runs>"`, then `success` or `failure` with a one-line result. The developer follows it
   from the PR's checks, which link to one progress comment.
9. **Execute the test plan** step by step and document every failure. On failure: fix, commit, push, and restart from step 4.
10. **Complex only:** `.claude/skills/sf-workflow/scripts/examine.sh <ticket>` runs 3 parallel `review` delegations (security, logic, performance). Fix the Critical and High findings; when a fix is
    committed, restart from step 4.
11. **A delegated agent stops here.** When the report is posted and every check is green, it ends with the ticket still in AI Testing and the PR still a draft. It never merges, never runs `ready-pr`
    (the session or the developer does), never records the delegation consent and never moves the ticket itself past AI Testing. The session takes over: it runs the Examine of a `complex` ticket (the
    agent that built the work does not review it), hands the Critical and High findings back to that agent, then makes the transition of step 12, running `ready-pr` or `draft-pr` from the primary
    checkout: off the ticket branch they find the ticket's open pull request on GitHub (`--pr <number>` picks one of several) ([Delegated ticket delivery](../reference/delegation.md)). Findings handed
    back, or work the session had to redo, mean the delegation did not do the job: `sf agents outcome mark <ticket> rework` records it for the routing.
12. **On green, post the test report** as a ticket comment starting with the heading `## Test report` (layout below; include the Examine findings on a complex ticket), then transition:
    - `nature:user-facing` (or no `nature:*` label): keep the PR a draft, with the test plan and results in it, then → **Human Testing**. Do not mark it ready: after Human Testing, the developer takes
      it out of draft with the **Ready for review** button.
    - `nature:internal` (the developer labels it): no Human Testing, so the session takes the PR out of draft: `workflow-cli.sh ready-pr <ticket>`, then → **In Review** directly (see "Nature axis" in
      `SKILL.md`). The workflow guard enforces the transition.
    - `nature:bundled-pr`: → **Done** after validation; no individual draft or ready PR. The delivery parent owns the branch, the PR and the human validation.

When the ticket comes back from review and needs human retesting, `workflow-cli.sh draft-pr <ticket>` returns its PR to draft before the ticket returns to Human Testing (`create-pr --draft` reuses a
PR without changing its state).

Done when every automated test passes, the test plan is executed, no Critical or High finding is left (complex only), the code is pushed, the required local CI statuses are green on the PR head (the
local CI guard checks it), and the `## Test report` comment is posted: it is the reviewer's map.

## Plan and report headings

The plan comment starts with the exact heading `## Test plan` and the report comment with `## Test report`: tools that look for them match on these headings, and a comment under another title ("AI
Testing report") may not be found. The report carries the content of the steps above, laid out like this:

```markdown
## Test report

**Commit:** <sha> · **Result:** pass | fail

| Check      | Result |
| ---------- | ------ |
| lint       | …      |
| unit tests | …      |

### Test plan execution

- Scenario 1 — …: OK

### Examine findings (complex only)

…
```
