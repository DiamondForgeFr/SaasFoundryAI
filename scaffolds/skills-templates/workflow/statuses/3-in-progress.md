# STATUS: In Progress

**ROLE**: Active development with subtasks creation and regular commits

## When to Enter This Status

- After receiving assignment or confirmation from developer in Ready
- Ready to start development

## Mandatory Actions (in this order)

### 1. CREATE A BRANCH

**Read configuration from `.saasfoundry.json`:**
```bash
WORKING_BRANCH=$(cat .saasfoundry.json | jq -r '.workflow.workingBranch')
BRANCH_PATTERN=$(cat .saasfoundry.json | jq -r '.workflow.branchNaming.feature')
```

**Create feature branch:**
1. Ensure you're on working branch: `git checkout ${WORKING_BRANCH}`
2. Pull latest with rebase: `git pull origin ${WORKING_BRANCH} --rebase`
3. Create feature branch: `git checkout -b feature/{N}-{description}`
   - Format from config: `${BRANCH_PATTERN}` (e.g., `feature/{N}-{description}`)
   - Replace `{N}` with ticket number
   - Replace `{description}` with kebab-case description

### 2. MOVE TICKET TO "IN PROGRESS"
- Update status in the project management tool

### 3. CREATE SUBTASKS

**Break down the ticket into atomic sub-tasks.**

**MUST be real GitHub issues** (NOT checkboxes) linked as sub-issues to the parent.

**Use the helper script:**
```bash
# Create a subtask linked to parent issue
.claude/skills/sf-workflow/create-subtask.sh <parent-number> "Subtask title" ["Optional body"]

# Example:
.claude/skills/sf-workflow/create-subtask.sh 9 "Add validation logic"
.claude/skills/sf-workflow/create-subtask.sh 9 "Write unit tests" "Cover edge cases"
```

**The script automatically:**
- Prepends `[Parent #{N}]` to the title
- Creates the GitHub issue
- Links it as a sub-issue to the parent (via GraphQL API)
- Outputs the subtask number and URL

**Track subtask status in project board:**
- Backlog → In Progress (when you start) → Done (when complete)

### 4. DEVELOP ITERATIVELY

**Read commit format from config:**
```bash
COMMIT_PATTERN=$(cat .saasfoundry.json | jq -r '.workflow.commitFormat.pattern')
COMMIT_TYPES=$(cat .saasfoundry.json | jq -r '.workflow.commitFormat.types[]')
```

For each subtask:
- a. Move subtask to "In Progress"
- b. Write code for this subtask
- c. Commit with format from config: `${COMMIT_PATTERN}`
  - Example: `type(#{N}): description`
  - Use allowed types: `feat`, `fix`, `docs`, `refactor`, etc.
  - Replace `#{N}` with ticket number
- d. **Close the subtask immediately** — run `workflow-cli.sh update-status <sub> Done` and **verify** with `gh issue view <sub> --json state` that it prints `CLOSED`. Never batch closures.
- e. Move to the next one

### 5. WHEN ALL SUBTASKS ARE DONE
- a. **Verify zero open children** — `gh issue list --state open --search "parent #{N}"` must return an empty array before going further. If not, close the remaining children first.
- b. Run: `npm run build && npm run lint`
- c. Fix all lint/build errors
- d. Run existing tests (unit tests)
- e. Ensure nothing is broken
- f. Final commit if corrections needed
- g. Push the branch: `git push -u origin {branch-name}`

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
❌ NEVER batch subtask closures at the end of the parent — close each one right after its commit lands
❌ NEVER start another ticket while this one is still In Progress / AI Testing / Human Testing / In Review (unless the developer explicitly asks you to pause)
