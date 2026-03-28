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
