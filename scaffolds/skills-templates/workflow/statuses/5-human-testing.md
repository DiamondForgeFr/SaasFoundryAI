# STATUS: Human Testing

**ROLE**: Manual validation by human developer

> **ℹ️ Ticket type matters** (see `SKILL.md` → "Ticket Hierarchy"):
>
> - **Epic** (`type: epic`): no manual test, no PR. Epic status is **derived** from children — it only enters `Human testing` when the last child does, and only leaves once every child has moved on.
>   Do not run the steps below for an Epic.
> - **Story / Task / Issue** (`type: story | task | issue`): full flow below — the developer validates, then E2E tests are written before moving to `In review`.

## When to Enter This Status

- After successfully passing all tests in AI Testing
- Test plan is ready for human validation

## Mandatory Actions

### 1. WAIT FOR DEVELOPER VALIDATION

- Do nothing, the developer will manually test
- Stay available to answer questions

### 2. IF DEVELOPER FINDS BUGS:

- a. Read developer comments carefully
- b. Add comment summarizing what will be fixed
- c. Fix identified problems
- d. Commit and push corrections
- e. RETURN TO "AI TESTING" (re-run all automated tests)

### 3. IF DEVELOPER VALIDATES ✅:

**NOW, BEFORE CREATING THE PR:**

#### a. CREATE NON-REGRESSION TESTS:

- If complex/critical feature: create E2E tests (Playwright)
- If edge case bug fix: create unit non-regression test
- If simple feature (typo, doc, CSS): no E2E tests needed

#### b. COVER IN TESTS:

- Main user scenarios validated
- Identified and fixed edge cases
- Critical workflows

#### c. VERIFY TESTS LOCALLY:

- Run created E2E tests: `npm run test:e2e`
- Ensure they all pass ✅

#### d. COMMIT AND PUSH:

**Read commit format from config:**

```bash
COMMIT_PATTERN=$(cat .saasfoundry.json | jq -r '.workflow.commitFormat.pattern')
```

**Commit and push:**

- `git add .`
- `git commit -m "test(#{N}): add E2E tests for {feature}"`
  - Follow pattern from config: `${COMMIT_PATTERN}`
  - Replace `#N` with ticket number
  - Use type `test` for test commits
- `git push`

#### e. TRANSPARENCY:

- If you decide NOT to create E2E tests, inform the developer
- Explain why (e.g., "no E2E tests as simple CSS fix")

## Exit Conditions

- Developer validated the feature ✅
- Non-regression tests created (if applicable)
- Tests pass locally ✅
- Code with tests is pushed

## Next Status

**In Review** (create PR)

## Common Sense Rule

✅ Create tests if: new feature, edge case bug fix, user workflow, critical code ❌ No need if: typo, docs, simple CSS refactor, experimental feature

## Errors to Avoid

❌ NEVER create tests BEFORE developer validation ❌ NEVER create PR without creating non-regression tests ❌ NEVER push failing tests
