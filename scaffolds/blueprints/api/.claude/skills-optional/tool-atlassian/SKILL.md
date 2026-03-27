---
name: tool-atlassian
description: Interact with Atlassian services - Confluence wiki pages, Jira issues/tickets/sprints/boards. Auto-triggers on atlassian.net URLs, mentions of Jira, Confluence, tickets, wiki, sprint, backlog, epic, or story.
allowed-tools: Bash
---

# Atlassian (Jira + Confluence) — CLI mode

Access Jira and Confluence via direct REST API calls. **No MCP needed.**

## Auto-trigger keywords
Jira, Confluence, Atlassian, ticket, issue, sprint, backlog, epic, story, wiki, confluence page, board, atlassian.net

## CLI

All commands use: `~/.claude/skills/tool-atlassian/atlassian-cli.sh`

### Jira

| Task | Command |
|---|---|
| List projects | `atlassian-cli.sh jira projects` |
| Get issue | `atlassian-cli.sh jira issue SW-123` |
| Search (JQL) | `atlassian-cli.sh jira search "project = SW AND status = 'In Progress'"` |
| Create issue | `atlassian-cli.sh jira create SW Task "Summary" --desc "Details"` |
| Edit issue | `atlassian-cli.sh jira edit SW-123 '{"summary":"New title"}'` |
| List transitions | `atlassian-cli.sh jira transitions SW-123` |
| Transition issue | `atlassian-cli.sh jira transition SW-123 31` |
| Add comment | `atlassian-cli.sh jira comment SW-123 "Comment text"` |
| Add worklog | `atlassian-cli.sh jira worklog SW-123 2h` |

### Confluence

| Task | Command |
|---|---|
| List spaces | `atlassian-cli.sh confluence spaces` |
| List pages | `atlassian-cli.sh confluence pages <SPACE_ID>` |
| Get page | `atlassian-cli.sh confluence page <PAGE_ID>` |
| Search (CQL) | `atlassian-cli.sh confluence search "text ~ 'keyword'"` |
| Create page | `atlassian-cli.sh confluence create <SPACE_ID> "Title" "<p>Body</p>"` |
| Update page | `atlassian-cli.sh confluence update <PAGE_ID> <VERSION> "Title" "<p>Body</p>"` |
| Page comments | `atlassian-cli.sh confluence comments <PAGE_ID>` |

## URL parsing

```
Jira:       dnascript.atlassian.net/browse/PROJ-123      -> jira issue PROJ-123
Confluence: dnascript.atlassian.net/wiki/.../pages/12345  -> confluence page 12345
```

## Handling large JSON output

Pipe through `python3 -m json.tool` for pretty-print, or `python3 -c` to extract fields.

## Gotchas
- JQL values with spaces must be quoted: `status = "In Progress"`
- Issue creation requires valid issue type name (Task, Bug, Story, Epic...)
- Confluence body uses Atlassian Storage Format (HTML-like)
- Credentials in `~/.claude/skills/tool-atlassian/.env` — never display or log
