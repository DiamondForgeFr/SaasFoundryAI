---
name: tool-notion
description: Interact with Notion pages, databases, views, and comments. Auto-triggers on notion.so or notion.site URLs, mentions of Notion, notes database, or Notion workspace.
allowed-tools: Bash
---

# Notion — CLI mode

Access Notion pages, databases, and comments via direct REST API calls. **No MCP needed.**

## Auto-trigger keywords
Notion, notion.so, notion.site, notes database, Notion page, Notion workspace

## CLI

All commands use: `~/.claude/skills/tool-notion/notion-cli.sh`

### Pages & Blocks

| Task | Command |
|---|---|
| Search | `notion-cli.sh search "query"` |
| Get page properties | `notion-cli.sh page <PAGE_ID>` |
| Get page content | `notion-cli.sh page-content <PAGE_ID>` |
| Create page | `notion-cli.sh create-page <PARENT_ID> "Title" "Content"` |
| Update page | `notion-cli.sh update-page <PAGE_ID> '<PROPS_JSON>'` |
| Archive page | `notion-cli.sh archive-page <PAGE_ID>` |

### Databases

| Task | Command |
|---|---|
| Get schema | `notion-cli.sh database <DB_ID>` |
| Query database | `notion-cli.sh query-database <DB_ID> '<FILTER_JSON>'` |
| Create database | `notion-cli.sh create-database <PARENT_ID> "Title" '<SCHEMA_JSON>'` |

### Comments & Users

| Task | Command |
|---|---|
| Get comments | `notion-cli.sh comments <PAGE_ID>` |
| Add comment | `notion-cli.sh add-comment <PAGE_ID> "Text"` |
| List users | `notion-cli.sh users` |
| Bot info | `notion-cli.sh me` |

## URL parsing

The CLI auto-parses Notion URLs:
```
notion-cli.sh page "https://www.notion.so/workspace/Page-Title-abc123def456..."
```
Extracts the 32-char hex ID and formats it as UUID automatically.

## Important: page sharing

Notion internal integrations only see pages explicitly shared with them.
To share: open page > "..." menu > "Connections" > "claude-desktop-anthony".
Share a top-level page to grant access to all its children.

## Gotchas
- Pages must be shared with the integration before they're accessible
- Credentials in `~/.claude/skills/tool-notion/.env` — never display or log
- Database queries accept Notion filter JSON format
- Page content is returned as Notion blocks (not markdown)
