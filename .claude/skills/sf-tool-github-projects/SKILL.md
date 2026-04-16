# GitHub Projects Tool

Integration with GitHub Projects for ticket management, status updates, and workflow automation.

## Auto-trigger keywords
github project, create subtask, update ticket status, github issue, project board

## Configuration

This skill reads all configuration from `.saasfoundry.json` at the project root:

```bash
# Project URL
jq -r '.workflow.projectUrl' .saasfoundry.json

# Working branch
jq -r '.workflow.workingBranch' .saasfoundry.json

# Workflow statuses
jq -r '.workflow.statuses' .saasfoundry.json
```

**No credentials needed** - Uses `gh` CLI authentication (requires `gh auth login`).

## Available Commands

### Create Subtask

Create a GitHub sub-issue linked to a parent issue.

**Usage:**
```bash
.claude/skills/sf-tool-github-projects/github-projects-cli.sh create-subtask <parent-number> <title> [body]
```

**Examples:**
```bash
# Simple subtask
github-projects-cli.sh create-subtask 9 "Add validation logic"

# With description
github-projects-cli.sh create-subtask 9 "Write unit tests" "Cover edge cases and error handling"
```

**What it does:**
1. Prepends `[Parent #{N}]` to the title
2. Creates the GitHub issue
3. Links it as a sub-issue to the parent via GraphQL API
4. Returns the subtask number and URL

### Update Status

Update the status of a ticket in GitHub Projects.

**Usage:**
```bash
github-projects-cli.sh update-status <ticket-number> <status-name>
```

**Examples:**
```bash
# Move to In Progress
github-projects-cli.sh update-status 42 "In Progress"

# Move to AI Testing
github-projects-cli.sh update-status 42 "AI Testing"

# Move to Done
github-projects-cli.sh update-status 42 "Done"
```

**Note:** Status names must match exactly the statuses defined in your GitHub Project board.

### Get Current Status

Get the current status of a ticket.

**Usage:**
```bash
github-projects-cli.sh status <ticket-number>
```

**Returns:** The current status name (e.g., "In Progress", "AI Testing", "Done")

### Create Pull Request

Create a pull request for a ticket.

**Usage:**
```bash
github-projects-cli.sh create-pr <ticket-number>
```

**What it does:**
1. Verifies the current branch matches the ticket
2. Pushes the branch to remote
3. Creates a PR with title and description based on commits
4. Links the PR to the ticket
5. Returns the PR URL

### List Tickets

List tickets in the project board filtered by status.

**Usage:**
```bash
# List all tickets
github-projects-cli.sh list

# List tickets in specific status
github-projects-cli.sh list "In Progress"
github-projects-cli.sh list "AI Testing"
```

## GraphQL API

This skill uses GitHub's GraphQL API with the `sub_issues` feature flag for sub-issue management.

**Headers required:**
```
-H "GraphQL-Features: sub_issues"
```

**Key mutations:**
- `addSubIssue` - Link a sub-issue to a parent
- `updateProjectV2ItemFieldValue` - Update ticket status

**Key queries:**
- `projectV2` - Get project board data
- `issue` - Get issue details and node ID

## Integration with Workflow Skill

The workflow skill (`sf-workflow`) delegates to this tool skill when the project uses GitHub Projects:

```bash
# workflow-cli.sh reads .saasfoundry.json
TOOL=$(jq -r '.workflow.tool' .saasfoundry.json)

# If tool is "github-projects", delegate to this CLI
case "$TOOL" in
  github-projects)
    sf-tool-github-projects/github-projects-cli.sh "$@"
    ;;
esac
```

## Requirements

- **GitHub CLI** (`gh`) installed and authenticated
- **jq** for JSON parsing
- **GraphQL sub_issues** feature enabled (automatic with `gh api graphql`)
- **Project write permissions** for the authenticated user

## Error Handling

The CLI validates:
- ✅ Arguments are provided
- ✅ Parent issue exists (for create-subtask)
- ✅ Ticket number is valid
- ✅ Status name exists in project
- ✅ Current branch matches ticket (for create-pr)

All errors are displayed with clear messages and exit codes.

## Examples

### Complete workflow for a ticket

```bash
# 1. Create main ticket (manually via gh issue create or web UI)
# Ticket #42 created

# 2. Create subtasks
github-projects-cli.sh create-subtask 42 "Backend API"
github-projects-cli.sh create-subtask 42 "Frontend UI"
github-projects-cli.sh create-subtask 42 "Documentation"

# 3. Start work (create branch, update status)
git checkout -b feature/42-user-authentication
github-projects-cli.sh update-status 42 "In Progress"

# 4. Work on subtasks
github-projects-cli.sh update-status 43 "In Progress"
# ... code ...
github-projects-cli.sh update-status 43 "Done"

# 5. When all subtasks done
github-projects-cli.sh update-status 42 "AI Testing"

# 6. After testing passes
github-projects-cli.sh update-status 42 "Human Testing"

# 7. Create PR after validation
github-projects-cli.sh create-pr 42

# 8. Update to In Review
github-projects-cli.sh update-status 42 "In Review"

# 9. After merge
github-projects-cli.sh update-status 42 "Done"
```

## Troubleshooting

**Issue: "gh: command not found"**
- Install GitHub CLI: `brew install gh` (macOS) or follow [gh docs](https://cli.github.com/)

**Issue: "Could not find parent issue"**
- Verify the parent issue number exists: `gh issue view <number>`
- Check you're in the correct repository

**Issue: "Failed to update status"**
- Verify the status name matches exactly (case-sensitive)
- Check you have write permissions to the project board
- Run `gh project list` to see available projects

**Issue: "GraphQL mutation failed"**
- Ensure you're authenticated: `gh auth status`
- Verify the project URL in `.saasfoundry.json` is correct
- Check the project board has the status field configured
