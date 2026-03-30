# sf workflow

Manage workflow configuration and templates for project management tools.

## Usage

```bash
sf workflow [subcommand] [args...]
```

## Options

| Flag                          | Description                                    | Default |
| ----------------------------- | ---------------------------------------------- | ------- |
| `show`                        | Show current workflow configuration            | -       |
| `use <template>`              | Apply a workflow template                      | -       |
| `set-working-branch <branch>` | Set the working branch for git workflow        | -       |
| `set-ai-rules`                | Configure AI development rules                 | -       |
| `validate`                    | Validate workflow against remote project board | -       |
| `save <template>`             | Save current config as template                | -       |
| `list`                        | List available workflow templates              | -       |
| `create <template>`           | Create a new workflow template                 | -       |
| `delete <template>`           | Delete a workflow template                     | -       |
| `show-template <template>`    | Show a specific template                       | -       |

## Examples

### Basic configuration

```bash
# Show current workflow config
sf workflow show
```

```bash
# Use an existing template
sf workflow use my-template
```

```bash
# Set working branch
sf workflow set-working-branch develop
```

```bash
# Configure AI rules
sf workflow set-ai-rules
```

```bash
# List available templates
sf workflow list
```

```bash
# Save current config as template
sf workflow save my-template
```

### Validation

```bash
# Validate workflow against remote project board
sf workflow validate
```

The `validate` command:

- ✅ Checks project accessibility
- ✅ Verifies status field configuration
- ✅ Compares local vs remote status names
- ✅ Validates credentials (for Jira, Notion, Linear)
- ✅ Detects configuration drift

For more advanced validation options, use the workflow validator skill directly:

```bash
# Run from project root
~/.claude/skills-optional/sf-tool-workflow-validator/validate-workflow.sh --help
```

Available options:

- `--verbose` - Show detailed validation output
- `--fix` - Auto-fix configuration mismatches
- `--dry-run` - Preview fixes without applying
- `--tool <tool>` - Validate specific tool only

## Smart Tool Detection

During initial project setup (`sf new`), SaaSFoundry automatically detects available project management tools by:

1. **Scanning credentials**: Checks `~/.claude/credentials/` for Jira, Notion, and Linear credentials
2. **Checking GitHub CLI**: Runs `gh auth status` to detect GitHub Projects availability
3. **Recommending tools**: Highlights available tools in the selection prompt

**Auto-detected tools appear with a ✓ icon** in the tool selection menu.

### GitHub Projects Auto-Creation

When you select GitHub Projects and are authenticated with `gh` CLI, SaaSFoundry offers to create a new project automatically:

```bash
sf new
# ... other prompts ...
? Choose your project management tool: ✓ GitHub Projects (built-in, authenticated)
? Create a new GitHub Project automatically? Yes
? Project name: Development Board
🔨 Creating GitHub Project "Development Board"...
✅ Project created: https://github.com/orgs/myorg/projects/1
```

The auto-creation:

- ✅ Detects if you're in an organization or personal repository
- ✅ Uses GitHub GraphQL API (`createProjectV2` mutation)
- ✅ Returns the project URL automatically
- ✅ Falls back to manual URL entry if creation fails

To enable auto-creation, authenticate GitHub CLI first:

```bash
gh auth login
```

## Workflow Validation

The `validate` command validates your local workflow configuration against the actual state of your remote project board.

### What it checks

#### GitHub Projects

- Project URL accessibility
- Status field existence and values
- Repository connection
- Project visibility

#### Jira

- Project key validity
- Status workflow states
- Required fields configuration
- API credentials

#### Notion

- Database existence
- Status property configuration
- Required properties (Title, Status, Assignee)
- Database sharing permissions

#### Linear

- Team key validity
- Workflow states
- Required fields
- API token validity

### When to validate

- ✅ After changing workflow settings
- ✅ When project board statuses have been renamed
- ✅ After team members modify the remote project structure
- ✅ Before deploying to ensure workflow sync
- ✅ When debugging workflow automation issues

### Auto-fix mode

If validation detects mismatches, you can auto-fix them:

```bash
~/.claude/skills-optional/sf-tool-workflow-validator/validate-workflow.sh --fix
```

This will:

- Create a backup of `.saasfoundry-workflow.json`
- Update status names to match the remote project
- Set `validated: true` and update `lastValidated` timestamp
- Preserve all other configuration

## See Also

- [CLI Commands](/cli/sf-new)
- [Workflow System Guide](/guide/workflow-system)
- [Getting Started](/getting-started/quick-start)
