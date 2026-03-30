# Workflow System

SaaSFoundry includes a powerful workflow system that integrates with GitHub Projects, Jira, Notion, and Linear.

## Overview

The workflow system provides:

- 🔧 **Template management** - Save and reuse workflow configurations
- 🤖 **AI rules** - Configure how Claude assists with development
- 📋 **Tool integration** - Connect to your project management tool
- 🌿 **Git automation** - Automatic branch naming and commit formats
- 🔍 **Smart detection** - Auto-detect available tools based on credentials
- ✅ **Validation** - Verify workflow sync with remote project boards

## Smart Tool Detection

During `sf new`, SaaSFoundry automatically detects which project management tools you have configured:

### How it works

1. **Scans credentials**: Checks `~/.claude/credentials/` for Jira, Notion, and Linear credentials
2. **Checks GitHub CLI**: Runs `gh auth status` to detect GitHub Projects availability
3. **Recommends tools**: Highlights available tools in the selection prompt with a ✓ icon

### Benefits

- ✅ **No manual searching** - See at a glance which tools are ready to use
- ✅ **Prevents errors** - Won't offer tools that aren't configured
- ✅ **Smart defaults** - Recommends GitHub Projects if available (no extra setup)
- ✅ **Fast setup** - Jump straight to using your preferred tool

### Example output

```bash
$ sf new

🔍 Detecting available project management tools...

✅ Found credentials for:
  - github-projects (recommended)
  - jira
  - notion

? Choose your project management tool:
  ✓ GitHub Projects (built-in, authenticated) ← recommended
  ✓ Jira (Atlassian, credentials found)
  ✓ Notion (credentials found)
  Linear
  None (no project management integration)
```

### Setup credentials

To make tools available for detection:

```bash
# GitHub Projects (recommended)
gh auth login

# Jira
sf tools add jira my-account

# Notion
sf tools add notion my-account

# Linear
sf tools add linear my-account
```

## Quick Start

### During Project Creation

```bash
sf new
# Answer prompts about workflow tool and preferences
```

### For Existing Projects

```bash
sf workflow
# Configure workflow for current project
```

## Workflow Templates

Templates let you save and reuse workflow configurations across projects.

### Create a Template

```bash
sf workflow create my-template
# Configure: tool, branches, statuses, AI rules
# Template saved to ~/.claude/workflows/
```

### Use a Template

```bash
sf workflow use my-template
# Applies template to current project
```

### List Templates

```bash
sf workflow list
# Shows all available templates
```

## Configuration

Workflow configuration is stored in `.saasfoundry.json`:

```json
{
  "workflow": {
    "tool": "github-projects",
    "projectUrl": "https://github.com/orgs/MyOrg/projects/1",
    "workingBranch": "develop",
    "prTargetBranch": "master",
    "requireCodeReview": true,
    "statuses": {
      "backlog": "Backlog",
      "ready": "Ready",
      "inProgress": "In Progress",
      "inReview": "In Review",
      "done": "Done"
    }
  },
  "aiRules": {
    "alwaysCreateBranchFromWorking": true,
    "alwaysCreateTicketBeforeCode": true,
    "autoUpdateTicketStatus": true,
    "requireHumanCheckOnPushedBranch": true
  }
}
```

## AI Rules

Configure how Claude assists with development:

| Rule                              | Description                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| `alwaysCreateBranchFromWorking`   | Always branch from working branch (e.g., `develop`)                                |
| `alwaysCreateTicketBeforeCode`    | Create issue before starting work                                                  |
| `autoUpdateTicketStatus`          | Update issue status based on git operations                                        |
| `requireHumanCheckOnPushedBranch` | Wait for human validation before creating PR (workflow: commit → push → test → PR) |

**Note**: Tests and lint checks are **always** enforced by Husky pre-commit hooks, regardless of AI rules.

### Configure AI Rules

```bash
sf workflow set-ai-rules
# Interactive prompts for each rule
```

## Supported Tools

### GitHub Projects

- ✅ GraphQL API integration
- ✅ Sub-issues support
- ✅ Automatic status updates
- ✅ PR linking
- ✅ **Auto-creation** - Create new projects automatically

#### Auto-Creation Feature

When you select GitHub Projects during `sf new` and are authenticated with `gh` CLI, SaaSFoundry offers to create a new project automatically:

```bash
$ sf new

? Choose your project management tool: ✓ GitHub Projects (built-in, authenticated)
? Create a new GitHub Project automatically? Yes
? Project name: Development Board

🔨 Creating GitHub Project "Development Board"...
✅ Project created: https://github.com/orgs/myorg/projects/1
```

**How it works:**

1. Detects if you're in an organization or personal repository
2. Uses GitHub GraphQL API (`createProjectV2` mutation)
3. Returns the project URL automatically
4. Falls back to manual URL entry if creation fails

**Requirements:**

- `gh` CLI must be authenticated: `gh auth login`
- You must have permission to create projects in the repository/org

**When to use:**

- ✅ Starting a new project from scratch
- ✅ Testing SaaSFoundry quickly
- ✅ Creating isolated project boards per repository

**When to use manual URL:**

- ✅ Using an existing project board
- ✅ Sharing a project board across multiple repositories
- ✅ When you don't have project creation permissions

### Jira

- ✅ REST API integration
- ✅ Native sub-tasks
- ✅ Sprint management
- ✅ Custom fields

