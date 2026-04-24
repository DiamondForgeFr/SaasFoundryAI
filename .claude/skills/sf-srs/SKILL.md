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

Two equivalent entrypoints expose the same actions:

- **CLI (preferred, non-interactive)**: `sf srs <action> [args]` — registered in Commander (see `src/commands/srs.ts`), forwards directly to the TS entrypoints under `src/srs/bin/*.ts`. Use this in
  CI, scripts, and from AI agents that can't rely on a skill being installed.
- **Skill shell wrapper**: `.claude/skills/sf-srs/scripts/srs-cli.sh <action> [args]` — same actions, kept in parallel so the skill stays self-contained and works even if `sf` isn't on the `PATH` of
  the Claude Code session.

Run `sf srs help` or `srs-cli.sh help` to see the full action list.

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

## Freshness eval (SUB-16)

`srs-cli.sh eval` scores SRS drift against the codebase in batch mode — the complement to the conversational eval hook described above (which catches new decisions at conversation time ; eval catches
silent drift that already happened).

```bash
.claude/skills/sf-srs/scripts/srs-cli.sh eval [--path <dir>] [--root-page <id>] [--threshold <pct>] [--json]
```

- `--path` defaults to the current working directory (same rules as `draft --from codebase` — honours `.gitignore`, skips `node_modules / dist / coverage / .git`).
- `--root-page` defaults to `tools.srs.rootPage.id` in `.saasfoundry.json`.
- `--threshold` is the minimum overall freshness score (default `80`). Exit code is `0` when the overall score ≥ threshold, `1` when below.
- `--json` emits the full `FreshnessReport` JSON for CI consumption instead of the human-readable summary.

### Heuristics (v1)

| Finding kind      | Trigger                                                                                                                        | Severity |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `fr-without-code` | FR page exists but no scanner finding (endpoint / ui-flow / entity / test) matches its area token                              | error    |
| `orphan-area`     | Scanner area carries implementation findings (endpoint / ui-flow / entity) but no FR page exists for it                        | error    |
| `code-without-fr` | An implementation finding is outside the matched set but its area already carries other matches (or mismatches a hint filter)  | warn     |
| `fr-untested`     | FR is mapped to code findings in its area but no test coverage is detected (no `endpoint.hasTests`, no test finding, no hints) | warn     |

The overall score is the unweighted mean of FR coverage, endpoint coverage, and test coverage (each as a percentage). The per-category breakdown reports `FR` from the heuristics above.
`UR / DS / TC / NFR` are emitted with `score: null` and a note — deeper drift on those categories requires the Notion adapter to preserve table-row cells on `fetchPage`, which is a follow-up SUB.

### Three-layer matcher (L1 deterministic → L2 declarative → L3 AI review)

The eval is AI-augmented by design: the CLI runs deterministic checks so the skill can spend agent tokens only on the semantic review that tooling cannot do. No LLM is ever invoked from the tool
itself — cost for non-agent users stays at zero.

- **L1 — deterministic script.** `eval-srs` matches every FR against all scanner findings whose `area` overlaps (not just endpoints). `ui-flow`, `entity`, and `test` findings now count alongside
  `endpoint`, so frontend-only, data-only, and test-driven FRs are recognised without human intervention.
- **L2 — declarative hints on the FR page.** FR authors can narrow the match with two optional fields on `SrsFrEntry` :
  - `implementationKind: 'endpoint' | 'ui-flow' | 'entity' | 'mixed'` — filters impl findings to the declared kind (tests always count regardless).
  - `areaHints: string[]` — additional area tokens to match (handy when the scanner area and the FR ID diverge, e.g. FR area `billing` ↔ code area `payments`). Inventory builders populate these when
    the backend's page body carries them; today they are optional and unset.
