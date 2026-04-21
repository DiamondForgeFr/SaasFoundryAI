# SRS SaaSFoundry AI

Agnostic host for Software Requirements Specifications (SRS) — templates, drafters, ticket spawning, continuous evaluation. Tool-agnostic by construction : every backend call goes through an
`SrsAdapter` implementation resolved from `.saasfoundry.json` → `tools.srs.backend`.

## Auto-trigger keywords

create SRS, draft SRS, draft FR, audit codebase for SRS, SRS status, evaluate SRS, spawn tickets from SRS, new epic, Notion SRS root URL, `srs:drafting` label event

## Responsibilities

- **Templates** — agnostic rendering of Epic / FR pages (`PageContent`) and GitHub ticket bodies
- **Drafters** — turn free-form input (Notion pages, codebase audit) into structured `EpicSpec` / `FrSpec`
- **Spawner** — from a published SRS, spawn the matching GitHub tickets
- **Eval hook** — continuously score SRS freshness vs. codebase drift
- **Dispatch** — route every backend call through the configured `SrsAdapter` ; no Notion / Confluence / local-markdown import ever leaks into `sf-srs`

## Cross-references

| Concern                 | Lives in                              | Owned by                   |
| ----------------------- | ------------------------------------- | -------------------------- |
| `SrsAdapter` interface  | `src/builders/srs/types.ts`           | SUB-1                      |
| Backend implementations | `src/tools/<backend>/srs.adapter.ts`  | `sf-tool-<backend>` skills |
| Dispatch / factory      | `src/srs/`                            | SUB-14.2                   |
| Workflow integration    | `sf-workflow` drafting lifecycle      | SUB-8                      |
| Architecture doc        | `.claude/docs/architecture-skills.md` | —                          |

## Directory map

```
sf-srs/
├── SKILL.md                         # this file
├── templates/
│   ├── pages/                       # Epic + FR page templates → PageContent   (SUB-3)
│   └── tickets/                     # GitHub ticket templates (srs-epic, srs-story)   (SUB-4)
└── scripts/
    └── srs-cli.sh                   # single orchestrator entrypoint           (SUB-14.3)
```

TS entrypoints dispatched by `srs-cli.sh` live alongside the CLI source under `src/srs/bin/` (dogfood) or `node_modules/saasfoundry-cli/dist/srs/bin/` (shipped). They are **not** duplicated inside the
skill folder — the skill is a thin orchestrator.

| Action                      | Bin entrypoint (`src/srs/bin/`) | Owner    |
| --------------------------- | ------------------------------- | -------- |
| `validate`                  | `validate.ts`                   | SUB-14.3 |
| `browse`                    | `browse-tree.ts`                | SUB-6    |
| `draft --from notion-pages` | `draft-from-notion-pages.ts`    | SUB-6    |
| `draft --from codebase`     | `draft-from-codebase.ts`        | SUB-13   |
| `write`                     | `write-srs.ts`                  | SUB-6    |
| `spawn`                     | `spawn-tickets.ts`              | SUB-9    |
| `apply-update`              | `apply-srs-update.ts`           | SUB-10   |
| `eval`                      | `eval-srs.ts`                   | SUB-16   |

Placeholder subfolders under `templates/` are kept with `.gitkeep` until their owning SUB populates them.

## Configuration

This skill reads `tools.srs.backend` from `.saasfoundry.json` to pick the right adapter :

```bash
jq -r '.tools.srs.backend' .saasfoundry.json   # notion | atlassian | local-markdown
```

Dispatch resolution happens inside `src/srs/` (SUB-14.2) — never directly in this skill.

## Commands

All via `.claude/skills/sf-srs/scripts/srs-cli.sh <action> [args]`.

