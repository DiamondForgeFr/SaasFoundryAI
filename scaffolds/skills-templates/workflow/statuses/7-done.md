# STATUS: Done

**ROLE**: Finalization and cleanup after merge

## When to Enter This Status

- PR has been merged by the developer
- Code is now in the main branch

## Mandatory Actions

### 1. MOVE TICKET TO "DONE"
- Update status in the project management tool

### 2. LOCAL BRANCH CLEANUP
- `git checkout {working-branch}` (e.g., develop)
- `git pull origin {working-branch}`
- `git branch -d {feature-branch}`

### 3. IF OTHER BRANCHES ARE IN PROGRESS
- Rebase each branch with updated working branch
- `git checkout {other-branch}`
- `git rebase {working-branch}`
- Resolve conflicts if necessary
- `git push --force-with-lease`

## Exit Conditions

- Ticket marked Done
- Local branch deleted
- Other branches rebased

## Next Status

N/A (end of cycle)

## Errors to Avoid

❌ NEVER move to Done before actual merge
❌ NEVER forget to rebase other in-progress branches
