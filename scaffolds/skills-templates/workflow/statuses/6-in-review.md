# STATUS: In Review

**ROLE**: Code review + mandatory green CI

## When to Enter This Status

- After validation in Human Testing
- Non-regression tests created and pushed
- Ready to create the Pull Request

## Mandatory Actions

### 1. CREATE THE PULL REQUEST
- Title: Repeat the ticket title
- Description:
  * Link to the ticket
  * Summary of changes
  * Test plan (copy from ticket)
  * List of created tests (unit + E2E)
- Assign configured reviewers
- Link PR to ticket

### 2. MOVE TICKET TO "IN REVIEW"
- Update status in the project management tool

### 3. MONITOR CI
- CI will run the full test suite (unit + E2E)
- If CI is red 🔴:
  - a. Analyze error logs
  - b. Fix problems
  - c. Commit and push
  - d. Wait for CI to turn green ✅

### 4. MONITOR REVIEW COMMENTS
- Read all reviewer comments
- Answer questions
- Implement requested changes

### 5. IF REVIEWER REQUESTS ADDITIONAL TESTS:
- a. Create requested tests (unit or E2E)
- b. Run tests locally to verify
- c. Commit and push tests
- d. Wait for CI to pass ✅
- e. Resolve conversation when done

### 6. WAIT FOR APPROVAL AND GREEN CI
- ⚠️ MANDATORY CONDITION: CI must be green ✅
- Developer will merge ONLY if CI is green
- Do nothing until merged

## Exit Conditions

- PR approved by all required reviewers
- CI is green ✅ (all tests pass)
- Developer has merged the PR to target branch

## Next Status

**Done**

## Errors to Avoid

❌ NEVER ask developer to merge with red CI
❌ NEVER ignore test failures in CI
❌ NEVER merge yourself (unless explicit instruction)