- **L3 — AI review packet.** Pass `--review-packet <path>` to `eval-srs` and the tool writes a structured JSON alongside the usual report :
  ```bash
  .claude/skills/sf-srs/scripts/srs-cli.sh eval --review-packet .srs-audit/review-packet.json
  ```
  The packet contains, per FR, its deterministic `status` (`matched` / `untested` / `unmatched`), the matched file list, and `promptHints` summarising the deterministic gaps. The skill feeds this
  packet into its own context and proposes :
  - matches the script missed (semantic mapping, e.g. an FR titled "Invoices" that should map to code area `billing`),
  - reclassifications (FR that looks matched but actually covers a different behaviour),
  - new UR / DS / TC / NFR items that the rendered report doesn't compute yet. The skill never edits the FR page silently — it uses the conversational eval hook (`apply-update`) to propose each change
    with the user.

### Sample output (human)

```
─── SRS freshness report ───
Root page   : 34aa31bb-4f3f-8170-8989-d8738f3356d8
Generated   : 2026-04-22T12:34:56.000Z
Threshold   : 80% (status = DRIFT)
Overall     : 62%

Per category:
  UR     n/a  (0/0)
       UR drift is not evaluated in v1 — rendered Notion tables return empty cells via fetchPage…
  FR    50%  (3/6)
  DS     n/a  (0/0)
  …

Counts:
  FR pages       : 6 (matched 3, untested 1)
  Endpoints      : 12 (matched 9, untested 4)

Drift findings (4):
  ✗ [fr-without-code] FR FR-BILLING-01 — "Invoice export" has no matching code finding in area "billing"
  ✗ [orphan-area] Code area "payments" carries 3 endpoint(s) but has no FR page (e.g. GET /charges) — api/src/modules/payments/payments.controller.ts
  ! [fr-untested] FR FR-AUTH-02 is mapped to 1 endpoint(s) but none carry tests — api/src/modules/auth/auth.controller.ts
  ! [code-without-fr] GET /session in "auth" is not covered by any FR in the SRS — api/src/modules/auth/session.controller.ts
```

### Exit codes

| Code | Meaning                                                                 |
| ---- | ----------------------------------------------------------------------- |
| 0    | Overall score ≥ threshold (FRESH) OR no FRs to evaluate                 |
| 1    | Overall score < threshold (DRIFT)                                       |
| 2    | Bad input (missing `--root-page`, malformed manifest, invalid `--path`) |
| 3    | `tools.srs.backend` missing from the manifest                           |
| 4    | Unknown / invalid backend name                                          |
| 5    | Adapter runtime error (`init()` / `listChildren` / scanner failure)     |

### CI integration pattern

Run eval as a nightly job or on `develop` pushes. Gate the pipeline on exit code `1` if strict mode is desired, or always allow through and surface the JSON in a step summary. The CI wiring itself is
project-side — this SUB only ships the eval contract.

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

### Single-pass Epic + FR writes (logical IDs, #245)

FRs reference their parent Epic via one of two fields :

- `parentEpicPageId` — an explicit Notion page ID. Use when attaching an FR to an Epic that already exists (incremental writes, post-import).
- `parentEpicId` — a **logical ID** that matches the `epic.id` of an Epic appearing earlier in the same batch. `write-srs` resolves it on the fly by building a logical-id → page-id map as Epics are
  created.

Example mixed spec (a single `write` call creates both Epic and FRs, no intermediate page-id collection) :

```json
[
  {
    "kind": "epic",
    "confidence": "high",
    "source": { "kind": "notion-pages" },
    "epic": {
      "id": "EPIC-AUTH",
      "title": "Authentication",
      "parentPageId": "<workspace-root-id>",
      "urs": [],
      "frs": []
    }
  },
  {
    "kind": "fr",
    "confidence": "high",
    "source": { "kind": "notion-pages" },
    "fr": {
      "parentEpicId": "EPIC-AUTH",
      "fr": { "id": "FR-1", "title": "Login endpoint" }
    }
  }
]
```

If `parentEpicId` references an Epic that is neither in the batch nor resolved via `parentEpicPageId`, `write-srs` exits 6 with an error listing every logical id known so far — easy to spot typos and
missing Epics.

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

## Drafting from codebase (SUB-13)

