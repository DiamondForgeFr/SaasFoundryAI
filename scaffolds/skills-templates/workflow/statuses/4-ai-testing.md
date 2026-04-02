# STATUS: AI Testing

**ROLE**: First automated validation + test plan execution

## When to Enter This Status

- After completing all subtasks in In Progress
- Code is pushed and ready to be tested

## Mandatory Actions (in this order)

### 1. GENERATE THE TEST PLAN
- Analyze all changes (git diff, commits)
- Create a complete test plan with:
  * Setup instructions
  * Scenarios to test (all nominal cases + edge cases)
  * Expected results for each scenario
  * Non-regression tests
- Post the test plan as ticket comment

### 2. MOVE TICKET TO "AI TESTING"
- Update status in the project management tool

### 3. RUN AUTOMATED TESTS
- Build: `npm run build`
- Lint: `npm run lint`
- Type-check: `npm run type-check` (if TypeScript)
- Unit tests: `npm run test:unit`

### 4. EXECUTE TEST PLAN MANUALLY
- Follow EACH step of the test plan
- Verify implemented functionalities
- Test edge cases
- Validate expected results
- Document any problems found

### 5. IF PROBLEMS ARE FOUND:
- a. Document problems in ticket comment
- b. Fix the problems
- c. Commit corrections
- d. Push
- e. RESTART from step 3 (automated tests)

### 6. IF ALL TESTS PASS:
- a. Create test report summary as comment
- b. Automatically move to Human Testing

## Exit Conditions

- All automated tests pass ✅
- Entire test plan executed and validated ✅
- No problems detected

## Next Status

**Human Testing**

## Errors to Avoid

❌ NEVER move to Human Testing with failing tests
❌ NEVER skip test plan steps
❌ NEVER say "it should work" - RUN the tests
❌ If a test fails, do NOT move to Human Testing, FIX it first
