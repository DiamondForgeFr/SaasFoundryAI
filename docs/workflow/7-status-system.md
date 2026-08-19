# 7-Status System

Every SaaSFoundryAI ticket moves through seven statuses. Each status has **mandatory actions** that must be completed before the ticket can transition to the next status, and **exit conditions** that
gate the transition. The AI agent reads the status description file (`.claude/skills/sf-workflow/statuses/<N>-<name>.md`) before taking any action.

## Overview

| #   | Status            | Role                                                     |
| --- | ----------------- | -------------------------------------------------------- |
| 1   | **Backlog**       | Preparation — detect complexity, analyse, plan, validate |
| 2   | **Ready**         | Queue of validated tickets awaiting pickup               |
| 3   | **In progress**   | Active development with subtask creation + commits       |
| 4   | **AI testing**    | Automated validation + test plan execution               |
| 5   | **Human testing** | Manual validation by the human developer                 |
| 6   | **In review**     | PR creation + green CI + reviewer approval               |
| 7   | **Done**          | Merge finalisation + branch cleanup                      |

## 1. Backlog

**Entry:** a new idea, feature request, or bug is raised.

**Mandatory actions (in order):**

1. Read the ticket thoroughly.
2. **Detect complexity** — the agent suggests 🐛 / 🟢 / 🟡 / 🔴 based on files impacted, keywords (auth / payment / security → complex), and risk. The developer has final say.
3. **Analyse** (adaptive by complexity) — skipped for bug, minimal for low, standard for medium, deep for complex.
4. **Plan** (adaptive) — skipped for bug, mental for low, file-by-file detailed for medium, comprehensive with dependencies for complex. Medium and complex plans require explicit approval.
5. **Challenge the specs** — ask clarifying questions, surface uncovered edge cases, validate the technical approach.
6. Ensure the ticket has a clear problem statement, acceptance criteria, technical context, and a complexity tag.

**Exit conditions:**

- Complexity tag set on the ticket label
- Analysis complete (if required by complexity)
- Plan approved (if required)
- Developer validates specs are complete

**Do NOT** create a branch, start coding, or skip complexity detection while in Backlog.

## 2. Ready

**Entry:** specs are validated and the ticket is prioritised.

**Mandatory actions:**

1. Wait for the developer to assign the ticket, or confirm with them which ticket to take.
2. Otherwise do nothing — Ready is a queue.

**Exit conditions:**

- Developer asks the agent to work on the ticket, OR
- Agent receives explicit confirmation to take it

## 3. In progress

**Entry:** developer assigns the ticket.

**Mandatory actions (in order):**

1. **Read config from `.saasfoundry.json`** — working branch and branch naming pattern.
2. **Create the feature branch** — checkout working branch, pull rebase, create `feature/{N}-{description}`.
3. Move the ticket's board status to "In progress".
4. **Create subtasks** — break the work into atomic subtasks via `github-projects-cli.sh create-subtask <parent> "<title>"`. Subtasks must be **real GitHub issues** linked via the GraphQL sub-issue
   relationship, never markdown checkboxes.
5. Implement iteratively, committing after each subtask lands.
6. **Close each subtask immediately when its commit is pushed** — never batch closures at the end. Verify with `gh issue view <sub> --json state`.
7. Push commits to remote **before** requesting the transition to AI testing.

**Exit conditions:**

- All subtasks closed on GitHub (zero open children)
- All commits pushed to remote
- Code is ready to be tested

## 4. AI testing

**Entry:** all subtasks complete and closed, code pushed.

**Mandatory actions:**

0. **Gate check — zero open children**: `gh issue list --state open --search "parent #{N}"` must return `[]`. If not, go back to In progress.
1. **Generate the test plan** — post as a ticket comment. Setup / scenarios / expected results / non-regression checks.
2. Move the board status to "AI testing".
3. **Run automated tests** — build, lint, type-check, unit tests.
4. **Execute the test plan manually** — verify every scenario, document issues.
5. If issues surface: fix → commit → push → restart from step 3.

**Exit conditions:**

- All automated checks green
- Every test plan scenario validated
- No open blockers

## 5. Human testing

**Entry:** AI testing passed.

**Mandatory actions:**

1. Wait for the human developer to test manually. Stay available for questions.
2. **If the developer finds bugs:** summarise the fix plan as a comment, implement, commit, push, and return to AI testing (re-run all automated checks).
3. **If the developer validates ✅:** before creating the PR, add non-regression tests — E2E (Playwright) for complex features, unit regression tests for edge-case bug fixes, none for typos/docs/CSS.
4. Verify tests pass locally (`npm run test:e2e`), commit with `test(#{N}): ...`, and push.

**Exit conditions:**

- Developer validates the feature
- Non-regression tests created and pushed (where applicable)

## 6. In review

**Entry:** human validation complete, tests pushed.

**Mandatory actions:**

1. **Create the PR** — title matches the ticket, description links the ticket, copies the test plan, lists tests added.
2. Assign reviewers and link the PR to the ticket.
3. Move the board status to "In review".
4. **Monitor CI** — if red, analyse, fix, push, wait for green.
5. **Monitor review comments** — answer questions, implement requested changes, add tests if requested.
6. Wait for approval and green CI.

**Exit conditions:**

- PR approved by all required reviewers
- CI fully green

## 7. Done

**Entry:** PR merged by the developer.

**Mandatory actions:**

1. Move the board status to "Done".
2. **Local branch cleanup** — checkout working branch, pull rebase, delete the feature branch.
3. **Rebase other in-progress branches** against the updated working branch; resolve conflicts if necessary; `git push --force-with-lease`.

**Exit conditions:**

- Ticket marked Done on the board
- Feature branch deleted locally
- Other in-progress branches rebased

## Why the gating matters

The status progression is **not a suggestion**. Each gate protects a real invariant:

- Backlog → Ready gates on specs being ready, so the agent doesn't start coding against ambiguous requirements.
- In progress → AI testing gates on subtask closure, so the board never shows an inconsistent state where code is merged but subtasks are still "open".
- AI testing → Human testing gates on automated checks, so the human doesn't waste time hunting for bugs the machine could have caught.
- Human testing → In review gates on non-regression tests, so a merged feature can't regress silently later.
- In review → Done gates on green CI + reviewer approval, so nothing ships without a second pair of eyes.

Skipping any of these gates is how bugs reach production. See [AI Rules](/workflow/ai-rules) for the enforcement contract.
