# sf update

Add managed capabilities or modules to an existing SaaSFoundryAI project. It can promote an eligible `harness` or `stack` project to `full`, and uses conservative planning to preserve existing files
and local edits.

## Usage

```bash
sf update [options]
```

## Options

| Flag                             | Description                                                                                                           | Default    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------- |
| `--non-interactive`              | Fail if any required value is missing instead of prompting                                                            | -          |
| `--dry-run`                      | Preview changes without writing files or running installers                                                           | -          |
| `--json`                         | With `--dry-run`, emit one versioned JSON object on stdout and diagnostics on stderr                                  | -          |
| `--target-profile <profile>`     | Add the missing managed capability to reach `full`; V1 supports `full` only                                           | -          |
| `--project-description <text>`   | Product description used when a harness project adopts the technical stack                                            | derived    |
| `--structure <structure>`        | Technical topology for harness → full: `monorepo` or `multirepo`                                                      | -          |
| `--db-setup <setup>`             | Database setup for harness → full: `docker`, `credentials`, or `manual`                                               | -          |
| `--db-type <type>`               | Database type: `postgresql` or `sql`                                                                                  | -          |
| `--db-host <host>`               | Database host when `--db-setup credentials`                                                                           | -          |
| `--db-port <port>`               | Database port when `--db-setup credentials`                                                                           | -          |
| `--db-user <user>`               | Database user when `--db-setup credentials`                                                                           | -          |
| `--db-password <password>`       | Database password when `--db-setup credentials`                                                                       | -          |
| `--db-name <name>`               | Database name when `--db-setup credentials`                                                                           | -          |
| `--api-port`, `--web-port`       | Explicit API and web host ports                                                                                       | automatic  |
| `--email-service <service>`      | `none` or `mailersend`; MailerSend uses the credential flags below                                                    | -          |
| `--analytics` / `--no-analytics` | Include or omit analytics in the new technical stack                                                                  | -          |
| `--pwa` / `--no-pwa`             | Include or omit installable-app support                                                                               | -          |
| `--accept-template-updates`      | Auto-apply non-conflicting template updates without prompting                                                         | -          |
| `--conflict-strategy <strategy>` | Three-way merge conflict handling: `keep` (yours), `replace` (theirs), or `save-new`                                  | `save-new` |
| `--add-modules <modules>`        | Comma-separated modules; includes `harness` as the compatibility spelling for stack → full                            | -          |
| `--mailersend-api-key <key>`     | MailerSend API key (when adding `email`)                                                                              | -          |
| `--s3-setup <setup>`             | S3 storage: `docker`, `credentials`, or `manual` for a transition; module-only storage supports its applicable subset | -          |
| `--atlassian-email <email>`      | Atlassian account email (when adding `sf-skill-atlassian`)                                                            | -          |
| `--notion-api-token <token>`     | Notion API token (when adding `sf-skill-notion` or `srs` with `notion` backend)                                       | -          |
| `--figma-api-token <token>`      | Figma API token (when adding `sf-skill-figma`)                                                                        | -          |
| `--srs-backend <backend>`        | SRS backend when adding `srs`: `notion` (Confluence + local-markdown on roadmap)                                      | -          |
| `--srs-parent-page-input <url>`  | SRS root page URL (or ID) when adding `srs`                                                                           | -          |

## Examples

```bash
# Interactive: select modules from the menu
sf update
```

```bash
# Preview what would change (no writes)
sf update --dry-run --json --add-modules email,analytics
```

```bash
# Preview an additive transition to the full managed profile
sf update --target-profile full --dry-run --json

# Apply interactively after reviewing the plan
sf update --target-profile full
```

For a harness → full transition in automation, provide every required technical choice together. The project name and main branch are preserved from the manifest; repository URLs are not collected:

```bash
sf update --non-interactive \
  --target-profile full \
  --structure monorepo \
  --db-setup manual \
  --db-type postgresql \
  --email-service none \
  --s3-setup manual \
  --no-analytics \
  --pwa
```

The JSON report is versioned and always says `"mutated": false`. Technical path collisions return `"canApply": false` and list the blocking paths; every blocked profile transition provides a reason
code and executable remediation. No partial overlay is applied. Human diagnostics use stderr, so stdout remains directly parseable. A preview describes the planned modules without requiring provider
secrets or opening signup pages.

For automation, keep secrets out of shell history and generated planner commands. Supply them through the matching environment variable when the real update runs:

| Secret              | Environment variable            |
| ------------------- | ------------------------------- |
| Database password   | `SF_UPDATE_DB_PASSWORD`         |
| MailerSend API key  | `SF_UPDATE_MAILERSEND_API_KEY`  |
| S3 access key       | `SF_UPDATE_S3_ACCESS_KEY`       |
| S3 secret key       | `SF_UPDATE_S3_SECRET_KEY`       |
| Context7 API key    | `SF_UPDATE_CONTEXT7_API_KEY`    |
| Atlassian API token | `SF_UPDATE_ATLASSIAN_API_TOKEN` |
| Notion API token    | `SF_UPDATE_NOTION_API_TOKEN`    |
| Figma API token     | `SF_UPDATE_FIGMA_API_TOKEN`     |

## Profile transitions

`sf status --json --no-network` reports the independent technical-stack and managed-harness capabilities plus the resulting effective profile. `sf update --target-profile full` uses that same
classification:

| Current effective profile   | Result                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `harness`                   | Plans a monorepo or multirepo technical stack and adds it only when every candidate path is absent or byte-identical. Existing harness configuration and ownership remain unchanged. |
| `stack`                     | Adds the managed collaboration harness. `--add-modules harness` remains an equivalent compatibility command.                                                                         |
| `full`                      | Succeeds as a no-op.                                                                                                                                                                 |
| `projection`                | Stops: this is an API/web checkout of a multirepo project; run the transition from its root coordinator.                                                                             |
| `unknown` or `inconsistent` | Stops before mutation and reports how to resolve the manifest state.                                                                                                                 |

This transition only adds capabilities. It does not implement `full → stack`, `full → harness`, `harness → stack`, or monorepo↔multirepo conversion.

An arbitrary external product is not a stack-overlay target. Keep it as a harness project when its existing application remains the product. For a throwaway POC, preserve the experiment under `POC/`
and create a clean full project; do not run `sf new --profile full` inside the existing repository.

Profile-transition execution requires macOS, Linux, or WSL on Windows in V1. Native Windows is rejected before mutation because the transaction relies on filesystem durability guarantees that the
native path does not currently provide.

SaaSFoundry writers coordinate through one project lock and verify file identities before publication and recovery. A separate same-user process that deliberately renames project paths between an
identity check and the following filesystem syscall is outside this local CLI threat model; do not run unrelated tools that rewrite the project tree during a profile transition.

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

`sf update` is the mechanism for additive capability changes and for propagating upstream SaaSFoundryAI evolutions to managed projects. Re-run it after upgrading the CLI to preview newer templates,
scripts, and skill bundles.

## See Also

- [CLI Commands](/cli/sf-new)
- [Getting Started](/getting-started/quick-start)
