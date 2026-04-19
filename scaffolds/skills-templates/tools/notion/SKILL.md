# Notion Tool

Direct REST-API integration with Notion for pages, databases, comments, and users. Drives SRS specifications, note ingestion, and general Notion workspace automation.

## Auto-trigger keywords

notion, notion.so, notion.site, @notion, notion page, notion database, notion workspace, notion comments, notes database, srs page, functional requirement page

## Configuration

This skill reads configuration from:

1. **Project config**: `.saasfoundry.json` at the project root (`.skillsAccounts.notion`, `.tools.srs.backend`)
2. **Credentials**: `~/.claude/credentials/notion/{account}.env`
3. **Fallback**: `.env` inside the skill folder (dev-only)

### Project Configuration

```bash
# Notion account to use (set during `sf tools add notion <account>`)
jq -r '.skillsAccounts.notion' .saasfoundry.json

# SRS backend (if "notion", this skill is the SRS adapter's tool skill)
jq -r '.tools.srs.backend' .saasfoundry.json
```

### Credentials Format

Located at `~/.claude/credentials/notion/{account}.env`:

```bash
NOTION_API_TOKEN="secret_your_integration_token"
NOTION_API_VERSION="2022-06-28"
```

**To add credentials:**

```bash
sf tools add notion <account-name>
```

## Commands

All via `.claude/skills/sf-tool-notion/notion-cli.sh <cmd> [args]`.

### Pages & Blocks

| Command                                              | Purpose                                            |
| ---------------------------------------------------- | -------------------------------------------------- |
| `search "<QUERY>"`                                   | Search pages and databases the integration sees    |
| `page <PAGE_ID>`                                     | Get page properties (raw JSON)                     |
| `page-content <PAGE_ID>`                             | Get page block children (content) — used for notes ingestion |
| `create-page <PARENT_ID> "<TITLE>" ["<CONTENT_MD>"]` | Create a page under a parent (page or database)    |
| `update-page <PAGE_ID> '<PROPERTIES_JSON>'`          | Update page properties                             |
| `archive-page <PAGE_ID>`                             | Archive (soft-delete) a page                       |

### Databases

| Command                                                 | Purpose                                                 |
| ------------------------------------------------------- | ------------------------------------------------------- |
| `database <DB_ID>`                                      | Get database schema                                     |
| `query-database <DB_ID> ['<FILTER_JSON>']`              | Query a database (optional Notion filter JSON)          |
| `create-database <PARENT_ID> "<TITLE>" '<SCHEMA_JSON>'` | Create a database                                       |

### Comments & Users

| Command                            | Purpose                                    |
| ---------------------------------- | ------------------------------------------ |
| `comments <PAGE_ID>`               | Get comments on a page                     |
| `add-comment <PAGE_ID> "<TEXT>"`   | Add a comment to a page                    |
| `users`                            | List all users visible to the integration  |
| `me`                               | Get bot user info (used for token check)   |

## URL parsing

All `<PAGE_ID>` / `<DB_ID>` arguments accept either a raw ID or a full Notion URL:

```bash
notion-cli.sh page "https://www.notion.so/workspace/My-Page-abc123def456..."
```

The CLI extracts the 32-char hex ID and formats it as UUID automatically. Works for both `notion.so` and `notion.site` URLs.

## Integration with SRS

The agnostic `sf-srs` skill delegates every Notion-backed SRS operation to this CLI (or to the `NotionSrsAdapter` in `src/tools/notion/srs.adapter.ts` when the operation is driven from TypeScript).

Page creation shape used by SRS:

- **Project root page** → parent is a user-owned workspace page
- **Epic page** → parent is the project root, title = Epic title
- **FR page** → parent is the Epic page, title = `FR-<n> — <title>`

The adapter uses the same Notion API surface exposed here, so anything you test with `notion-cli.sh` behaves identically when driven from the TypeScript builder.

## Important: page sharing

Notion internal integrations only see pages explicitly shared with them.

1. Open the root page in Notion
2. Click "..." menu → "Connections"
3. Add your integration (e.g. `saasfoundry-srs`)
4. Children pages inherit access automatically

If `notion-cli.sh me` succeeds but `page <PAGE_ID>` returns `object_not_found`, the page isn't shared with the integration.

## Requirements

- `curl` for API requests
- `python3` for JSON assembly (already required by the workflow skill)
- `jq` for reading `.saasfoundry.json`
- Notion credentials via `sf tools add notion <account>` (or a local `.env` fallback)
- Each target page must be shared with the integration

## Multi-Account Support

You can configure multiple Notion workspaces:

```bash
sf tools add notion personal
sf tools add notion work

sf tools use notion work        # per-project switch
sf tools current notion         # show the active account
```

The CLI loads credentials from the account listed in `.saasfoundry.json → skillsAccounts.notion`.

## Error Handling

The CLI validates:

- Credentials exist (either centralized or local `.env`)
- API token is accepted (via `me`)
- Page / database IDs exist and are shared with the integration
- Notion responses are JSON-decodable

Errors are printed to stderr with a non-zero exit code. Use `me` as a quick connectivity smoke test.

## Examples

### Ingest an existing notes page into SRS

```bash
CLI=.claude/skills/sf-tool-notion/notion-cli.sh

# 1. Find the page
$CLI search "Authentication spec"

# 2. Read its content (blocks + properties)
$CLI page-content <page-id>

# 3. Archive when done
$CLI archive-page <page-id>
```

### Create a new SRS Epic page

```bash
CLI=.claude/skills/sf-tool-notion/notion-cli.sh

# 1. Create the Epic under the project root
$CLI create-page <root-page-id> "User authentication"

# 2. Add a comment for traceability
$CLI add-comment <epic-id> "Generated from ticket #57"
```

## Troubleshooting

**`object_not_found`** — The page/DB isn't shared with the integration. Share the root page from Notion UI and retry.

**`unauthorized`** — Token invalid or revoked. Run `sf tools add notion <account>` to refresh.

**`invalid_json`** — Filter/properties/schema JSON malformed. Validate with `jq .` before passing.

**`rate_limited`** — Notion enforces ~3 req/s per integration; retry with backoff if automating bulk operations.
