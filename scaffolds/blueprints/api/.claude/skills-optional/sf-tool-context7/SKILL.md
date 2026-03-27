---
name: tool-context7
description: Fetch up-to-date library documentation and code examples using Context7. Auto-triggers when user asks how to use a library/framework API, needs current docs for React/Next.js/Tailwind/Vue/Angular/Express/Prisma/etc., encounters outdated API patterns, or says "use context7". Use proactively when writing code with external libraries to avoid hallucinating deprecated APIs.
allowed-tools: Bash
---

# Context7 — CLI mode

Fetch real-time, version-specific documentation and code examples from 1000+ libraries. **No MCP or token needed** — free public API.

## When to use (auto-trigger)

- User asks "how do I do X with [library]?"
- Writing code with an external library and need correct API usage
- User encounters errors suggesting outdated API patterns
- User says "use context7"

## When NOT to use

- Standard language features (plain JS/TS/Python syntax)
- Internal project code
- Simple, stable APIs (e.g., `Array.map`)

## CLI

All commands use: `~/.claude/skills/tool-context7/context7-cli.sh`

| Task | Command |
|---|---|
| Search library | `context7-cli.sh search "react"` |
| Get docs | `context7-cli.sh docs reactjs/react.dev "useEffect"` |
| Get all docs | `context7-cli.sh docs prisma/prisma` |

## Workflow

1. **Search**: `context7-cli.sh search "library-name"` → find the library ID
2. **Fetch docs**: `context7-cli.sh docs <ID> "topic"` → get docs + code examples
3. **Apply**: Use the fetched patterns in code

## Common library IDs

| Library | ID |
|---|---|
| React | `reactjs/react.dev` |
| Next.js | `vercel/next.js` |
| Tailwind CSS | `tailwindlabs/tailwindcss` |
| Prisma | `prisma/prisma` |
| Express | `expressjs/express` |
| Vue | `vuejs/core` |
| Angular | `angular/angular` |
| NestJS | `nestjs/nest` |

## Gotchas
- Library IDs use `owner/repo` format (no leading slash)
- Topic is optional but recommended for focused results
- Results are markdown with code examples
- Rate limit: 200 requests (anonymous tier)
