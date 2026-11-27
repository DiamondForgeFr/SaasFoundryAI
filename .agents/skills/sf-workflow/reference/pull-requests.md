# Pull requests beyond one ticket, one branch

Where a pull request is not the plain one of one ticket: several tickets in one PR, a stacked PR, a release ticket and the review listener. `SKILL.md` ("Draft PR lifecycle") holds the rule that
applies to every ticket.

## One pull request, several tickets

A pull request that delivers several tickets carries one line per ticket (`Resolves #170`, `Resolves #171`, …). A ticket with no pull request of its own then finds that one, opened from another
ticket's branch into the PR target in the same repository, through its `Resolves #<ticket>` line or GitHub's closing reference to it: `ai-status`, `ready-pr`, `draft-pr`, `local-ci-gate`, the
pushed-commits guard (which checks that branch), the PR-state guard and the PR-merged guard. A ticket's own branch always wins. `sync-pr-review` moves every ticket the pull request resolves (GitHub's
closing references into the default branch, the `Resolves` lines elsewhere) and ends with one line per ticket that names the cause of any it did not move.

## A stacked pull request

A ticket's own pull request is found by its head branch (`feature/<N>-…`, `fix/<N>-…`), whatever it targets: one stacked on another ticket's branch, or into a work stream, is the ticket's pull request
for `ai-status`, `ready-pr`, `draft-pr`, `local-ci-gate`, the PR-state guard and the PR-merged guard's open-PR check. It must come from this repository and must not target the release branch. Several
open pull requests for one ticket are refused as ambiguous, `ai-status` included. The PR-merged guard still asks for a merge into the delivery branch, where the work has to arrive, and a pull request
that only resolves the ticket from another ticket's branch still has to target it.

## A release ticket

Its work is the RC branch (`workflow.branchNaming.release`) and that branch's pull request into the release branch: the title names the ticket (`chore(#<ticket>): …`) and the body has one line that
reads exactly `Closes #<ticket>`. Move the ticket while both exist, whatever tool runs the release:

- **In progress** when the RC branch is cut, **AI testing** once it is pushed, **In review** when its pull request is ready (the review listener makes that move when the ticket is already in AI
  testing).
- After the merge, with a merge commit, synchronize the release branch back into the working branch with a pull request that closes no ticket, merged by the developer with `gh pr merge <N> --merge`:
  name the method, because the GitHub button keeps the last one used, and a rebase or squash of identical trees merges nothing.
- Then **Done**. Its guard ignores a synchronization pull request that did not merge the release commit and requires exactly one that did.
- A ticket that did not move in time still reaches Done: the RC branch is deleted by then, so the guards of AI testing and In review accept, instead, its RC pull request verified merged into the
  release branch (merge commit, RC head and tree, ticket in the merge title, no open pull request of the ticket). Anything GitHub does not answer, and any ambiguity, still refuses.
- Human testing keeps asking for an open draft: on a workflow that has it, a late release ticket takes the `nature:internal` route, and that label is the developer's.

## The review listener

For GitHub Projects, `.github/workflows/pr-review-sync.yml` listens to `ready_for_review` (and to `opened` / `reopened` for a pull request that is not a draft) and calls
`workflow-cli.sh sync-pr-review <PR>`. The button is the developer's approval to enter review; the job still enforces the workflow guards.

- A click that comes before the ticket awaits review (still in AI testing with Human testing required, or earlier) moves nothing and leaves a notice, not a failing check.
- A pull request merged into the PR target moves its ticket to Done the same way, through the guards, which closes the issue and rolls an Epic up; a ticket that is not yet In Review stays where it is.
- The PR must close the ticket named by its configured feature/fix branch convention, and closes the other tickets it resolves the same way. Same-repository PRs are supported; fork PRs take the manual
  CLI transition.
- Set the Actions secret `SF_PROJECTS_TOKEN` with access to the repository and write access to the configured organization Project (a dedicated token with `repo` and `project` scopes): the default
  `GITHUB_TOKEN` cannot reach Projects. Never put credentials in the manifest or a PR.
- The listener runs only trusted default-branch code, never PR code. Commit it to the default branch before expecting automatic updates; it does not process clicks made before installation. A run that
  failed for missing credentials can be rerun after configuration.
- `installWorkflowSkill` deposits the listener and keeps an existing file of the same name. In an existing project, compare the checked-in listener with
  `scaffolds/skills-templates/workflow/github/pr-review-sync.yml` in the CLI package: a skill refresh does not replace a customized Actions file. A skill refresh does not update external CI
  configuration or remove custom push hooks either: draft PRs skip test and build CI, and the ready PR runs full CI.