For projects where the codebase already exists and Notion is empty (or sparse), `srs-cli.sh draft --from codebase` scans the repo and emits structured `ScannerFinding[]` that Claude clusters into
`DraftCandidate[]` conversationally with the user. The CLI never calls an LLM — it only surfaces what it can prove from the source tree.

### When to trigger `--from codebase`

> **Precondition — "install" vs "initialise" are two different flows.** Before firing any drafter, verify `tools.srs` exists in `.saasfoundry.json`. If it does not, the user is asking to **install the
> SRS module**, not to draft content — route them to `sf update --add-modules srs` (owned by `sf-update` / `sf-workflow`), **not** to this skill. The keyword "bootstrap" routinely conflates the two;
> always check the manifest first.

Fire the flow when **any** of the following matches (all assume the SRS module is already installed) :

| Signal                                                                             | Example utterance                                                      |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| User wants to **initialise SRS content** from the codebase (module already in use) | "draft an SRS from my codebase", "audit the repo for SRS material"     |
| User mentions **drift** between code and docs                                      | "my Notion SRS is stale, rebuild it from the code"                     |
| User asks for **coverage gaps**                                                    | "what's in the code but not in Notion?"                                |
| First-time drafter run on a mature repo                                            | empty / sparse Notion root + non-empty `src/` — propose it proactively |

Skip the flow when Notion is the source of truth (run `--from notion-pages` instead), when the user is describing a **new** feature that doesn't yet exist in code (use the conversational eval hook),
or when the SRS module has not yet been installed (route to `sf update --add-modules srs` first).

### Running the drafter

```bash
.claude/skills/sf-srs/scripts/srs-cli.sh draft --from codebase [--path <repo>]
```

`--path` defaults to the current working directory. The CLI walks the tree (honouring `.gitignore` and excluding `node_modules / dist / coverage / .git / .vitepress/cache`), runs every registered
scanner, and writes the result to stdout :

**Tuning the scan for noise-heavy repos.** CLI/library/template projects (SaaSFoundry itself, monorepos shipping `scaffolds/`, heavily-documented repos with large `docs/` trees) can drown the signal
under fixture code the scanners treat as production source. Two ways to opt out:

- **`.srsignore`** — a gitignore-style file at the scan root. Same syntax as `.gitignore`, additive to it.
- **`tools.srs.scan.exclude`** in `.saasfoundry.json` — a `string[]` of gitignore-style patterns applied on top of `.gitignore` + `.srsignore`.

```jsonc
// .saasfoundry.json
{
  "tools": {
    "srs": {
      "enabled": true,
      "backend": "notion",
      "scan": {
        "exclude": ["scaffolds/", "docs/", ".claude/"]
      }
    }
  }
}
```

Both layers stack. Use `.srsignore` for local/developer tuning (it stays out of other projects generated from this repo), and `tools.srs.scan.exclude` for project-wide defaults the whole team should
share.

Output example:

```jsonc
{
  "source": "codebase",
  "findings": [
    /* ScannerFinding[] */
  ]
}
```

Five scanner kinds fire today (see `docs/srs/scanner-findings.md` for the full JSON shape) :

| Kind          | Source of truth                                | Area heuristic                                      |
| ------------- | ---------------------------------------------- | --------------------------------------------------- |
| `endpoint`    | NestJS `@Controller` + method decorators       | nearest `src/modules/<area>/`                       |
| `ui-flow`     | React pages linked from `routes.tsx`           | `src/pages/<area>/<PageName>`                       |
| `entity`      | Prisma `model` blocks                          | model-name dictionary (User→users, Session→auth, …) |
| `test`        | Jest `describe` / `it` / `test` in `*.spec.ts` | `src/modules/<area>/` or filename stem              |
| `doc-context` | `README.md` / `CLAUDE.md` / `docs/**/*.md`     | folder name (`docs`, `modules`, …)                  |

### Reading the findings[] output

For each finding :

