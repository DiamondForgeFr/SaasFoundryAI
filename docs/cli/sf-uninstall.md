# sf uninstall

Fully remove SaaSFoundry artefacts from the machine — the skill at both scopes plus `~/.saasfoundry/` preferences. Requires `--all`.

## Usage

```bash
sf uninstall --all [--yes]
```

## Options

| Flag | Description | Default |
|------|-------------|----------|
| `--all` | Required: remove skill (user + project scope) and wipe `~/.saasfoundry/` | - |
| `--yes, -y` | Skip the confirmation prompt | - |

## Examples

```bash
# Fully uninstall SaaSFoundry artefacts
sf uninstall --all
```

```bash
# CI-mode (no prompt)
sf uninstall --all --yes
```

## Notes

For per-scope removal, use `sf skill uninstall` instead. `sf uninstall` leaves the npm package itself installed — remove it with `npm uninstall -g saasfoundry-cli`.

## See Also

- [CLI Commands](/cli/sf-new)
- [Getting Started](/getting-started/quick-start)