| Action         | Purpose                                                               | Populated by |
| -------------- | --------------------------------------------------------------------- | ------------ |
| `help`         | Print available actions                                               | SUB-14.3     |
| `validate`     | Smoke-test the configured backend via `createSrsAdapter().init()`     | SUB-14.3     |
| `browse`       | List direct children of a backend page (tree navigation helper)       | SUB-6        |
| `draft`        | Run the drafter matching `--from <source>` (notion-pages \| codebase) | SUB-6, 13    |
| `write`        | Apply a `DraftCandidate[]` spec to the backend + clear pending flag   | SUB-6        |
| `spawn`        | Spawn GitHub tickets from a published SRS                             | SUB-9        |
| `apply-update` | Apply a conversational eval-hook patch (ADD-only : UR / FR / DS / TC) | SUB-10       |
| `eval`         | Compute freshness score comparing the SRS to the codebase (batch)     | SUB-16       |

The wrapper is intentionally thin — real logic lives in `src/srs/` and consumes only the `SrsAdapter` interface.

## Ingestion workflow (SUB-6)

When `sf new --srs-enable --srs-ingest-enable` is used (or the equivalent is picked interactively), the CLI bootstraps the SRS workspace and then stamps `tools.srs.pendingIngestion` into
`.saasfoundry.json` :

```jsonc
{
  "tools": {
    "srs": {
      "enabled": true,
      "backend": "notion",
      "rootPage": { "id": "...", "url": "...", "name": "Project" },
      "pendingIngestion": {
        "sourceBackend": "notion",
        "sourceParent": { "id": "...", "url": "...", "name": "Existing notes" },
        "createdAt": "2026-04-20T12:00:00.000Z"
      }
    }
  }
}
```

The flag is ephemeral — it signals "the user asked us to ingest existing notes next time they open the project in Claude Code". When the sf-srs skill sees it, it drives a conversational loop :

1. **Browse** — `srs-cli.sh browse --parent <sourceParent.id>` lists direct children. Claude and the user pick which ones are worth ingesting (rejecting TOC / index pages, drilling into sub-pages
   recursively via repeat browse calls).
2. **Draft** — `srs-cli.sh draft --from notion-pages --ids id1,id2,...` fetches the selected pages as `RawContent`. Claude then drafts one or more `DraftCandidate` entries (Epic or FR specs) in
   conversation with the user. No LLM call happens inside the CLI — the skill owns that step.
3. **Write** — once the user approves the drafted candidates, the skill serialises them to a temp JSON file and runs `srs-cli.sh write --spec <tmp.json>`. On success, `pendingIngestion` is cleared
   from the manifest.

On partial failure during `write`, `write-srs.ts` emits a JSON report with a `rollbackHint` listing the pages it already created — Notion has no transactional rollback, so the skill surfaces this list
to the user and suggests either archiving manually or retrying from where it failed.

### Exit codes

Every TS entrypoint under `src/srs/bin/` honours the same contract. The skill must branch on these codes rather than parsing stderr :

| Code | Meaning                                                                              |
| ---- | ------------------------------------------------------------------------------------ |
| 0    | Success                                                                              |
| 2    | Bad input — missing / malformed flag, zero candidates, empty `--ids`, bad spec shape |
| 3    | SRS backend missing from the manifest (`tools.srs` absent)                           |
| 4    | Unknown / invalid backend name declared in the manifest                              |
| 5    | Backend runtime error (network, adapter `init()` failure, fetch failure)             |
| 6    | `write` only — partial failure, JSON payload carries `rollbackHint`                  |
| 7    | `write` only — pages created successfully but clearing `pendingIngestion` failed     |

## Conversational eval hook (SUB-10)

When the project declares `tools.srs.enabled = true` in `.saasfoundry.json`, Claude is responsible for **interjecting** during conversation turns whose content looks like a new Software Requirement.
There is no message parser and no standalone script — the "hook" is Claude reading the heuristics below and self-invoking. The `sf-workflow` skill's SKILL.md references this section and stays out of
the way.

### Detection heuristics — when to fire

Fire at most **once per conversation turn**. Skip trivial turns (pure tool invocations, "ok", "thanks", "read X", "what does this do"). Fire when the user's message matches **any** of the following
signals :

