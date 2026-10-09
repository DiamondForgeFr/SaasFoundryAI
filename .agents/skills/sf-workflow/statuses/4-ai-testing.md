---
status: AI Testing
banner_ai: Post the test plan, run automated + manual tests, fix on red, post the report
banner_human: Nothing yet — get ready to test manually (user-facing) or review the PR (internal)
complexity_profiles: [bug, low, medium, complex]
entry_conditions:
  - Code pushed and ready for testing
mandatory_actions:
  - Generate test plan and post as ticket comment
  - Move ticket to `AI Testing`
  - Open the draft PR if it is not open yet (`create-pr <ticket> --draft`)
  - Run automated tests (build, lint, type-check, unit tests)
  - Execute the test plan manually (nominal + edge cases)
  - Adversarial review — only for complexity `complex` (`examine.sh`)
  - If problems found — fix, commit, push, restart from automated tests
  - Post test report summary as comment when all green
exit_conditions:
  - All automated tests pass, including the configured heavy local validation before Human Testing
  - Test plan fully executed and validated
  - Adversarial review complete (complex tickets only)
  - All Critical/High findings fixed
  - Code pushed
next_status: Human Testing (default; the PR stays a draft) | In Review (nature:internal; you mark the PR ready) | Done (nature:bundled-pr)
---

# STATUS: AI Testing

First automated validation + test plan execution.

Aggregate Epics never enter this status. They stay `In progress` while their delivery children pass through testing and review, then roll directly to `Done` after the last child reaches `Done`.

## Action checklist

- [ ] **Test plan** — post a comment covering: setup, nominal + edge scenarios, expected results per scenario, non-regression coverage
- [ ] **Move ticket** to `AI Testing` via `workflow-cli.sh update-status`
- [ ] **Automated tests:** `npm run build` → `npm run lint` → `npm run type-check` (if TS) → `npm run test:unit`
- [ ] **Heavy local validation** — run the project's configured build/integration suite before Human Testing (for example `npm run test:pre-push` when declared in `package.json`). Record command,
      commit and results. Repeat after relevant fixes; ordinary pushes do not rerun this suite.
- [ ] **Local CI gate** — when `.saasfoundry.json` declares `workflow.localCi.requiredStatuses`, run the project's local CI on the exact pushed commit until every declared status is green. No diff is
      too small for it: a narrower check (`lint`, `check`) does not count. `create-pr` (without `--draft`) and `ready-pr` refuse a head without them; `--skip-local-ci "<reason>"` is the explicit
      escape hatch, recorded on the pull request.
- [ ] **Show progress on the PR** — around every heavy run, `workflow-cli.sh ai-status <ticket> "<step>" pending "<what runs>"`, then `success` or `failure` with a one-line result. The developer
      follows it from the PR's checks, which link to one progress comment; open the draft PR first (`create-pr <ticket> --draft`).
- [ ] **Execute test plan** step by step — verify each scenario, document any failure
- [ ] **On failure** — document, fix, commit, push, restart from automated tests
- [ ] **Complex only:** `.claude/skills/sf-workflow/scripts/examine.sh <ticket>` — 3 parallel review agents (security / logic / perf). Fix Critical/High findings. If any fix committed, restart from
      automated tests.
- [ ] **Returning from review** — if human retesting is needed, use `workflow-cli.sh draft-pr <ticket>` before returning to Human Testing. `create-pr --draft` reuses a PR without changing its state.
- [ ] **On green** — post test report summary (include examine findings if complex), then transition:

  - `nature:user-facing` (or no `nature:*` label): keep the PR a draft, with the test plan and results in it, then → **Human Testing**. Do not mark it ready: after Human Testing, the developer does
  - `nature:internal`: no Human Testing, so taking the PR out of draft is yours: `workflow-cli.sh ready-pr <ticket>`, then → **In Review** directly (see SKILL.md "Nature axis" section). The transition
    is enforced by the workflow guard.

  - `nature:bundled-pr`: → **Done** after validation; no individual draft or ready PR. The delivery parent owns the branch, PR, and human validation.

## Errors to avoid

- Moving to Human Testing with failing tests
- Marking a PR ready on the Human Testing route: that click belongs to the developer
- Skipping test plan steps
- Saying "it should work" — RUN the tests
- Skipping examine for complex tickets
- Ignoring Critical/High security findings
- Marking the parent Done while child tickets are still open or not yet Done (the Done gate is mandatory)
