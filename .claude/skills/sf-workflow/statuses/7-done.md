# STATUS: Done

**ROLE**: Finalization and cleanup after merge

## When to Enter This Status

- PR has been merged by the developer
- Code is now in the main branch

## Mandatory Actions

### 1. MOVE TICKET TO "DONE"

- Update status in the project management tool

### 2. LOCAL BRANCH CLEANUP

**Read working branch from config:**

```bash
WORKING_BRANCH=$(cat .saasfoundry.json | jq -r '.workflow.workingBranch')
```

**Cleanup:**

1. `git checkout ${WORKING_BRANCH}`
2. `git pull origin ${WORKING_BRANCH} --rebase`
3. `git branch -d {feature-branch}`

### 3. IF OTHER BRANCHES ARE IN PROGRESS

**Rebase other branches with updated working branch:**

```bash
WORKING_BRANCH=$(cat .saasfoundry.json | jq -r '.workflow.workingBranch')

# For each other branch:
git checkout {other-branch}
git rebase ${WORKING_BRANCH}
# Resolve conflicts if necessary
git push --force-with-lease
```

## Exit Conditions

- Ticket marked Done
- Local branch deleted
- Other branches rebased

## Next Status

N/A (end of cycle)

## Errors to Avoid

❌ NEVER move to Done before actual merge ❌ NEVER forget to rebase other in-progress branches
