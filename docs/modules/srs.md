# SRS Module (Software Requirements Specifications)

Pluggable specification system that keeps your Epic → FR → DS → TC hierarchy in a backend of your choice (Notion today ; Confluence and local markdown on the roadmap) and drives ticket creation from
it.

## Overview

The SRS module wires a living requirements surface into the generator:

- ✅ **Backend-agnostic by construction** — every call goes through an `SrsAdapter` resolved from `tools.srs.backend` in your manifest, so switching from Notion to Confluence or local markdown later
  is a skill swap, not a rewrite.
- ✅ **Notion-first** — V1 ships the `NotionSrsAdapter` end-to-end: templates for Epic / FR pages, an ingestion drafter for existing notes, a spawner that turns FR pages into GitHub Stories, and a
  conversational eval hook.
- ✅ **Integrated with the workflow** — `srs:drafting` / `srs:update` / `srs:new` labels unlock a dedicated lifecycle (`ai-draft → human-review → spawning`) inside the existing `In progress` board
  column, so SRS and code tickets share a single board.
- ✅ **Ticket hand-off** — once an Epic page tree is drafted, `srs spawn` enumerates the FR pages and creates one GitHub sub-issue per FR, each rendered from `renderStoryTicketBody` and linked to the
  canonical page.
- ✅ **Continuous evaluation** — when a conversation turn looks like a new UR / FR / DS / TC, Claude proposes a diff and (on accept) appends the item through the configured backend. V1 is
  **ADD-only**; modifications are a future-iteration item documented under the skill.

## What the module actually ships

Enabling SRS at `sf new` or `sf update` time does three things:

1. **Installs the agnostic `sf-srs` skill** (`.claude/skills/sf-srs/`) — page + ticket templates, the `srs-cli.sh` orchestrator, the `SrsAdapter` dispatch.
2. **Installs the chosen backend skill** — `sf-tool-notion` today, with its credentials prompt and tool-specific adapter (`NotionSrsAdapter`).
3. **Stamps the manifest** — `.saasfoundry.json → tools.srs.*` records which backend is in use, the parent page, and (if requested) the one-shot `pendingIngestion` flag that tells Claude to ingest
   existing notes on next open.

No runtime code is added to your app — SRS is a collaboration layer, not a feature module.

```jsonc
{
  "tools": {
    "srs": {
      "enabled": true,
      "backend": "notion",
      "rootPage": {
        "id": "...",
        "url": "https://www.notion.so/...",
        "name": "My project — SRS root"
      },
      "pendingIngestion": {
        "sourceBackend": "notion",
        "sourceParent": { "id": "...", "url": "...", "name": "Existing notes" },
        "createdAt": "2026-04-21T10:00:00.000Z"
      }
    }
  }
}
```

`pendingIngestion` is ephemeral — it's cleared the first time Claude finishes drafting `DraftCandidate[]` into the backend.

## Installation

### During project creation

```bash
sf new
# When prompted:
? Do you want to enable the SRS module?
→ Yes
? Which backend should host your specs?
→ notion
? Paste the Notion parent page URL (or ID):
→ https://www.notion.so/...
? Ingest existing notes from another parent page?
→ Yes
? Paste the source parent page URL (or ID):
→ https://www.notion.so/legacy-notes-...
```

Scripted equivalent:

```bash
sf new --non-interactive \
  --project-name my-saas \
  --structure monorepo \
  --srs-enable \
  --srs-backend notion \
  --srs-parent-page-input "https://www.notion.so/..." \
  --srs-ingest-enable \
  --srs-ingest-parent-input "https://www.notion.so/legacy-notes-..."
```

