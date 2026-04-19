# sf feedback

File module requests, report bugs against the CLI or generated scaffolds, and vote on community-submitted proposals.

## Usage

```bash
sf feedback <subcommand> [options]
```

## Options

| Flag | Description | Default |
|------|-------------|----------|
| `request <name>` | Open a new module-request issue on the SaaSFoundry repo | - |
| `bug` | Open a bug report against the CLI or generated scaffolds | - |
| `list` | List feedback issues (module-requests + cli-bugs + scaffold-bugs) | - |
| `vote --list` | Show top module requests ranked by 👍 reactions | - |
| `vote <n> up\|down\|comment` | Cast a reaction or post a comment on request #n | - |
| `--description <text>` | Issue description (request + bug) | - |
| `--title <text>` | Bug title | - |
| `--source <cli\|scaffold>` | Which surface the bug affects (bug) | - |
| `--auto-repro` | Attach automatically captured reproduction context (bug) | - |
| `--status <open\|closed\|all>` | Filter issues by status (list) | - |
| `--mine` | Limit list to issues you opened | - |
| `--limit <n>` | Cap the number of returned results | - |
| `--stack-filter <term>` | Narrow vote --list results by stack keyword | - |
| `--comment <body>` | Comment body when voting with `comment` | - |
| `--json` | Emit machine-readable JSON output | - |
| `--force` | Skip duplicate-detection prompts when filing | - |
| `--yes, -y` | Skip interactive confirmations | - |
| `--non-interactive` | Fail instead of prompting (CI mode) | - |

## Examples

```bash
# Request a new module
sf feedback request stripe-billing --description "Stripe subscription billing with webhooks"
```

```bash
# File a CLI bug with auto-captured repro context
sf feedback bug --source cli --title "sf update crashes on Windows" --auto-repro
```

```bash
# List top-voted module requests
sf feedback vote --list --limit 10
```

```bash
# Upvote request #62
sf feedback vote 62 up
```

## Notes

Requests and bugs are deduplicated against the live GitHub issue list — the CLI surfaces similar existing issues before opening a new one. Pass `--force` to override.

## See Also

- [CLI Commands](/cli/sf-new)
- [Getting Started](/getting-started/quick-start)
