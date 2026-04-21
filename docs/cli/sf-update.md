# sf update

Add modules to an existing SaaSFoundry project. Uses a three-way merge to preserve local edits while propagating upstream template evolutions.

## Usage

```bash
sf update [options]
```

## Options

| Flag                             | Description                                                                                                                                      | Default    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `--non-interactive`              | Fail if any required value is missing instead of prompting                                                                                       | -          |
| `--dry-run`                      | Preview changes as JSON without writing files or running installers                                                                              | -          |
| `--accept-template-updates`      | Auto-apply non-conflicting template updates without prompting                                                                                    | -          |
| `--conflict-strategy <strategy>` | Three-way merge conflict handling: `keep` (yours), `replace` (theirs), or `save-new`                                                             | `save-new` |
| `--add-modules <modules>`        | Comma-separated list of modules to add: `email, storage, analytics, srs, sf-skill-context7, sf-skill-atlassian, sf-skill-notion, sf-skill-figma` | -          |
| `--mailersend-api-key <key>`     | MailerSend API key (when adding `email`)                                                                                                         | -          |
| `--s3-setup <setup>`             | S3 storage: `docker` or `credentials` (when adding `storage`)                                                                                    | -          |
| `--atlassian-email <email>`      | Atlassian account email (when adding `sf-skill-atlassian`)                                                                                       | -          |
| `--notion-api-token <token>`     | Notion API token (when adding `sf-skill-notion` or `srs` with `notion` backend)                                                                  | -          |
| `--figma-api-token <token>`      | Figma API token (when adding `sf-skill-figma`)                                                                                                   | -          |
| `--srs-backend <backend>`        | SRS backend when adding `srs`: `notion` (Confluence + local-markdown on roadmap)                                                                 | -          |
| `--srs-parent-page-input <url>`  | SRS root page URL (or ID) when adding `srs`                                                                                                      | -          |

## Examples

```bash
# Interactive: select modules from the menu
sf update
```

```bash
# Preview what would change (no writes)
sf update --dry-run --add-modules email,analytics
```

```bash
# Scripted: add email + accept upstream template updates
sf update --non-interactive \
  --add-modules email \
  --mailersend-api-key $MAILERSEND_KEY \
  --accept-template-updates
```

```bash
# Scripted: add SRS module (Notion backend)
sf update --non-interactive \
  --add-modules srs \
  --srs-backend notion \
  --srs-parent-page-input "https://www.notion.so/your-workspace/SRS-root-abc123" \
  --notion-api-token "secret_..."
```

## Notes

`sf update` is the mechanism for propagating upstream SaaSFoundry evolutions to projects you have already scaffolded — re-run it after upgrading the CLI to pull newer templates, scripts, and skill
bundles.

## See Also

- [CLI Commands](/cli/sf-new)
- [Getting Started](/getting-started/quick-start)
