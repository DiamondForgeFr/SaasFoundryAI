# sf skill

Manage the lifecycle of the `tool-saasfoundry` Claude Code skill — install, update, or uninstall at user or project scope.

## Usage

```bash
sf skill <subcommand> [options]
```

## Options

| Flag | Description | Default |
|------|-------------|----------|
| `install` | Install the skill (user scope by default) | - |
| `update` | Re-copy the skill if the bundled version is newer than the installed one | - |
| `uninstall` | Remove the skill from the chosen scope | - |
| `--project` | Operate on `.claude/skills/tool-saasfoundry/` (commit to git) instead of `~/.claude/skills/` | - |
| `--force` | Overwrite an existing installation without prompting | - |
| `--yes, -y` | Skip confirmation prompts (useful for CI) | - |
| `--purge` | When uninstalling, also delete preferences in `~/.saasfoundry/` | - |

## Examples

```bash
# Install the skill at user scope
sf skill install
```

```bash
# Install at project scope (team-shared, commit to git)
sf skill install --project
```

```bash
# Refresh the installed skill to the current CLI version
sf skill update
```

```bash
# Remove skill + preferences
sf skill uninstall --purge
```

## Notes

For a full wipe (both scopes + `~/.saasfoundry/`), use `sf uninstall --all` — the top-level convenience command.

## See Also

- [CLI Commands](/cli/sf-new)
- [Getting Started](/getting-started/quick-start)
