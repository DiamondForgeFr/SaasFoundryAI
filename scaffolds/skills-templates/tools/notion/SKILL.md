# Notion Tool

Integration with Notion for page management, database updates, and workflow automation.

## Auto-trigger keywords
notion page, create notion task, update notion property, notion database, notion workspace

## Configuration

This skill reads configuration from:
1. **Project config**: `.saasfoundry.json` at the project root
2. **Credentials**: `~/.claude/credentials/notion/{account}.env`

### Project Configuration

```bash
# Project URL (Notion database URL)
jq -r '.workflow.projectUrl' .saasfoundry.json

# Working branch
jq -r '.workflow.workingBranch' .saasfoundry.json

# Notion account to use
jq -r '.skillsAccounts.notion' .saasfoundry.json
```

### Credentials Format

Located at `~/.claude/credentials/notion/{account}.env`:

```bash
NOTION_API_TOKEN="secret_your_integration_token"
NOTION_DATABASE_ID="abc123..."
```

**To add credentials:**
```bash
sf tools add notion <account-name>
```

## Available Commands

### Create Page

Create a new page in a Notion database.

**Usage:**
```bash
.claude/skills/sf-tool-notion/notion-cli.sh create-page <title> [properties-json]
```

**Examples:**
```bash
# Simple page
notion-cli.sh create-page "Add validation logic"

# With properties
notion-cli.sh create-page "Add validation" '{"Status": {"status": {"name": "In Progress"}}}'
```

**What it does:**
1. Creates a page in the configured database
2. Sets title and optional properties
3. Returns the page ID and URL

### Update Property

Update a property of a Notion page.

**Usage:**
```bash
notion-cli.sh update-property <page-id> <property-name> <value>
```

**Examples:**
```bash
# Update status
notion-cli.sh update-property abc123 "Status" "Done"

# Update assignee
notion-cli.sh update-property abc123 "Assignee" "John Doe"
```

### Link Page

Link a page to another page (create relation).

**Usage:**
```bash
notion-cli.sh link-page <parent-id> <child-id>
```

**Example:**
```bash
notion-cli.sh link-page abc123 def456
```

### Get Page Status

Get the current status and properties of a page.

**Usage:**
```bash
notion-cli.sh status <page-id>
```

**Returns:** Page title, status, and other properties.

### List Pages

List pages in the database filtered by property values.

**Usage:**
```bash
# List all pages
notion-cli.sh list

# List pages with specific status
notion-cli.sh list "In Progress"
```

## Notion API

This skill uses Notion's API v1.

**Authentication:**
- Bearer token (integration token)
- Create integration at: https://www.notion.so/my-integrations

**Key endpoints:**
- `POST /v1/pages` - Create page
- `GET /v1/pages/{page_id}` - Get page
- `PATCH /v1/pages/{page_id}` - Update page properties
- `POST /v1/databases/{database_id}/query` - Query database

## Integration with Workflow Skill

The workflow skill (`sf-workflow`) delegates to this tool skill when the project uses Notion:

```bash
# workflow-cli.sh reads .saasfoundry.json
TOOL=$(jq -r '.workflow.tool' .saasfoundry.json)

# If tool is "notion", delegate to this CLI
case "$TOOL" in
  notion)
    sf-tool-notion/notion-cli.sh "$@"
    ;;
esac
```

## Requirements

- **jq** for JSON parsing
- **curl** for API requests
- **Notion credentials** configured via `sf tools add notion`
- **Database must be shared** with your Notion integration

## Multi-Account Support

You can configure multiple Notion workspaces:

```bash
# Add accounts
sf tools add notion personal
sf tools add notion work

# Use specific account in project
sf tools use notion work

# Check current account
sf tools current notion
```

The CLI automatically loads credentials from the account specified in `.saasfoundry.json`.

## Error Handling

The CLI validates:
- ✅ Credentials are configured
- ✅ Database ID is valid
- ✅ Page ID exists
- ✅ Properties match database schema
- ✅ API responses are successful

All errors are displayed with clear messages and exit codes.

## Examples

### Complete workflow for a task

```bash
# 1. Create main task
notion-cli.sh create-page "User Authentication Feature"
# Returns: abc123

# 2. Create subtasks (as linked pages)
notion-cli.sh create-page "Backend API" '{"Parent": {"relation": [{"id": "abc123"}]}}'
notion-cli.sh create-page "Frontend UI" '{"Parent": {"relation": [{"id": "abc123"}]}}'

# 3. Update status
notion-cli.sh update-property abc123 "Status" "In Progress"

# 4. Work on subtasks
notion-cli.sh update-property def456 "Status" "In Progress"
# ... code ...
notion-cli.sh update-property def456 "Status" "Done"

# 5. Mark main task done
notion-cli.sh update-property abc123 "Status" "Done"
```

## Troubleshooting

**Issue: "Credentials not found"**
- Run: `sf tools add notion <account-name>`
- Or check: `~/.claude/credentials/notion/{account}.env` exists

**Issue: "Database not found"**
- Verify database ID in credentials
- Ensure database is shared with your integration
- Check: https://www.notion.so/my-integrations

**Issue: "Property not found"**
- Property names are case-sensitive
- Check database schema in Notion
- Property types must match (status, text, relation, etc.)

**Issue: "Unauthorized"**
- Verify API token is valid
- Ensure integration has access to the database
- Re-share database with integration if needed