- **Every shape has `kind` + `title`** — use them for first-pass clustering.
- **`area`** is the glue : findings that share an `area` usually belong to the same Epic / FR cluster.
- **`file`** is the authoritative path — quote it back to the user when proposing a cluster ("FR-Auth — based on `api/src/modules/auth/auth.controller.ts` + `api/prisma/schema/auth.prisma`").
- **`endpoint.hasTests`** flags `true` when the same `area` has at least one test finding — use it to prime the TC section of the proposed FR.
- **`ui-flow.linkedEndpointGuess`** is a soft hint (filename / route substring match against endpoint paths) — verify it against the actual endpoint list before trusting it.
- **`doc-context.excerpt`** is capped at 280 chars — treat it as a **summary seed**, not the full text.

### Clustering into `DraftCandidate[]`

The skill's job is to convert raw findings into publishable draft candidates. Work **Epic-by-Epic, then FR-by-FR** :

1. **Group by area.** Collect every finding whose `area` matches. Add `doc-context` findings that share the area name or a parent folder.
2. **Pick the Epic level.** One Epic per coherent area (e.g. `auth`, `storage`, `accounts`). Title + narrative come from the richest `doc-context` in the group, or from the user's wording.
3. **Propose the FRs.**
   - One FR per `endpoint` (or per tight endpoint cluster — e.g. CRUD on the same resource collapses into one FR).
   - Reuse `ui-flow` routes as acceptance criteria on the user-facing FR.
   - Populate `dsRefs` / `tcRefs` from the items seeded in step 4 so the FR page surfaces the traceability links.
4. **Seed the Epic-level DS / TC / NFR sections.** Every Epic carries the SRS five-category shape (UR + FR + DS + TC + NFR) — see the canonical example at `templates/examples/example-epic.md`
   (rendered) / `templates/examples/example-epic.spec.json` (machine-readable) for the exact layout. The seeding rules below turn scanner findings into initial items the reviewer accepts / edits /
   rejects.
5. **Flag gaps.** Any `endpoint` with `hasTests=false` is a test-coverage gap — surface it as a **TODO** TC item (title `"{METHOD} {PATH} — happy path"`, `expectedResult: "to write"`), not silently.

### Seeding DS / TC / NFR (five-category completeness)

These three sections are **interpretive** — scanners surface the raw material, the agent synthesises the items. Reuse the L1+L2+L3 pattern from the eval (`docs/srs/scanner-findings.md`): deterministic
findings feed AI prompts, the agent always runs, the user always validates before write.

#### DS items (Design Specifications)

One `DsItem` per material design decision visible in code. Source findings → seeded `DsItem`:

| Finding                                                      | Seeded `DsItem.title`            | Seeded `description` source                                                |
| ------------------------------------------------------------ | -------------------------------- | -------------------------------------------------------------------------- |
| `entity` (Prisma model)                                      | `Data model — <EntityName>`      | fields + `@unique` / `@id` / `@relation` + `deletedAt` flag                |
| `endpoint` with non-trivial DTO (POST/PATCH body ≥ 2 fields) | `API contract — <METHOD> <path>` | DTO field list + validation rules surfaced by `class-validator` decorators |
| `ui-flow` with `formFields.length ≥ 2`                       | `UI form — <PageName>`           | form field list + `linkedEndpointGuess` if present                         |

Group by the Epic's area; set `frRefs` to every FR in the group whose endpoint/entity/UI flow matches. Deduplicate by title prefix — if two entities share the same core name (e.g. `User` +
`UserProfile`), collapse them into a single DS item with both sub-models listed in the description.

#### TC items (Test Cases)

One `TcItem` per `test.cases[]` entry. Source mapping:

| Source                                   | Seeded `TcItem` field                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `test.cases[i].title`                    | `title` (the `it(...)` / `test(...)` string verbatim)                                                |
| `test.cases[i]` structure                | `steps` — parse Given/When/Then from the title if phrased that way, else bullet the `describe` chain |
| assertion in the test body (if readable) | `expectedResult`; if not parseable, use `"see <test.file>"`                                          |
| `test.area` or `endpoint.area`           | `frRefs` — every FR whose area matches                                                               |

**Untested endpoints** — for each `endpoint` with `hasTests=false`, emit a **TODO** TC item so the drift is auditable, not invisible:

