# Workflow System

SaaSFoundry includes a powerful workflow system that integrates with GitHub Projects, Jira, Notion, and Linear.

## Overview

The workflow system provides:

- 🔧 **Template management** - Save and reuse workflow configurations
- 🤖 **AI rules** - Configure how Claude assists with development
- 📋 **Tool integration** - Connect to your project management tool
- 🌿 **Git automation** - Automatic branch naming and commit formats

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
    "requireTestsBeforeCommit": true,
    "requireLintBeforeCommit": true
  }
}
```

## AI Rules

Configure how Claude assists with development:

| Rule                            | Description                                         |
| ------------------------------- | --------------------------------------------------- |
| `alwaysCreateBranchFromWorking` | Always branch from working branch (e.g., `develop`) |
| `alwaysCreateTicketBeforeCode`  | Create issue before starting work                   |
| `autoUpdateTicketStatus`        | Update issue status based on git operations         |
| `requireTestsBeforeCommit`      | Run tests before allowing commits                   |
| `requireLintBeforeCommit`       | Run linter before allowing commits                  |

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

See: [GitHub Projects Integration](/workflow/github-jira-notion-linear#github-projects)

### Jira

- ✅ REST API integration
- ✅ Native sub-tasks
- ✅ Sprint management
- ✅ Custom fields

See: [Jira Integration](/workflow/github-jira-notion-linear#jira)

### Notion

- ✅ Database integration
- ✅ Linked pages
- ✅ Custom properties
- ✅ Rich content

See: [Notion Integration](/workflow/github-jira-notion-linear#notion)

### Linear

- ✅ GraphQL API
- ✅ Sub-issues
- ✅ Cycles
- ✅ Labels

See: [Linear Integration](/workflow/github-jira-notion-linear#linear)

## Git Workflow

The workflow system enforces consistent git practices:

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

- [Template Management](/workflow/templates) - Deep dive into templates
- [AI Rules Configuration](/workflow/ai-rules) - Advanced AI rules
- [Tool Integration](/workflow/github-jira-notion-linear) - Tool-specific guides
