# Jira Tool

Integration with Jira for ticket management, status updates, and workflow automation.

## Auto-trigger keywords
jira ticket, create jira subtask, update jira status, jira issue, jira board

## Configuration

This skill reads configuration from:
1. **Project config**: `.saasfoundry.json` at the project root
2. **Credentials**: `~/.claude/credentials/jira/{account}.env`

### Project Configuration

```bash
# Project URL
jq -r '.workflow.projectUrl' .saasfoundry.json

# Working branch
jq -r '.workflow.workingBranch' .saasfoundry.json

# Workflow statuses
jq -r '.workflow.statuses' .saasfoundry.json

# Jira account to use
jq -r '.skillsAccounts.jira' .saasfoundry.json
```

### Credentials Format

Located at `~/.claude/credentials/jira/{account}.env`:

```bash
JIRA_URL="https://your-domain.atlassian.net"
JIRA_EMAIL="your-email@company.com"
JIRA_API_TOKEN="your-api-token"
JIRA_PROJECT_KEY="PROJ"
```

**To add credentials:**
```bash
sf tools add jira <account-name>
```

## Available Commands

### Create Subtask

Create a Jira sub-task linked to a parent issue.

**Usage:**
```bash
.claude/skills/sf-tool-jira/jira-cli.sh create-subtask <parent-key> <title> [description]
```

**Examples:**
```bash
# Simple subtask
jira-cli.sh create-subtask PROJ-42 "Add validation logic"

# With description
jira-cli.sh create-subtask PROJ-42 "Write unit tests" "Cover edge cases and error handling"
```

**What it does:**
1. Creates a sub-task issue in Jira
2. Links it to the parent issue
3. Returns the subtask key (e.g., PROJ-43)

### Update Status

Update the status of a Jira ticket (perform a transition).

**Usage:**
```bash
jira-cli.sh update-status <issue-key> <status-name>
```

**Examples:**
```bash
# Move to In Progress
jira-cli.sh update-status PROJ-42 "In Progress"

# Move to Done
jira-cli.sh update-status PROJ-42 "Done"
```

**Note:** Status names must match exactly the workflow transitions in your Jira project.

### Transition

Perform a specific workflow transition.

**Usage:**
```bash
jira-cli.sh transition <issue-key> <transition-id>
```

**Example:**
```bash
# Transition to status (using transition ID)
jira-cli.sh transition PROJ-42 31
```

### Get Current Status

Get the current status of a ticket.

**Usage:**
```bash
jira-cli.sh status <issue-key>
```

**Returns:** The current status name and other issue details.

### List Tickets

List tickets in the project filtered by status or JQL.

**Usage:**
```bash
# List all tickets in project
jira-cli.sh list

# List tickets in specific status
jira-cli.sh list "In Progress"

# List using JQL
jira-cli.sh list "assignee = currentUser() AND status = 'In Progress'"
```

## Jira REST API

This skill uses Jira's REST API v3.

**Authentication:**
- Basic Auth with email + API token
- API token created at: https://id.atlassian.com/manage-profile/security/api-tokens

**Key endpoints:**
- `POST /rest/api/3/issue` - Create issue
- `GET /rest/api/3/issue/{issueKey}` - Get issue details
- `POST /rest/api/3/issue/{issueKey}/transitions` - Transition issue
- `GET /rest/api/3/search` - Search issues with JQL

## Integration with Workflow Skill

The workflow skill (`sf-workflow`) delegates to this tool skill when the project uses Jira:

```bash
# workflow-cli.sh reads .saasfoundry.json
TOOL=$(jq -r '.workflow.tool' .saasfoundry.json)

# If tool is "jira", delegate to this CLI
case "$TOOL" in
  jira)
    sf-tool-jira/jira-cli.sh "$@"
    ;;
esac
```

## Requirements

- **jq** for JSON parsing
- **curl** for API requests
- **Jira credentials** configured via `sf tools add jira`

## Multi-Account Support

You can configure multiple Jira accounts:

```bash
# Add accounts
sf tools add jira work
sf tools add jira personal

# Use specific account in project
sf tools use jira work

# Check current account
sf tools current jira
```

The CLI automatically loads credentials from the account specified in `.saasfoundry.json`.

## Error Handling

The CLI validates:
- ✅ Credentials are configured
- ✅ Issue key is valid
- ✅ Parent issue exists (for create-subtask)
- ✅ Status/transition is valid
- ✅ API responses are successful

All errors are displayed with clear messages and exit codes.

## Examples

### Complete workflow for a ticket

```bash
# 1. Create main ticket (manually via Jira web UI or REST API)
# Ticket PROJ-42 created

# 2. Create subtasks
jira-cli.sh create-subtask PROJ-42 "Backend API"
jira-cli.sh create-subtask PROJ-42 "Frontend UI"
jira-cli.sh create-subtask PROJ-42 "Documentation"

# 3. Start work
jira-cli.sh update-status PROJ-42 "In Progress"

# 4. Work on subtasks
jira-cli.sh update-status PROJ-43 "In Progress"
# ... code ...
jira-cli.sh update-status PROJ-43 "Done"

# 5. When all subtasks done
jira-cli.sh update-status PROJ-42 "Code Review"

# 6. After review
jira-cli.sh update-status PROJ-42 "Done"
```

## Troubleshooting

**Issue: "Credentials not found"**
- Run: `sf tools add jira <account-name>`
- Or check: `~/.claude/credentials/jira/{account}.env` exists

**Issue: "Could not find parent issue"**
- Verify the issue key exists: check Jira web UI
- Check the project key matches your configuration

**Issue: "Transition not found"**
- Status names must match exactly (case-sensitive)
- Some transitions may require fields to be set
- Check available transitions: `jira-cli.sh transitions PROJ-42`

**Issue: "Authentication failed"**
- Verify API token is valid: https://id.atlassian.com/manage-profile/security/api-tokens
- Check email matches the Atlassian account
- Ensure JIRA_URL doesn't have trailing slash
