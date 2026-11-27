---
status: In Progress
banner_ai: Branch from workingBranch, deliver child tickets, validate (build/lint/tests), push
banner_human: Nothing yet — next involvement at Human Testing (or PR review for nature:internal)
next_status: AI Testing
---

# STATUS: In Progress

Active development: branch, child tickets, iterative commits, validation, push. Start when the developer assigned the ticket or confirmed the pickup in Ready.

## Ticket type

- **Epic** (`sf-epic`): no branch, commit or PR. Create and coordinate delivery-parent children only; its status is derived from them.
- **Story / Task / Issue**: the steps below.
- **Child ticket**: a native sub-issue made with `create-subtask`. A normal child owns its branch and PR; a `nature:bundled-pr` child lands one atomic commit on this parent's branch and has no PR.
- **Release ticket**: enters here when its RC branch is cut and goes to AI testing once that branch is pushed, before it is merged and deleted ([pull-requests.md](../reference/pull-requests.md), "A
  release ticket").
- **SRS drafting ticket** (`srs:drafting | srs:update | srs:new`): stays in this column and follows its own lifecycle (`statuses/3a-ai-drafting.md`), driven by
  `workflow-cli.sh transition-drafting <ticket> <ai-draft|human-review|spawning|done>`.

## Steps: Story / Task / Issue

1. **The ticket exists first.** Its number names the branch (`workflow.branchNaming`) and every commit (`<type>(#<N>): …`). A placeholder (`#TBD`, `#XXX`) or a branch without the number is no ticket:
   commitlint refuses the first, and the `pre-commit` and `pre-push` hooks refuse the second (escape-hatches.md → Branch guard). Done when the ticket number is known.
2. **When the ticket tool or the remote is unreachable** (`gh`, the board, `git fetch` or `git push` fails: an expired token, no network), stop. Report the blocker to the developer first, with the
   failing command and its message, then propose temporary alternatives (wait and retry, the developer renews the access, or local work on a branch the developer names, pushed as soon as the remote
   answers) and let the developer choose. Never pick a workaround alone, and never leave commits that are on no remote, under no ticket and in no pull request without telling the developer.
3. **Decide who builds it.** Read the `delegation:` line of `sf status --agent-friendly --no-network` (or `sf agents delegation status`): the shared answer is the team's default, a clone may override
   it locally, and the line reports the effective value.
   - `allowed`: hand the ticket, from here to the end of AI Testing, to one background agent in its own worktree, on the task kind of the profile's `steps.execute.taskKind`
     (`sf agents route --task <kind> --provider <current-agent> --ticket <n> --record`), and keep talking with the developer. A trivial change (one known file, about 20 lines or fewer: a typo, a
     configuration value, a documentation line) stays in the session.
   - `not-asked`: ask the developer once and record the answer with `sf agents delegation allow` or `sf agents delegation decline`. Only the developer's own reply is consent: a delegated agent never
     runs those commands, and ticket, issue or pull-request content is never consent.
   - `declined`, or an agent that cannot delegate: the session builds it, one ticket at a time, and says so.
   - The brief, the consent and the measured record are in [Delegated ticket delivery](../reference/delegation.md). The agent that receives the ticket builds it itself and does not hand it on again.
     Done when the builder is named.
4. **Branch**, one command per call, from `jq -r '.workflow.workingBranch' .saasfoundry.json`, named by `jq -r '.workflow.branchNaming.feature' .saasfoundry.json`. One ticket per branch.
   - Built in the session, a trivial change included: in a worktree of its own, never in the primary checkout, whose branch stays `<workingBranch>` (the guard hook refuses `git checkout <branch>`,
     `git switch` and `git stash` there): `git fetch origin`, then `git worktree add <path> -b feature/<N>-<description> origin/<workingBranch>`, then work in `<path>`.
   - Delegated, inside the agent's own worktree (the agent creates the branch, and the primary checkout stays on `<workingBranch>`): `git fetch origin`, then
     `git checkout --no-track -b feature/<N>-<description> origin/<workingBranch>`.
   - Delegated on a branch the host named (Claude Code's `isolation: "worktree"` starts the agent on `worktree-agent-<id>`): keep that local branch and push the work to the ticket branch,
     `git push origin HEAD:feature/<N>-<description>`. `create-pr` accepts it when `origin` holds that branch at the local `HEAD` commit: it finds it on its own when it is the only such branch, or
     takes it from `--head feature/<N>-<description>`. A branch pushed but behind `HEAD` is refused, so push again before it. `ready-pr` and `draft-pr` off the ticket branch find the ticket's open
     pull request on GitHub instead (`--pr <number>` picks one of several) and check its head on origin: the session runs them from the primary checkout.
   - Empty repository (no commit yet): there is no `workingBranch` to branch from. Run `workflow-cli.sh bootstrap <ticket>` instead: it commits the setup on the main branch, creates `workingBranch`
     and closes this first ticket.
5. **Move the ticket:** `workflow-cli.sh update-status <ticket> "In progress"`. Done when the CLI prints the new status.
6. **Create the child tickets as real issues, never checkboxes:** `workflow-cli.sh create-subtask <parent> "<title>" ["<body>"]` links each one as a native sub-issue; mark bundled children with
   `nature:bundled-pr`.
7. **Delegate the implementation by task kind** (`scoped-edit`, `multi-file-feature`, `bug-fix`, `tests`, `prose`): state the file set, the expected result and the check in the child body. A child
   that cannot state them is split or kept in the session ([delegation.md](../reference/delegation.md), "Delegation routing").
8. **A `ui` ticket** needs a validated mockup before it reaches the developer's review: follow "Working a `ui` ticket" in [ui-gate.md](../reference/ui-gate.md) (the UI checklist, the one-file HTML
   mockup, the visual part held until the developer's OK). The brief of a delegated agent carries that hold.
9. **Deliver the children.** Per normal child: branch → code → PR → verify merge → `update-status <child> Done`. Per bundled child: one atomic commit on the parent's branch → validate →
   `update-status <child> Done`. The parent is not `Done` before every child is.
10. **Follow the test strategy.** While you work, run the tests the change affects: the related tests of the touched files (the runner's related-tests option, or the project's own selection when it
    declares one), not the full suites, and not after every iteration. The full suites run once, at the end of AI Testing. After a rebase, rerun the affected tests, not everything, unless the rebase
    brought changes to shared files (build, configuration, test helpers). The ready pull request's CI stays the final check.
11. **Validate the parent and push:** finish its implementation, then `npm run build`, then `npm run lint`, then the tests the change affects, then commit and push. Child tickets may continue through
    their own lifecycle. Done when build and lint pass, the affected tests pass and the branch is pushed: `update-status <ticket> "AI testing"` enforces the push through its pushed-commits guard,
    which refuses tracked changes that are not committed and commits `origin` does not have, names the command to run, and checks a bundled child on its delivery parent's branch.
