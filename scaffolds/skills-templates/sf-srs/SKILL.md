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

| Concern                 | Lives in                             | Owned by        |
| ----------------------- | ------------------------------------ | --------------- |
| `SrsAdapter` interface  | `src/builders/srs/types.ts`          | SUB-1           |
| Backend implementations | `src/tools/<backend>/srs.adapter.ts` | `sf-tool-<backend>` skills |
| Dispatch / factory      | `src/srs/`                           | SUB-14.2        |
| Workflow integration    | `sf-workflow` drafting lifecycle     | SUB-8           |
| Architecture doc        | `.claude/docs/architecture-skills.md` | —              |

## Directory map

```
sf-srs/
├── SKILL.md                         # this file
├── templates/
│   ├── pages/                       # Epic + FR page templates → PageContent   (SUB-3)
│   └── tickets/                     # GitHub ticket templates (srs-epic, srs-story)   (SUB-4)
└── scripts/
    ├── srs-cli.sh                   # single orchestrator entrypoint           (SUB-14.3)
    └── drafters/
        ├── from-notion-pages.ts     # Notion pages → SRS spec                   (SUB-6)
        └── from-codebase.ts         # audit codebase → SRS spec                 (SUB-13)
    # spawn-tickets-from-srs.ts      # SRS → GitHub tickets                      (SUB-9)
    # eval-hook.ts                   # continuous freshness scoring              (SUB-10)
```

Placeholders are kept with `.gitkeep` until their owning SUB populates them.

## Configuration

This skill reads `tools.srs.backend` from `.saasfoundry.json` to pick the right adapter :

```bash
jq -r '.tools.srs.backend' .saasfoundry.json   # notion | atlassian | local-markdown
```

Dispatch resolution happens inside `src/srs/` (SUB-14.2) — never directly in this skill.

## Commands

All via `.claude/skills/sf-srs/scripts/srs-cli.sh <action> [args]`.

| Action     | Purpose                                                                   | Populated by |
| ---------- | ------------------------------------------------------------------------- | ------------ |
| `help`     | Print available actions                                                    | SUB-14.3     |
| `validate` | Smoke-test the configured backend via `createSrsAdapter().init()`           | SUB-14.3     |
| `draft`    | Run the drafter matching the configured backend / input mode                | SUB-6, 13    |
| `spawn`    | Spawn GitHub tickets from a published SRS                                   | SUB-9        |
| `eval`     | Compute freshness score comparing the SRS to the codebase                   | SUB-10       |

The wrapper is intentionally thin — real logic lives in `src/srs/` and consumes only the `SrsAdapter` interface.

## How other skills hand off to `sf-srs`

- **`sf-workflow`** — when a ticket enters `Backlog` with the `srs:drafting` label, the workflow skill calls `srs-cli.sh draft` (or the appropriate action) and stays out of the way otherwise
- **`sf-tool-*`** skills expose a `SrsAdapter` implementation but never call `sf-srs` themselves. Dispatch is one-way : `sf-srs` → `sf-tool-<backend>` via `createSrsAdapter()`

## Critical rules

1. **Never import a concrete adapter class** from within `sf-srs` — always go through `createSrsAdapter()` in `src/srs/`
2. **Never hardcode backend branches** (`if backend === 'notion'`) ; the registry in `src/srs/` is the only place that knows about concrete backends
3. **Never call `gh`, the Notion SDK, or any tool-specific CLI directly** ; delegate through the adapter or through `sf-tool-<backend>`
4. **Every new SUB under #174 ships its artefact in the directory map above** — do not invent new locations