### Notion

- ✅ Database integration
- ✅ Linked pages
- ✅ Custom properties
- ✅ Rich content

### Linear

- ✅ GraphQL API
- ✅ Sub-issues
- ✅ Cycles
- ✅ Labels

## Validation System

SaaSFoundry includes a workflow validator that ensures your local configuration stays in sync with your remote project board.

### Why validation matters

Over time, your workflow configuration can drift from the actual project board:

- 🔄 **Team renames statuses** - "In Review" becomes "Review"
- 📊 **Board structure changes** - New statuses added, old ones removed
- 🔧 **Configuration errors** - Typos or incorrect field mappings
- 🚀 **Deployment issues** - Automation breaks due to config mismatch

The validator detects these issues and offers automatic fixes.

### What it validates

#### GitHub Projects

- ✅ Project URL accessibility
- ✅ Status field existence and values
- ✅ Repository connection
- ✅ Project visibility

#### Jira

- ✅ Project key validity
- ✅ Status workflow states
- ✅ Required fields configuration
- ✅ API credentials

#### Notion

- ✅ Database existence
- ✅ Status property configuration
- ✅ Required properties (Title, Status, Assignee)
- ✅ Database sharing permissions

#### Linear

- ✅ Team key validity
- ✅ Workflow states
- ✅ Required fields
- ✅ API token validity

### How to validate

```bash
# Basic validation
sf workflow validate

# Advanced options (use skill directly)
~/.claude/skills-optional/sf-tool-workflow-validator/validate-workflow.sh --verbose
~/.claude/skills-optional/sf-tool-workflow-validator/validate-workflow.sh --fix
```

### Example validation output

```bash
$ sf workflow validate

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

When mismatches are detected, you can auto-fix them:

```bash
~/.claude/skills-optional/sf-tool-workflow-validator/validate-workflow.sh --fix

🔧 Auto-fixing workflow configuration...

Updating statuses in .saasfoundry-workflow.json:
  - Ready → Todo
  - In Review → Review
  - Done → Complete

✅ Configuration updated and saved
✅ Validation passed
```

**Auto-fix benefits:**

- ✅ **Non-destructive** - Creates `.saasfoundry-workflow.json.backup` before changes
- ✅ **Smart updates** - Only updates what's different
- ✅ **Preserves settings** - Keeps all other configuration intact
- ✅ **Audit trail** - Sets `validated: true` and `lastValidated` timestamp

### When to validate

- ✅ **After initial setup** - Verify everything is configured correctly
- ✅ **Weekly** - As part of team standup or sprint planning
- ✅ **Before deployments** - Ensure automation will work
- ✅ **After team changes** - When someone renames statuses or fields
- ✅ **When debugging** - If workflow automation stops working

### Validation fields

After successful validation, your manifest includes:

```json
{
  "workflow": {
    // ... other fields ...
    "validated": true,
    "lastValidated": "2026-03-30T14:30:00Z"
  }
}
```

These fields help track workflow health over time.

## Git Workflow

The workflow system enforces consistent git practices:

### Branch Configuration

Configure which branches to use for development and PRs:

```json
{
  "workingBranch": "develop", // Branch to rebase from + PR target (default)
  "prTargetBranch": "master" // Optional: Override PR target if different
}
```

**Key points:**

- `workingBranch`: The branch you work from (rebase + create feature branches)
- `prTargetBranch`: Where PRs are merged (defaults to `workingBranch` if not specified)
- In 95% of cases, both are the same (e.g., `develop`)
- Override `prTargetBranch` only for special workflows (e.g., PR to `master` from `develop`)

**Example workflows:**

```bash
# Standard workflow (most common)
workingBranch: "develop"
prTargetBranch: "develop"  # or omit (same as workingBranch)

# Direct to production
workingBranch: "develop"
prTargetBranch: "master"   # PRs go directly to production
```

### Branch Naming

Configured in `workflow.branchNaming`:

```json
{
  "feature": "feature/{issue-number}-{description}",
  "fix": "fix/{issue-number}-{description}",
  "release": "rc-{version}"
}
```

Example: `feature/42-user-authentication`

### Commit Format

Configured in `workflow.commitFormat`:

```json
{
  "pattern": "{type}(#{number}): {description}",
  "requireTicket": true,
  "types": ["feat", "fix", "docs", "style", "refactor", "test", "chore"]
}
```

Example: `feat(#42): add JWT authentication`

## Commands

### Project-Level Commands

```bash
sf workflow show              # Show current config
sf workflow use <template>    # Apply template
sf workflow set-working-branch <branch>  # Set working branch
sf workflow set-ai-rules      # Configure AI rules
sf workflow validate          # Validate config
sf workflow save <name>       # Save as template
```

### Global Template Commands

```bash
sf workflow list              # List templates
sf workflow create <name>     # Create template
sf workflow delete <name>     # Delete template
sf workflow show-template <name>  # Show template
```

## Best Practices

1. **Use templates** - Create templates for common workflows
2. **Enable AI rules** - Let Claude enforce workflow automatically
3. **Consistent naming** - Use configured branch and commit formats
4. **Status updates** - Keep issues in sync with development progress

## Next Steps

- Run `sf workflow --help` to see all available commands
- Use `sf workflow create <name>` to create workflow templates
- Configure AI rules with `sf workflow set-ai-rules`
