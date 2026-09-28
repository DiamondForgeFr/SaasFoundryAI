# Team workflow: the 7-status system

The `saasfoundry` preset is the complete team workflow. Every delivery status has mandatory actions and exit conditions in `.claude/skills/sf-workflow/statuses/`. The workflow CLI reads the ordered
status list from `.saasfoundry.json`; it does not hardcode the sequence.

::: info Looking for the lighter flow?

The `solo` preset uses five statuses: `Backlog → In progress → AI testing → In review → Done`. It removes the separate Ready and Human testing columns, and makes pull-request review the human gate.
See [Workflow system](/workflow/introduction).

:::

## The seven stages

| #   | Status            | What happens                                                  | Human meaning                             |
| --- | ----------------- | ------------------------------------------------------------- | ----------------------------------------- |
| 1   | **Backlog**       | Clarify the problem, detect complexity, analyse and plan      | Approve the intent and plan when required |
| 2   | **Ready**         | Keep validated, prioritised work available for pickup         | Confirm which ticket starts               |
| 3   | **In progress**   | Branch, child tickets, implementation, commits and push       | Follow delivery progress                  |
| 4   | **AI testing**    | Test plan, automated checks, adversarial review when required | Receive reproducible evidence             |
| 5   | **Human testing** | Test the feature from the draft PR in a real runtime          | **Feature testing**                       |
| 6   | **In review**     | Ready PR, full CI, review comments and approval               | **Code review**                           |
| 7   | **Done**          | Verify merge, close the ticket and clean branches             | Accept the delivered result               |

## 1. Backlog — clarify before coding

The agent reads the issue and current codebase, assigns one complexity label (`bug`, `low`, `medium`, `complex`) and adapts its analysis. Medium and complex plans require explicit approval before
implementation.

Exit requires a clear problem, acceptance criteria, technical context and complexity. No branch or implementation starts in Backlog.

## 2. Ready — the validated queue

Ready means the ticket can start immediately, not that an agent may silently claim it. The developer assigns the ticket or explicitly confirms pickup. The workflow then creates the configured feature
branch and moves to In progress.

## 3. In progress — deliver traceable work

The agent reads branch and commit policy from the manifest, creates native GitHub sub-issues when decomposition is useful, and implements on the feature branch.

- A normal child owns its own branch and pull request.
- A `nature:bundled-pr` child contributes one atomic commit to its delivery parent's branch.
- An Epic is an aggregate: it owns no branch and no pull request.

Before AI testing, the implementation must compile, lint, pass the relevant tests, be committed and be pushed. Testing unpushed code is forbidden because nobody else can reproduce or inspect it.

## 4. AI testing — build the evidence

The agent publishes a test plan, runs the configured automated and manual scenarios, documents results, and fixes failures before proceeding. Complex work also receives independent adversarial review.

For a user-facing ticket, the agent then opens or reuses a **draft pull request**. The draft contains the diff, test plan and current evidence but does not start ready-PR CI yet. This gives Human
testing a stable artifact to validate.

## 5. Human testing — feature testing

Human testing answers: **does the feature behave correctly for its users?**

The developer uses the draft PR, test instructions and a real runtime to exercise the behavior. This is not code review. If a bug appears, the ticket returns to AI testing after the fix, push and full
retest.

After approval, required non-regression tests are committed and pushed. The same pull request is then marked ready for review.

## 6. In review — code review

In review answers: **is this implementation safe, maintainable and ready to merge?**

The pull request is no longer a draft. Full CI runs; reviewers inspect the code and architecture; the agent addresses comments and reruns validation after changes. The ticket stays In review until
approvals are present, CI is green, and the developer merges the PR.

## 7. Done — verified merge, then cleanup

Done requires evidence that the pull request is merged into the configured target branch. The workflow also checks native children: a parent cannot become Done while a child is unfinished.

After verification, the agent closes the issue, synchronises the configured working branch and removes only branches or worktrees that are known to be merged and no longer in use.

## Nature-controlled routes

Not every ticket is a user-facing delivery ticket:

| Nature               | Controlled route                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `nature:user-facing` | Full team path including feature testing and code review                                         |
| `nature:internal`    | May skip the separate feature-testing gate; still requires review policy and merge evidence      |
| `nature:bundled-pr`  | Child reaches Done after its atomic commit is validated on the parent's branch; no individual PR |
| Epic                 | Status derives from native children; no branch or PR                                             |

These paths are encoded in the workflow guards. They are not permission to invent arbitrary shortcuts.

## SRS drafting is a separate lifecycle

Tickets labelled `srs:drafting`, `srs:update` or `srs:new` remain in the board's In progress column while they move through:

```text
AI draft → Human review → Spawning → Done
```

Use `workflow-cli.sh transition-drafting`; code-path transitions to AI testing, Human testing or In review are rejected.

## Why the gates matter

- Backlog protects intent.
- Ready protects ownership and prioritisation.
- AI testing protects the human from machine-detectable regressions.
- Human testing protects product behavior.
- In review protects code quality and integration.
- Done protects the truth of the board by requiring a verified merge and completed children.

See [Agent rules](/workflow/ai-rules) for the operational invariants and [Complexity system](/workflow/complexity-system) for adaptive rigor.
