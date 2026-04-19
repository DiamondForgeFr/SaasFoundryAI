# AI Rules

The workflow is only useful if the AI agent follows it. These are the **non-negotiable rules** that the `sf-workflow` skill enforces on every ticket.

Violating these rules is not a style choice — it's a bug in the agent's behaviour. If you catch the agent bypassing any of these, correct it immediately and investigate why the guardrail failed.

## 1. Always read the status description before acting

Before every workflow action — transitioning status, creating a branch, running tests, opening a PR — the agent reads `.claude/skills/sf-workflow/statuses/<N>-<name>.md` to pull the mandatory
actions and exit conditions for the current status.

**Why:** status descriptions are the source of truth. They encode gating logic, ordering requirements, and edge cases that the conversation context cannot be trusted to preserve across long
sessions.

**How to apply:** when in doubt, re-run `.claude/skills/sf-workflow/workflow-cli.sh status <ticket>` and re-read the file. Never guess.

## 2. Never skip statuses

The status progression is strictly linear: `Backlog → Ready → In progress → AI testing → Human testing → In review → Done`. No shortcuts.

**Common violations to watch for:**

- Backlog → In progress (without Ready)
- In progress → Human testing (skipping AI testing)
- Human testing → Done (skipping In review / PR)
- Any status → Done before the PR is merged

**Why:** each gate exists to catch a class of bugs. Skipping Ready means coding against ambiguous specs. Skipping AI testing means asking the human to find bugs a machine could catch. Skipping
In review means merging without a second pair of eyes.

**How to apply:** when the agent thinks "this ticket is simple, we can skip X", it is wrong. The complexity system adjusts the *ceremony within each status* — it never removes statuses.

## 3. Never bypass the workflow CLI

Every status transition, every subtask creation, every board update goes through `workflow-cli.sh` and the tool-specific CLI (e.g. `github-projects-cli.sh`). The agent does not run raw
`gh api graphql` mutations, does not hand-edit labels, does not touch the project board directly.

**Why:** the CLI layer encapsulates multi-step logic (e.g. "set complexity" removes the old complexity label before adding the new one; "create subtask" creates the issue *and* links it via
the GraphQL `addSubIssue` mutation in one atomic step). Bypassing it leaves the board in an inconsistent state.

**How to apply:** if the agent wants to do something the CLI doesn't support, the fix is to **extend the CLI**, not to bypass it.

## 4. Commit and push before AI testing

The code being tested must be on the remote. Period.

**Why:** "AI testing" is an automated validation phase that must be reproducible. If the code only exists locally, CI cannot run, the developer cannot inspect it, and the test plan cannot be
validated against a consistent state.

**How to apply:** the last action of "In progress" is `git push`. Only then does the agent request the transition to AI testing. If the agent tries to transition without pushing, the gate
check fails.

## 5. Subtasks are real GitHub issues

When an In-progress ticket needs decomposition, subtasks are created as **real GitHub issues linked via the sub-issue relationship** — not as markdown checkboxes in the parent.

**Why:** checkboxes are cosmetic — they don't show up in search, assignees can't be tracked, they don't block parent transitions, and they disappear if someone edits the parent body. Real
sub-issues participate in the board, respect complexity labels independently, and can gate the parent's transitions.

**How to apply:** use `github-projects-cli.sh create-subtask <parent> "<title>"`. The CLI handles the GraphQL `addSubIssue` mutation. Never create subtasks with raw `gh issue create`.

## 6. Close subtasks as you go

After a subtask's commit lands, **immediately** close the corresponding issue — don't batch closures at the end of the parent ticket.

**Why:** the board state must reflect reality at all times. Merging code while leaving the subtask open creates an inconsistent state: the code is done, the board says it isn't. When the
parent transitions to AI testing, the zero-open-children gate (rule 7) fails and the agent has to context-switch back to close every subtask at once — losing the link between each closure and
its corresponding commit.

**How to apply:** after `git push` for a subtask commit, run `workflow-cli.sh update-status <sub> Done` and verify `gh issue view <sub> --json state` prints `CLOSED` before moving to the next
subtask.

## 7. Gate parent transitions on open children

Before any parent transition (`AI testing` → `Human testing` → `In review` → `Done`), run:

```bash
gh issue list --state open --search "parent #<N>"
```

The output must be `[]`. If any children are open, go back to In progress, close them, and only then re-attempt the parent transition.

**Why:** same invariant as rule 6, enforced at transition time as a last-resort check. Catches cases where rule 6 was accidentally violated.

**How to apply:** the status description for `4-ai-testing.md` runs this check as step 0 (before generating the test plan). The agent never skips step 0.

## 8. Finish the current ticket before starting another

If a ticket is in `In progress` / `AI testing` / `Human testing` / `In review`, drive it to Done before claiming or starting another.

**Why:** context-switching between tickets multiplies the risk of bypassing rules 4–7. The agent loses track of which branch to commit to, which subtasks to close, which test plan to run. The
only sure way to avoid cross-contamination is to fully close one ticket before opening another.

**How to apply:** the only override is an **explicit developer request to pause** the current ticket. The agent doesn't self-authorise a pause.

## Why these rules are not negotiable

The SaaSFoundry workflow is dogfooded: the same rules that govern how we build SaaSFoundry are the rules that govern how our users build their projects. Every bug in our workflow ships to every
user. Every shortcut we take is a shortcut users will inherit.

The rules exist because we have already felt the pain of each one being violated:

- Rule 4 came from a session where we ran AI testing on local code that was never pushed — the test plan validated nothing.
- Rules 5–7 came from a parent-child inconsistency that left subtasks open after the parent was merged.
- Rule 8 came from multiple incidents where a half-done ticket bled into a new one and corrupted both branches.

If you catch the agent violating any of these, the correct response is to reset to the last known-good state and restart the phase — not to paper over the violation.