| Signal                                   | Target                              | Example utterance                                               |
| ---------------------------------------- | ----------------------------------- | --------------------------------------------------------------- |
| Describes a **user need / outcome**      | new **UR** on the Epic page         | "users should be able to log in with SSO"                       |
| Defines a new **feature or rule**        | new **FR** page under the Epic      | "we need a feature that lets admins export audit logs as CSV"   |
| Clarifies an **implementation decision** | new **DS** on the relevant FR page  | "let's use BCrypt with cost factor 12 for password hashing"     |
| Adds an **acceptance / test condition**  | new **TC** on the relevant FR page  | "and a test that proves unicode passwords are accepted"         |
| Reopens a **previously closed decision** | likely an **FR** or **DS** revision | "on reconsidère la règle : finalement on autorise les chiffres" |

Treat as **trivial and skip** : formatting nitpicks, small bug reports already covered by an existing FR, performance tweaks without observable user impact, pure refactor requests.

### Confirmation flow

When a signal fires, **pause before coding** and propose a diff in plain text :

```
💡 Ce que tu viens de décrire ressemble à <UR / FR / DS / TC>. Proposition :
  • <target page> — add <item id> : <narrative | title>
  • (if TC)        steps : ...

J'applique via `srs-cli.sh apply-update` ? [accept / edit / reject]
```

- **accept** → build the patch JSON (see shape below) and run `.claude/skills/sf-srs/scripts/srs-cli.sh apply-update < patch.json` (or pipe via stdin). On exit 0, continue with the coding task.
- **edit** → rework the proposed item text with the user, then re-confirm.
- **reject** → drop the proposal and continue. Do **not** re-propose the same item in the same conversation.

### Patch shape consumed by `apply-update`

```jsonc
{
  "kind": "add-ur" | "add-fr" | "add-ds" | "add-tc",
  "pageId": "<epic page id for add-ur / add-fr, FR page id for add-ds / add-tc>",
  "item": { /* UrItem | FrSpec | DsItem | TcItem, same shapes as src/builders/srs/types.ts */ },
  "note": "optional free-text annotation appended as a paragraph"
}
```

### Scope limits (v1, intentional)

- **ADD-only.** Modifying an existing item (e.g. tightening FR-012's acceptance criteria) is **out of scope** — the current `SrsAdapter.updatePage` is append-only on Notion, so surgical section
  replacement is not available through the contract. A follow-up SUB will extend the adapter with replace/delete semantics.
- **Append placement.** `add-ur` / `add-ds` / `add-tc` append new blocks to the **end** of the target page under an "Added …" heading2. The canonical section (User Requirements / Design / Test Cases)
  is _not_ updated in-place. Reviewers must fold the appended block back into the right section during the next human SRS review. The limitation is deliberate and documented.
- **`add-fr`** creates a brand-new child page under the Epic via `adapter.createFrPage`. The Epic page's "Traceability" table is **not** refreshed (same append-only limitation) — the new FR is still
  discoverable as a child page.
- **Throttling.** 1 proposal maximum per conversation turn. No persistent dedup cache (the turn boundary is sufficient — Claude's own judgment avoids re-proposing within the same turn).

### Dogfood checklist

After any change to the heuristics above, run a short manual session : drop 5 utterances (one per signal row + one trivial control) and confirm the hook fires exactly on the four signals and skips the
trivial one.

## How other skills hand off to `sf-srs`

- **`sf-workflow`** — when a ticket enters `Backlog` with the `srs:drafting` label, the workflow skill calls `srs-cli.sh draft` (or the appropriate action) and stays out of the way otherwise
- **`sf-tool-*`** skills expose a `SrsAdapter` implementation but never call `sf-srs` themselves. Dispatch is one-way : `sf-srs` → `sf-tool-<backend>` via `createSrsAdapter()`

## Critical rules

1. **Never import a concrete adapter class** from within `sf-srs` — always go through `createSrsAdapter()` in `src/srs/`
2. **Never hardcode backend branches** (`if backend === 'notion'`) ; the registry in `src/srs/` is the only place that knows about concrete backends
3. **Never call `gh`, the Notion SDK, or any tool-specific CLI directly** ; delegate through the adapter or through `sf-tool-<backend>`
4. **Every new SUB under #174 ships its artefact in the directory map above** — do not invent new locations
