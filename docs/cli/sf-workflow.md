# sf workflow

Manage complexity-adaptive workflow configuration and coding-agent rules. Team and Solo are the end-to-end guarded v1 presets; Custom templates are an advanced configuration surface.

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

## Notes

The workflow system is complexity-adaptive: each ticket is tagged `bug | low | medium | complex`, which scales the ceremony (analyze depth, plan approval gates, adversarial review). See
[Workflow System](/workflow/introduction) for the full lifecycle.

Team separates functional feature testing (`Human testing`) from code review (`In review`). Solo removes the separate Human testing status. Custom templates store an ordered status list, but v1 does
not generate complete status documents or arbitrary transition guards for new names. Extend the installed skill before using one as a delivery contract.

`sf workflow validate` checks local manifest fields in v1; it does not compare the configured remote board.

## See Also

- [CLI Commands](/cli/sf-new)
- [Getting Started](/getting-started/quick-start)
