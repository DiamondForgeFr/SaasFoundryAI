---
status: Human Testing
complexity_profiles: [bug, low, medium, complex]
entry_conditions:
  - All AI Testing steps passed
  - Test plan ready for human validation
mandatory_actions:
  - Wait for developer validation
  - On bug report — fix, commit, push, return to AI Testing
  - On approval — create non-regression tests (E2E for complex/critical, unit for edge-case bugs; none for typo/doc/CSS)
  - Run created tests locally and ensure they pass
  - Commit and push tests (`test(#<N>): <description>`)
  - Be transparent when tests are intentionally skipped
exit_conditions:
  - Developer validated the feature
  - Non-regression tests created (when applicable)
  - Tests pass locally
  - Code with tests pushed
next_status: In Review (create PR)
---

# STATUS: Human Testing

Manual validation by the developer, followed by non-regression test creation.

## Ticket type

- **Epic** — no manual test, no PR. Status is **derived** from children (only enters Human Testing when the last child does). Skip this checklist.
- **Story / Task / Issue** — full flow below.

## Action checklist

- [ ] **Wait for validation** — developer tests manually, you stay available to answer
- [ ] **On bugs reported:**
  - Read the comments carefully, summarize the fix plan as a reply
  - Fix, commit, push, then return to **AI Testing** (re-run automated tests)
- [ ] **On approval** — create non-regression tests:
  - Complex/critical → E2E tests (Playwright)
  - Edge-case bug fix → unit non-regression test
  - Typo/doc/CSS refactor → none (state why in a comment)
- [ ] **Coverage** — main scenarios validated, edge cases identified, critical workflows
- [ ] **Verify locally** — `npm run test:e2e` (or relevant runner) must be green
- [ ] **Commit + push** — `test(#<N>): add E2E tests for <feature>` (pattern from `jq -r '.workflow.commitFormat.pattern' .saasfoundry.json`)

## Errors to avoid

- Creating tests BEFORE developer validation
- Creating a PR without non-regression coverage
- Pushing failing tests
