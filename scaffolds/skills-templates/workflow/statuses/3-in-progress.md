# STATUS: In Progress

**ROLE**: Active development with subtasks creation and regular commits

## When to Enter This Status

- After receiving assignment or confirmation from developer in Ready
- Ready to start development

## Mandatory Actions (in this order)

### 1. CREATE A BRANCH
- Format: `feature/{N}-{description}` or `fix/{N}-{description}`
- From the configured working branch (e.g., develop)
- Command: `git checkout -b feature/{N}-{description}`

### 2. MOVE TICKET TO "IN PROGRESS"
- Update status in the project management tool

### 3. CREATE SUBTASKS
- Break down the ticket into atomic sub-tasks
- Format: `[Parent #{N}] Subtask description`
- Create them as GitHub issues and link to parent
- OR list them as checklist in parent ticket

### 4. DEVELOP ITERATIVELY
For each subtask:
- a. Move subtask to "In Progress"
- b. Write code for this subtask
- c. Commit with conventional message: `type(#{N}): description`
- d. Mark subtask "Done"
- e. Move to the next one

### 5. WHEN ALL SUBTASKS ARE DONE
- a. Run: `npm run build && npm run lint`
- b. Fix all lint/build errors
- c. Run existing tests (unit tests)
- d. Ensure nothing is broken
- e. Final commit if corrections needed
- f. Push the branch: `git push -u origin {branch-name}`

## Exit Conditions

- All subtasks are Done
- Code compiles without errors
- Lint passes
- Existing tests pass
- Code is pushed to remote

## Next Status

**AI Testing**

## Errors to Avoid

❌ NEVER code without creating a branch first
❌ NEVER mix multiple tickets in the same branch
❌ NEVER move to AI Testing with lint errors
❌ NEVER forget to push before moving to AI Testing
