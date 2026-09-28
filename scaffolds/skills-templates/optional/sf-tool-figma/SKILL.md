---
name: tool-figma
description: Interact with Figma designs, components, FigJam boards, and design systems. Auto-triggers on figma.com URLs, mentions of Figma, mockup, design system, UI design, FigJam, or design-to-code.
allowed-tools: Bash
---

# Figma — CLI mode

Access Figma files, components, images, and metadata via direct REST API calls. **No MCP needed.**

## Auto-trigger keywords
Figma, figma.com, design, mockup, FigJam, design system, UI component, design-to-code, wireframe

## CLI

All commands use: `~/.claude/skills/tool-figma/figma-cli.sh`

### Known IDs
- Team ID: `1598288737680195069` (DNA Script)
- BioFoundry project: `542545441`
- Perso project: `572423435`

### Files & Metadata

| Task | Command |
|---|---|
| Who am I | `figma-cli.sh me` |
| File metadata | `figma-cli.sh file <FILE_KEY>` |
| Specific nodes | `figma-cli.sh file-nodes <FILE_KEY> "1:2,3:4"` |
| Export images | `figma-cli.sh images <FILE_KEY> "1:2" [png\|jpg\|svg\|pdf]` |
| Version history | `figma-cli.sh versions <FILE_KEY>` |

### Components & Styles

| Task | Command |
|---|---|
| File components | `figma-cli.sh components <FILE_KEY>` |
| Component sets | `figma-cli.sh component-sets <FILE_KEY>` |
| File styles | `figma-cli.sh styles <FILE_KEY>` |
| Team components | `figma-cli.sh team-components <TEAM_ID>` |
| Team styles | `figma-cli.sh team-styles <TEAM_ID>` |

### Projects

| Task | Command |
|---|---|
| Team projects | `figma-cli.sh team-projects <TEAM_ID>` |
| Project files | `figma-cli.sh project-files <PROJECT_ID>` |

### Comments & Variables

| Task | Command |
|---|---|
| List comments | `figma-cli.sh comments <FILE_KEY>` |
| Add comment | `figma-cli.sh add-comment <FILE_KEY> "Message"` |
| Variables | `figma-cli.sh variables <FILE_KEY>` |
| Variable collections | `figma-cli.sh variable-collections <FILE_KEY>` |

### URL Parsing

| Task | Command |
|---|---|
| Parse URL | `figma-cli.sh parse-url "https://figma.com/design/..."` |

Returns `{"fileKey":"...","nodeId":"..."}`.

## URL format

```
figma.com/design/:fileKey/:fileName?node-id=X-Y  -> fileKey, nodeId = "X:Y"
figma.com/board/:fileKey/:fileName                -> FigJam file
figma.com/design/:fileKey/branch/:branchKey/...   -> use branchKey as fileKey
```

## Design-to-code workflow

1. Parse URL: `figma-cli.sh parse-url "<URL>"`
2. Get structure: `figma-cli.sh file-nodes <KEY> "<NODE_ID>"`
3. Export screenshot: `figma-cli.sh images <KEY> "<NODE_ID>" png`
4. Read node properties and adapt to project stack

## Gotchas
- nodeId uses `:` in API, `-` in URLs — `parse-url` handles conversion
- Images endpoint returns URLs that expire — download immediately
- Credentials in `~/.claude/skills/tool-figma/.env` — never display or log
