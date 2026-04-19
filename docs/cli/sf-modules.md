# sf modules

Browse the SaaSFoundry module catalogue, inspect module metadata, and rank modules against a natural-language intent.

## Usage

```bash
sf modules <subcommand> [options]
```

## Options

| Flag | Description | Default |
|------|-------------|----------|
| `list` | List all modules with their installed state | - |
| `info <name>` | Show detailed metadata for a single module | - |
| `match "<intent>"` | Rank modules by how well they match a natural-language description | - |
| `--json` | Emit machine-readable JSON (available on all subcommands) | - |

## Examples

```bash
# List all catalogued modules
sf modules list
```

```bash
# Inspect the email module in JSON
sf modules info email --json
```

```bash
# Find modules relevant to "send transactional emails"
sf modules match "send transactional emails"
```

## Notes

The catalogue drives anti-reinvention guardrails: the `sf-tool-saasfoundry` skill calls `sf modules match` before the AI agent considers building a new module from scratch.

## See Also

- [CLI Commands](/cli/sf-new)
- [Getting Started](/getting-started/quick-start)