```jsonc
{
  "id": "TC-<area>-<slug>-todo",
  "title": "<METHOD> <path> — happy path",
  "expectedResult": "to write",
  "frRefs": ["<FR-id>"]
}
```

The reviewer can either accept the TODO (making the gap part of the public contract) or reject it and flag it upstream.

#### NFR items (Non-Functional Requirements)

NFRs are **proposed, not derived** — every seeded item must be marked for explicit human validation. Build the candidate list from two layers:

**Layer 1 — stack signals** (present in `.saasfoundry.json` or inferred from findings):

| Signal                                                                                       | Seeded NFR(s)                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth` module present (endpoints under `/auth/*` or Prisma `Session` / `RefreshToken` model) | `Security — JWT access token expiry ≤ 15 min`; `Security — refresh token rotation on every use`; `Security — login rate limit ≤ 5 attempts / minute / IP` |
| `i18n` module (`src/locales/` folder or `i18next` dep)                                       | `i18n — all user-facing strings translated in FR + EN`; `a11y — locale switchable without page reload`                                                    |
| Prisma + Postgres detected                                                                   | `Data — soft delete via deletedAt on user-owned entities`; `Data — all migrations reversible (up + down)`                                                 |
| `docker-compose*.yml` + `/health` endpoint present                                           | `Ops — API health check p95 ≤ 1 s`                                                                                                                        |
| Playwright or e2e spec files present                                                         | `Quality — e2e coverage on critical user flows (login, signup, checkout when applicable)`                                                                 |
| `@nestjs/swagger` + `docs/openapi.json` generated                                            | `Docs — OpenAPI spec regenerated on every API change (CI guard)`                                                                                          |

**Layer 2 — standard SaaS catalogue** (always propose, mark low-confidence):

- `Perf — p95 API latency ≤ 500 ms at 100 req/s sustained`
- `Availability — uptime target 99.5% (excluding scheduled maintenance)`
- `Security — all user-uploaded files virus-scanned before persistence` (only if storage module present)
- `Privacy — PII fields encrypted at rest` (only if the schema carries `email`, `phone`, `address`)

Always emit NFRs with `priority: 'P3'` and `target: '<proposed — needs human validation>'`. The reviewer lifts priority / refines target before accepting.

#### Coverage table (pre-accept)

Before firing the review prompt on an Epic cluster, emit a one-shot **coverage table** so the reviewer sees what got seeded per category and where it came from:

```
SRS coverage for Epic: <title>
┌──────┬───────────────┬──────────────────────────────────────────────┐
│ Cat  │ Items proposed│ Source                                       │
├──────┼───────────────┼──────────────────────────────────────────────┤
│ UR   │ 3             │ doc-context + inferred from FRs              │
│ FR   │ 5             │ 5 endpoint clusters                          │
│ DS   │ 4             │ 2 entities + 1 endpoint + 1 UI form          │
│ TC   │ 8 (+ 2 TODO)  │ test.cases[] across 3 spec files             │
│ NFR  │ 4 (proposed)  │ auth + i18n + prisma + playwright signals    │
└──────┴───────────────┴──────────────────────────────────────────────┘
```

A cluster with **zero DS or zero TC** is a red flag — either the area is genuinely pure UI glue (no data model, no tests yet) or the scanners missed something. Surface the anomaly in the review prompt
rather than silently proposing an Epic with empty sections.

### Review-loop prompts

Never write to Notion without confirmation. Drive the loop one cluster at a time :

```
🔍 J'ai trouvé <N> éléments dans le scanner pour le domaine `<area>`. Je te propose de créer :

  📘 Epic : <title>
     ├─ FR : <title 1>  (based on: <file-1>, <file-2>)
     ├─ FR : <title 2>  (based on: <file-3>)
     └─ gaps : <endpoint without tests>, <page without linked endpoint>

Je pars sur cette structure, ou tu veux retailler l'Epic ? [accept / edit / reject / skip-area]
```

On **accept** → serialise the cluster as `DraftCandidate[]` and call `srs-cli.sh write --spec <tmp.json>`. On **edit** → negotiate the title / narrative / FR split and re-confirm. On **skip-area** →
park the area and continue with the next. Never batch-accept more than **one Epic per prompt** — the reviewer has to be able to course-correct cluster by cluster.

### Exit codes

`draft --from codebase` reuses the standard envelope :

| Code | Meaning                                                               |
| ---- | --------------------------------------------------------------------- |
| 0    | Success — findings emitted on stdout                                  |
| 2    | `--path` does not exist, is not a directory, or manifest is malformed |
| 3    | `tools.srs.backend` missing from the manifest                         |
| 4    | Unknown / invalid backend name                                        |
| 5    | Unexpected scanner runtime error                                      |

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

## Lessons learned — #203 capstone dogfood (2026-04-23)

Running the full `sf srs` chain end-to-end on SaaSFoundry itself surfaced 12 gaps consolidated under parent #235. Key takeaways agents should know about:

- **Matcher covers all finding kinds (#236 — landed).** `matcher.ts` now counts `endpoint`, `ui-flow`, `entity`, and `test` findings when scoring an FR. Frontend-only, data-only, and test-driven FRs
  no longer score 0 purely because there is no endpoint. FR authors can further steer the match via `implementationKind` / `areaHints` (L2 hints) and the skill gets a `--review-packet` JSON for L3 AI
  refinement. See "Three-layer matcher" above.
- **Epics land directly under rootPage (#237 — landed).** Earlier bootstrap inserted a `User flows & Specifications` category between rootPage and the Epics, which broke eval (`FR.total = 0` without
  `--root-page <category.id>`). The category layer is now removed — `bootstrapSrs` creates only the project root, Epics are its direct children, and eval works on the standard manifest with no
  override.
- **Scan from CWD ratisse scaffolds/ + docs/ (#238).** On CLI / library projects, run `draft --from codebase --path src` — a full-repo scan drowns real findings with template code.
- **Bootstrap does not persist `NOTION_API_TOKEN` (#239).** After `sf update --add-modules srs`, the token lives only in the interactive shell. For non-interactive / Claude bash sessions, load it from
  `.env` with `set -a && source .env && set +a` until the fix lands.
- **`write-srs` supports single-pass Epic + FR writes via logical IDs (#245).** Mix Epics (with `epic.id`) and FRs (with `parentEpicId`) in one spec — `write-srs` resolves the references as it goes.
  `parentEpicPageId` remains as an escape hatch for incremental writes against pre-existing Epics.
- **SRS completeness is UR+FR only (pre-#247).** Historically DS / TC / NFR were not generated. The five-category shape (UR+FR+DS+TC+NFR) is now seeded by #247, reusing the L1+L2+L3 matcher
  architecture — see the "Seeding DS / TC / NFR" section above for the full mapping.
- **Preconditions first.** Before asking the user scope questions (backend choice, Notion parent page, etc.), read `.saasfoundry.json` — the answers are almost always already there. Re-running
  `sf update --add-modules srs` on an already-installed module silently re-bootstraps and duplicates Notion pages (#240).

Artefacts from the capstone (kept for reference):

- `.srs-audit/follow-ups.md` — full lessons-learned analysis
- `.srs-audit/baseline-report-fixed-root.json` — first eval baseline (score 32, all FRs flagged fr-without-code due to #236)

## Contributor notes

- **FR page title format.** The canonical separator between the FR id and the title is the em-dash character (U+2014) wrapped in spaces: `FR-AREA-NN — Title`. It lives as the shared constant
  `FR_TITLE_SEPARATOR` in `src/builders/srs/constants.ts`, imported by both the page renderer (`src/builders/srs/templates/pages/fr.tpl.ts`) and the inventory parser (`src/srs/eval/inventory.ts`). Do
  not substitute an ASCII hyphen (U+002D) — it round-trips through Notion as the same glyph visually but breaks the byte-level identity the tests enforce. If you change the separator, update the
  constant in one place and both sites follow.
