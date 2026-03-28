# sf workflow

Manage workflow configuration and templates for project management tools.

## Usage

```bash
sf workflow [subcommand] [args...]
```

## Options

| Flag                          | Description                             | Default |
| ----------------------------- | --------------------------------------- | ------- |
| `show`                        | Show current workflow configuration     | -       |
| `use <template>`              | Apply a workflow template               | -       |
| `set-working-branch <branch>` | Set the working branch for git workflow | -       |
| `set-ai-rules`                | Configure AI development rules          | -       |
| `validate`                    | Validate workflow configuration         | -       |
| `save <template>`             | Save current config as template         | -       |
| `list`                        | List available workflow templates       | -       |
| `create <template>`           | Create a new workflow template          | -       |
| `delete <template>`           | Delete a workflow template              | -       |
| `show-template <template>`    | Show a specific template                | -       |

## Examples

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

## See Also

- [CLI Commands](/cli/sf-new)
- [Getting Started](/getting-started/quick-start)
