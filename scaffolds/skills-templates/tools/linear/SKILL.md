# Linear Tool

Integration with Linear for issue management, status updates, and workflow automation.

## Auto-trigger keywords
linear issue, create linear subtask, update linear status, linear project, linear cycle

## Configuration

This skill reads configuration from:
1. **Project config**: `.saasfoundry.json` at the project root
2. **Credentials**: `~/.claude/credentials/linear/{account}.env`

### Project Configuration

```bash
# Project URL
jq -r '.workflow.projectUrl' .saasfoundry.json

# Working branch
jq -r '.workflow.workingBranch' .saasfoundry.json

# Linear account to use
jq -r '.skillsAccounts.linear' .saasfoundry.json
```

### Credentials Format

Located at `~/.claude/credentials/linear/{account}.env`:

```bash
LINEAR_API_TOKEN="lin_api_your_token"
LINEAR_TEAM_ID="abc-123-def"
```

**To add credentials:**
```bash
sf tools add linear <account-name>
```

## Available Commands

### Create Issue

Create a new issue in Linear.

**Usage:**
```bash
.claude/skills/sf-tool-linear/linear-cli.sh create-issue <title> [description]
```

**Examples:**
```bash
# Simple issue
linear-cli.sh create-issue "Add validation logic"

# With description
linear-cli.sh create-issue "Add validation" "Implement validation for user input"
```

**What it does:**
1. Creates an issue in the configured team
2. Returns the issue ID and URL

### Create Sub-Issue

Create a sub-issue linked to a parent issue.

**Usage:**
```bash
linear-cli.sh create-sub-issue <parent-id> <title>
```

**Examples:**
```bash
# Create subtask
linear-cli.sh create-sub-issue ABC-123 "Backend API"
linear-cli.sh create-sub-issue ABC-123 "Frontend UI"
```

**What it does:**
1. Creates a sub-issue
2. Links it to the parent issue
3. Returns the sub-issue ID and URL

### Update Status

Update the status of an issue (change workflow state).

**Usage:**
```bash
linear-cli.sh update-status <issue-id> <status-name>
```

**Examples:**
```bash
# Move to In Progress
linear-cli.sh update-status ABC-123 "In Progress"

# Move to Done
linear-cli.sh update-status ABC-123 "Done"
```

**Note:** Status names must match exactly the workflow states in your Linear team.

### Get Current Status

Get the current status and details of an issue.

**Usage:**
```bash
linear-cli.sh status <issue-id>
```

**Returns:** Issue title, status, assignee, and other details.

### List Issues

List issues in the team filtered by status.

**Usage:**
```bash
# List all issues
linear-cli.sh list

# List issues in specific status
linear-cli.sh list "In Progress"
```

## Linear GraphQL API

This skill uses Linear's GraphQL API.

**Authentication:**
- Bearer token (Personal API key)
- Create API key at: https://linear.app/settings/api

**Key mutations:**
- `issueCreate` - Create issue
- `issueUpdate` - Update issue
- `workflowStateForTeam` - Get workflow states

**Key queries:**
- `issue` - Get issue details
- `issues` - List issues with filters
- `team` - Get team information

## Integration with Workflow Skill

The workflow skill (`sf-workflow`) delegates to this tool skill when the project uses Linear:

```bash
# workflow-cli.sh reads .saasfoundry.json
TOOL=$(jq -r '.workflow.tool' .saasfoundry.json)

# If tool is "linear", delegate to this CLI
case "$TOOL" in
  linear)
    sf-tool-linear/linear-cli.sh "$@"
    ;;
esac
```

## Requirements

- **jq** for JSON parsing
- **curl** for API requests
- **Linear credentials** configured via `sf tools add linear`

## Multi-Account Support

You can configure multiple Linear workspaces:

```bash
# Add accounts
sf tools add linear personal
sf tools add linear work

# Use specific account in project
sf tools use linear work

# Check current account
sf tools current linear
```

The CLI automatically loads credentials from the account specified in `.saasfoundry.json`.

## Error Handling

The CLI validates:
- ✅ Credentials are configured
- ✅ Team ID is valid
- ✅ Issue ID exists
- ✅ Status is valid
- ✅ API responses are successful

All errors are displayed with clear messages and exit codes.

## Examples

### Complete workflow for an issue

```bash
# 1. Create main issue
linear-cli.sh create-issue "User Authentication Feature" "Implement OAuth2"
# Returns: ABC-123

# 2. Create sub-issues
linear-cli.sh create-sub-issue ABC-123 "Backend API"
linear-cli.sh create-sub-issue ABC-123 "Frontend UI"
linear-cli.sh create-sub-issue ABC-123 "Documentation"

# 3. Start work
linear-cli.sh update-status ABC-123 "In Progress"

# 4. Work on sub-issues
linear-cli.sh update-status ABC-124 "In Progress"
# ... code ...
linear-cli.sh update-status ABC-124 "Done"

# 5. When all sub-issues done
linear-cli.sh update-status ABC-123 "In Review"

# 6. After review
linear-cli.sh update-status ABC-123 "Done"
```

## Troubleshooting

**Issue: "Credentials not found"**
- Run: `sf tools add linear <account-name>`
- Or check: `~/.claude/credentials/linear/{account}.env` exists

**Issue: "Team not found"**
- Verify team ID in credentials
- Find team ID at: https://linear.app/settings/api
- Team ID format: `abc-123-def`

**Issue: "Invalid workflow state"**
- Status names are case-sensitive
- Check available states in Linear settings
- States must match your team's workflow

**Issue: "Authentication failed"**
- Verify API token is valid
- Create new token at: https://linear.app/settings/api
- Ensure token has correct scopes (read, write)
