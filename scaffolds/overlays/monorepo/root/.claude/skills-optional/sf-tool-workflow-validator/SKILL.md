---
name: sf-tool-workflow-validator
description: Validate workflow configuration against remote project management tools (GitHub Projects, Jira, Notion, Linear). Detects mismatches and offers auto-fix.
allowed-tools: Bash
---

# Workflow Validator

Validate `.saasfoundry-workflow.json` configuration against the actual state of your project management tool. Detects configuration drift and offers automatic fixes.

## Auto-trigger keywords
validate workflow, check workflow, workflow sync, workflow mismatch, workflow config, verify workflow

## When to use this skill

- After changing workflow settings
- When project board statuses have been renamed
- After team members modify the remote project structure
- Before deploying to ensure workflow sync
- When debugging workflow automation issues

## What it validates

### GitHub Projects
- ✅ Project URL accessibility
- ✅ Status field existence and values
- ✅ Repository connection
- ✅ Project visibility

### Jira
- ✅ Project key validity
- ✅ Status workflow states
- ✅ Required fields configuration
- ✅ API credentials

### Notion
- ✅ Database existence
- ✅ Status property configuration
- ✅ Required properties (Title, Status, Assignee)
- ✅ Database sharing permissions

### Linear
- ✅ Team key validity
- ✅ Workflow states
- ✅ Required fields
- ✅ API token validity

## CLI

All commands use: `~/.claude/skills-optional/sf-tool-workflow-validator/validate-workflow.sh`

### Basic validation

| Task | Command |
|---|---|
| Validate current config | `validate-workflow.sh` |
| Check specific tool | `validate-workflow.sh --tool github-projects` |
| Verbose output | `validate-workflow.sh --verbose` |
| Auto-fix mismatches | `validate-workflow.sh --fix` |
| Dry-run (preview fixes) | `validate-workflow.sh --fix --dry-run` |

### Output format

```bash
$ validate-workflow.sh

🔍 Validating workflow configuration...

Tool: GitHub Projects
URL: https://github.com/orgs/myorg/projects/1

✅ Project accessible
✅ Status field found
⚠️  Status mismatch detected:
   Local:  Backlog, Ready, In Progress, In Review, Done
   Remote: Backlog, Todo, In Progress, Review, Complete

❌ Validation failed with 1 issue(s)

Run with --fix to update local config automatically.
```

### Auto-fix mode

```bash
$ validate-workflow.sh --fix

🔧 Auto-fixing workflow configuration...

Updating statuses in .saasfoundry-workflow.json:
  - Ready → Todo
  - In Review → Review
  - Done → Complete

✅ Configuration updated and saved
✅ Validation passed
```

## Validation rules

### Status field validation
The validator compares:
- **Local config**: `statuses` in `.saasfoundry-workflow.json`
- **Remote config**: Actual status values from the project board

**Auto-fix strategy**:
- If remote has all local statuses → Keep local (user may have renamed)
- If local has fewer statuses → Add missing remote statuses
- If names differ but count matches → Update to remote names
- If structure is completely different → Prompt user for decision

### Credential validation
- Checks if credentials exist in `~/.claude/credentials/{tool}/{account}.env`
- Validates API token format (not actual validity - requires API call)
- For GitHub Projects: checks `gh auth status`

### URL validation
- GitHub Projects: `/orgs/{org}/projects/{id}` or `/users/{user}/projects/{id}`
- Jira: `https://{domain}.atlassian.net/browse/{key}`
- Notion: `https://notion.so/{workspace}/{id}` or `https://notion.site/{id}`
- Linear: `linear://{team-key}` (internal format)

## Integration with skills

Other SaaSFoundry skills (`sf-git-commit`, `sf-git-create-pr`, `sf-workflow-apex`) rely on accurate workflow config. Run validation:

- **After initial setup**: `sf new` or `sf workflow use <template>`
- **Weekly**: As part of team standup
- **Before major deployments**: Ensure automation works
- **After team changes**: When status names change

## Configuration file

Reads from: `.saasfoundry-workflow.json` in project root.

Updates fields:
- `statuses.*` - Status name mappings
- `validated` - Set to `true` after successful validation
- `lastValidated` - ISO 8601 timestamp

## Gotchas

- **GitHub Projects**: Requires `gh` CLI authenticated and repository access
- **Jira**: Requires credentials in `~/.claude/credentials/jira/{account}.env`
- **Notion**: Database must be shared with the integration
- **Linear**: API token must have read access to team workflow states
- **Auto-fix is non-destructive**: Always creates a backup at `.saasfoundry-workflow.json.backup`
- **Credentials are never logged**: The script uses secure credential loading

## Error messages

| Error | Meaning | Fix |
|---|---|---|
| `Project not found` | URL is incorrect or project deleted | Update `projectUrl` in config |
| `Status field missing` | Remote project has no Status field | Add Status field to project |
| `Credentials not found` | No credentials configured | Run `sf tools add {tool} {account}` |
| `Unauthorized` | Invalid API token | Re-add credentials with valid token |
| `Database not shared` | Notion database not shared with integration | Share database with integration |

## Example workflow

```bash
# 1. Initial setup
sf new
# ... configure workflow ...

# 2. Validate after setup
~/.claude/skills-optional/sf-tool-workflow-validator/validate-workflow.sh
# ✅ All checks passed

# 3. Later: Team renames "In Review" → "Review" in GitHub Project
~/.claude/skills-optional/sf-tool-workflow-validator/validate-workflow.sh
# ⚠️  Status mismatch detected

# 4. Auto-fix
~/.claude/skills-optional/sf-tool-workflow-validator/validate-workflow.sh --fix
# ✅ Configuration updated

# 5. Verify
~/.claude/skills-optional/sf-tool-workflow-validator/validate-workflow.sh
# ✅ All checks passed
```

## Security notes

- Credentials are loaded from `~/.claude/credentials/` (never from project files)
- API calls use secure HTTPS
- Tokens are never logged or displayed
- Backup files (`.json.backup`) excluded from git via `.gitignore`
