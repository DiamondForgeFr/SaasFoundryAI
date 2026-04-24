---
status: AI Testing
complexity_profiles: [bug, low, medium, complex]
entry_conditions:
  - All subtasks completed in In Progress
  - All subtasks CLOSED on GitHub (issues closed, not just merged)
  - Code pushed and ready for testing
mandatory_actions:
  - Gate check — zero open children (`gh issue list --state open --search "parent #<N>"` must be `[]`)
  - Generate test plan and post as ticket comment
  - Move ticket to `AI Testing`
  - Run automated tests (build, lint, type-check, unit tests)
  - Execute the test plan manually (nominal + edge cases)
  - Adversarial review — only for complexity `complex` (`examine.sh`)
  - If problems found — fix, commit, push, restart from automated tests
  - Post test report summary as comment when all green
exit_conditions:
  - All automated tests pass
  - Test plan fully executed and validated
  - Adversarial review complete (complex tickets only)
  - All Critical/High findings fixed
  - Code pushed
next_status: Human Testing
---

# STATUS: AI Testing

First automated validation + test plan execution.

## Action checklist

- [ ] **Gate:** `gh issue list --state open --search "parent #<N>"` returns `[]`. If not — back to In Progress, close children, then return.
- [ ] **Test plan** — post a comment covering: setup, nominal + edge scenarios, expected results per scenario, non-regression coverage
- [ ] **Move ticket** to `AI Testing` via `workflow-cli.sh update-status`
- [ ] **Automated tests:** `npm run build` → `npm run lint` → `npm run type-check` (if TS) → `npm run test:unit`
- [ ] **Execute test plan** step by step — verify each scenario, document any failure
- [ ] **On failure** — document, fix, commit, push, restart from automated tests
- [ ] **Complex only:** `.claude/skills/sf-workflow/scripts/examine.sh <ticket>` — 3 parallel review agents (security / logic / perf). Fix Critical/High findings. If any fix committed, restart from
      automated tests.
- [ ] **On green** — post test report summary (include examine findings if complex), then transition to Human Testing

## Errors to avoid

- Moving to Human Testing with failing tests
- Skipping test plan steps
- Saying "it should work" — RUN the tests
- Skipping examine for complex tickets
- Ignoring Critical/High security findings
- Entering AI Testing while subtasks are still OPEN on GitHub (gate rule)