Prerequisite — a Notion integration token must be provided for `sf-tool-notion` (the same token powers the SRS adapter). See [`sf-tool-notion`](/skills/tool-skills#sf-tool-notion) for the setup steps.

### Adding it to an existing project

```bash
sf update --add-modules srs \
  --srs-backend notion \
  --srs-parent-page-input "https://www.notion.so/..." \
  --notion-api-token    "secret_..."
```

Or run `sf update` interactively and pick **SRS** from the module menu. See [Updating Projects → Enable SRS on an existing project](/guide/updating-projects#enable-srs-on-an-existing-project).

The installer will:

1. Install the `sf-srs` skill (templates, scripts, dispatcher) under `.claude/skills/sf-srs/`
2. Install the backend skill (`sf-tool-notion`) if not already present
3. Bootstrap the Epic root page on the backend via `adapter.init()`
4. Write `tools.srs.*` into `.saasfoundry.json`
5. (Opt-in) stamp `pendingIngestion` so the next conversational session can pick existing notes to draft from

## Usage

### The four primary flows

| Flow                    | Trigger                                                                    | Entry point                                                  |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Draft from notes**    | `pendingIngestion` is set (one-shot) or you explicitly ask for a draft     | `srs-cli.sh browse` → `srs-cli.sh draft --from notion-pages` |
| **Draft from codebase** | The code already exists and you want to bootstrap SRS from the source tree | `srs-cli.sh draft --from codebase [--path <repo>]`           |
| **Spawn tickets**       | An Epic page tree (Main spec + FR-001…FR-N) is ready for ticket creation   | `srs-cli.sh spawn --ticket <parent> --epic <url-or-id>`      |
| **Evolve the spec**     | A conversation turn looks like a new UR / FR / DS / TC → Claude interjects | `srs-cli.sh apply-update` (ADD-only v1)                      |

All three go through the `SrsAdapter` interface — the Notion vs. Confluence vs. local-markdown choice never leaks into the skill or the CLI.

### CLI reference — `srs-cli.sh`

`.claude/skills/sf-srs/scripts/srs-cli.sh` is the only entrypoint you (or Claude) invoke directly:

```bash
# Smoke-test the configured backend
srs-cli.sh validate

# Browse the children of a backend page (tree navigation helper)
srs-cli.sh browse --parent <id>

# Draft Epic / FR specs from selected source pages
srs-cli.sh draft --from notion-pages --ids id1,id2,...

# Draft from the codebase (five scanners → ScannerFinding[] envelope)
srs-cli.sh draft --from codebase [--path <repo>]

# Apply a drafted spec (creates Epic + FR pages, clears pendingIngestion)
srs-cli.sh write --spec /tmp/candidates.json

# Spawn GitHub Stories from a drafted Epic
srs-cli.sh spawn --ticket 57 --epic <epic-page-url>

# Apply a conversational ADD-only patch (new UR / FR / DS / TC)
srs-cli.sh apply-update < patch.json

# (Coming soon, SUB-16) compute a freshness score across the SRS
srs-cli.sh eval
```

Every action honours a shared exit-code contract (`0` success, `2` bad input, `3` missing backend, `4` unknown backend, `5` runtime, `6` partial write, `7` pendingIngestion clear failed). See the
skill's [`SKILL.md`](https://github.com/DiamondForgeFr/SaasFoundryAI/blob/develop/.claude/skills/sf-srs/SKILL.md) for the full contract.

### Spec-to-ticket bridge (Rule 8)

When `tools.srs.backend` is set, Story sub-tickets under an SRS Epic **must** be spawned from their canonical FR pages — the `workflow-cli.sh create-subtask` command rejects direct calls and exits
with code 2 unless you pass `--bypass-srs <reason>`. Legitimate reasons are limited to:

- Meta tickets that don't map to an FR page (tooling, drafter refactors, eval polish)
- Bootstrapping an Epic's own SUBs during rollout, before the page tree exists

Typing the reason is the audit trail — pick something a reviewer can grep for (`spawned-from-srs`, `meta-srs-tooling`…). If the ticket represents a product requirement, the answer is always **"go
draft it first, then spawn"**.

## Configuration

### `.saasfoundry.json → tools.srs.*`

| Key                      | Type                                                            | Purpose                                                                         |
| ------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `enabled`                | `boolean`                                                       | Activates the conversational eval hook + Rule 8 gate                            |
| `backend`                | `'notion'` (today ; `'confluence'`, `'local-markdown'` roadmap) | Drives adapter dispatch                                                         |
| `rootPage.{id,url,name}` | `object`                                                        | The Epic root where new Epic pages land                                         |
| `pendingIngestion`       | `{ sourceBackend, sourceParent, createdAt }` or absent          | One-shot — signals "ingest existing notes on next open", cleared after drafting |

Never hand-edit `pendingIngestion` — the CLI owns it.

### Environment (Notion backend)

```env
NOTION_API_TOKEN="secret_..."
# Optional, defaults to 2025-09-03 :
NOTION_API_VERSION="2025-09-03"
```

The token is created at https://www.notion.so/my-integrations ; the integration must be explicitly shared with the parent page (and with the source parent page if ingestion is enabled).

## Roadmap

- **Confluence backend** — `ConfluenceSrsAdapter` with identical page + story rendering
- **Local-markdown backend** — file-system backend for teams that want SRS in git instead of a SaaS
- **Migration command** — `sf srs migrate` to port an existing SRS across backends (#187)
- **Freshness scoring** — `srs-cli.sh eval` returns a drift report comparing the SRS to the codebase (#202)
- **ADD + MODIFY eval hook** — current v1 is ADD-only ; replace / delete semantics are pending an adapter extension

## Troubleshooting

### "Backend not declared in the manifest" (exit 3)

`tools.srs` is missing from `.saasfoundry.json`. Either you haven't enabled the module (`sf update --add-modules srs`) or the manifest was rewritten without `tools.srs`. Re-run the installer or
restore the block from git history.

### "Unknown backend 'xyz'" (exit 4)

`tools.srs.backend` is set to a value the registry doesn't recognise. Valid options today: `notion`. Roadmap: `confluence`, `local-markdown`. Fix the manifest.

### `create-subtask` refuses my ticket with "Rule 8" error

You're on an SRS-enabled project and the ticket you're creating maps to a product requirement. Draft the FR on the backend first, then use `srs-cli.sh spawn` to create it. If the ticket is genuinely
meta (SRS tooling, drafter, etc.), pass `--bypass-srs <reason>`.

### `pendingIngestion` didn't clear after drafting

`write` exited with code 7 — pages were created, but the manifest write failed. Check file permissions on `.saasfoundry.json` and re-run `srs-cli.sh write --no-clear-pending` is **not** the fix ;
instead retry `write` or clear `pendingIngestion` by hand once you've verified the pages exist on the backend.

### Claude never interjects with an SRS proposal during conversation

Check `tools.srs.enabled === true` in the manifest. The hook is advisory — the skill documents detection heuristics (see `sf-srs/SKILL.md`). If `enabled` is false, the hook is intentionally muted.

## What happens when you run `sf update` on an SRS-enabled project

The `sf update` three-way merge treats the skill directory like any other set of files : if you edit `sf-srs/SKILL.md` locally, subsequent updates propose a conflict rather than overwriting. Keep your
customisations in project-specific docs (not in the skill files) if you want clean upgrades.

The backend adapter code lives under `src/tools/<backend>/srs.adapter.ts` in your generated project — it's the shipped adapter, also auto-upgraded by `sf update` unless you've forked it.

## Next steps

- [SRS lifecycle](/srs/lifecycle) — the full `Backlog → ai-draft → human-review → spawning → done` flow
- [SRS walkthrough](/srs/walkthrough) — end-to-end tutorial: enable, draft, spawn
- [Scanner findings reference](/srs/scanner-findings) — JSON shape emitted by `draft --from codebase`
- [Updating Projects](/guide/updating-projects#enable-srs-on-an-existing-project) — adding SRS after the fact
- [Skills System → Tool skills → `sf-tool-notion`](/skills/tool-skills#sf-tool-notion) — Notion credentials setup

## Related commands

- [`sf new --srs-enable`](/cli/sf-new) — project creation with SRS bootstrapped
- [`sf update --add-modules srs`](/cli/sf-update) — add SRS after the fact
