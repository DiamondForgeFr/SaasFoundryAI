# sf tools

Manage multi-account credentials for external services (Atlassian, Notion, Figma) used by advanced Claude Code skills.

## Usage

```bash
sf tools [subcommand] [options]
```

## Options

| Flag                   | Description                                  | Default |
| ---------------------- | -------------------------------------------- | ------- |
| `list`                 | Show all tools and their account count       | -       |
| `accounts <tool>`      | List accounts for a specific tool            | -       |
| `add <tool> <account>` | Add a new account for a tool                 | -       |
| `use <tool> <account>` | Set which account to use for current project | -       |
| `current`              | Show accounts used by current project        | -       |

## Examples

```bash
# List all available tools
sf tools list
```

```bash
# Add a new Atlassian account
sf tools add atlassian my-account
```

```bash
# Use a specific account for current project
sf tools use atlassian my-account
```

```bash
# Show current project accounts
sf tools current
```

## See Also

- [CLI Commands](/cli/sf-new)
- [Getting Started](/getting-started/quick-start)
