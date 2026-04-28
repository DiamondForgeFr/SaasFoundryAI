---
status: In Review
complexity_profiles: [bug, low, medium, complex]
entry_conditions:
  - One of:
      - Human Testing validated + non-regression tests created and pushed (`nature:user-facing` path)
      - AI Testing passed + ticket carries `nature:internal` label (skip-Human-Testing path — see SKILL.md "Nature axis")
  - **An open Pull Request exists for the ticket** (PR-existence guard — `In Review` without a PR is rejected by the CLI)
  - Ticket is **not** `nature:bundled-pr` — those go AI Testing → Done directly (no individual PR at this Sub level)
mandatory_actions:
  - Create the Pull Request (title + description + test plan + test list + reviewers + ticket link)
  - Move ticket to `In Review`
  - Monitor CI until green
  - Answer reviewer comments and implement requested changes
  - Add tests when reviewer asks; verify locally, commit, push, wait for green CI
  - Wait for approval AND green CI — do NOT merge
exit_conditions:
  - PR approved by all required reviewers
  - CI is green
  - Developer merged the PR to the target branch
next_status: Done
---

# STATUS: In Review

Code review with mandatory green CI.

## Ticket type

- **Epic** — **never produces a PR**. Status is **derived** — reflects that every child Story/Task/Issue is itself in `In Review` (one open PR per child) **or** has gone AI Testing → Done as a
  `nature:bundled-pr` Sub. When an Epic uses bundled-PR Subs, the Epic itself opens **one** PR at the very end. Skip the checklist for the Epic ticket.
- **Story / Task / Issue with its own PR** — full flow below, one PR per ticket.
- **`nature:bundled-pr` Sub** — **never enters `In Review`**. Goes AI Testing → Done directly. The CLI rejects `update-status <ticket> "In review"` for these tickets.

## Action checklist

- [ ] **Create the PR** — title = ticket title; description = ticket link + change summary + test plan (copy from ticket) + created tests (unit + E2E); assign configured reviewers; link PR to ticket
- [ ] **Move ticket** to `In Review` via `workflow-cli.sh update-status`
- [ ] **Monitor CI** — on red: analyze logs, fix, commit, push, wait for green
- [ ] **Monitor reviews** — answer questions, implement requested changes
- [ ] **Reviewer asks for extra tests** — create them, run locally, commit, push, wait for green CI, resolve conversation
- [ ] **Wait for approval + green CI** — do nothing until the developer merges

## Errors to avoid

- Asking the developer to merge with red CI
- Ignoring test failures in CI
- Merging yourself (unless explicitly instructed)
