# SRS Capstone #203 — Follow-ups

Consolidated lessons learned from the SaaSFoundry self-audit. Each entry becomes a sub-issue under a new parent ticket (per #203 exit condition: "Any blocker bugs opened as follow-up tickets under a
new parent (not #57)").

Generated: 2026-04-23 · audit ran on commit of branch `feature/203-srs-audit-capstone`.

---

## P1 — Correctness blockers

### 1. Matcher FR↔code is 100% endpoint-based — non-backend FRs always score 0 — **RESOLVED (#236, 2026-04-23)**

**Where:** `src/srs/eval/matcher.ts` **Status:** Landed on branch `feature/236-matcher-three-layers` across three commits.

- **L1 — Deterministic match (landed):** FR matches if any finding (`endpoint` / `ui-flow` / `entity` / `test`) in the same area exists. `orphan-area` and `code-without-fr` now cover all impl kinds.
- **L2 — Declarative hints (landed):** `SrsFrEntry.implementationKind` + `SrsFrEntry.areaHints` are honoured by the matcher when present. Inventory builders can populate them from page bodies (a
  future adapter change will parse Notion code-blocks; the type plumbing is in place today).
- **L3 — Review packet for AI refinement (landed):** `eval-srs --review-packet <path>` emits a deterministic JSON summary (per-FR status, per-finding mapping, `promptHints`) for the sf-srs skill to
  refine with AI. The CLI never calls an LLM itself — cost stays zero for non-agent users.

### 2. Inventory walk assumes root→Epics directly, breaks with category sub-page — **RESOLVED (#237, 2026-04-23)**

**Where:** `src/srs/eval/inventory.ts:26-27` **What:** `buildSrsInventory(adapter, rootPageId)` calls `listChildren(rootPageId)` expecting each child to be an Epic. Earlier bootstrap inserted a
`User flows & Specifications` category page between rootPage and the Epics, which made eval return `FR.total = 0` on the standard manifest. **Resolution:** Option C was taken — the intermediate
category served no purpose (single hardcoded key, no extensibility) and conflicted with the DIAMONFORGE reference shape where Epics live directly under the product-spec root. Removed:

- `bootstrapSrs` no longer creates the category page (`src/runners/srs.runner.ts`).
- `SrsToolConfig.categories` field dropped from the manifest type (`src/types.ts`) and from the write path in `sf new` / `sf update --add-modules srs`.
- This project's Notion migrated: the former `User flows & Specifications` page is now the root, and the 2 drafted Epics (`Commands`, `Init`) sit as its direct children. Old rootPage archived.
- `tools.srs.categories` stripped from `.saasfoundry.json`.

### 3. Scan defaults ratisse scaffolds/ and docs/ — dominates findings with template code

**Where:** `src/srs/bin/codebase-scan.ts` (walks from CWD) **What:** `draft --from codebase` without `--path` scans the whole repo. In SaaSFoundry, that pulls 291 findings from `scaffolds/` (template
code shipped to users, not a feature of the CLI) and 1104 `doc-context` findings from `docs/`, `README.md`, `.claude/` — drowning the CLI's own `src/` (83 findings). **Evidence:** full-repo scan =
1246 findings, 94% noise; `src/`-only scan = 83 findings, all relevant. **Fix direction:** Add a project-aware `.srsignore` (or exclusion rules in `.saasfoundry.json`) so CLI/library projects can
opt-out of `scaffolds/`, `docs/`, `.claude/` by default. Document the pattern in `sf-srs/SKILL.md`.

---

## P2 — UX & persistence gaps

### 4. Bootstrap doesn't persist NOTION_API_TOKEN; `.env` wasn't gitignored

**Where:** `src/commands/update.ts:498-518` + `.gitignore` (as of this audit's start) **What:** `sf update --add-modules srs` prompts for the token, uses it for the bootstrap, then discards it. User
must re-export on every shell. `.env` was not in `.gitignore` either, making "just store it" risky. **Evidence:** User ran `sf update --add-modules srs` twice, expected token to persist, surprised it
didn't. First audit iteration crashed with "NOTION_API_TOKEN not set" repeatedly in the Claude bash shell. **Fix direction:** Bootstrap must (a) write the token to `.env` at project root, (b) ensure
`.env` and `.env.local` are gitignored. Runtime (`createNotionSrsAdapterFromEnv`) should support dotenv loading as a fallback.

### 5. `--add-modules srs` bypasses the "already installed" filter — re-triggers bootstrap

**Where:** `src/commands/update.ts:454 + 498` + `src/prompts/update.prompts.ts:30` **What:** `getAvailableModules` correctly excludes srs when `tools.srs.enabled === true`, but the `--add-modules srs`
flag injects srs into `selectedModules` regardless, then the module block at line 498 fires the bootstrap again. Net effect: a second bootstrap creates a **duplicate** `<project>-srs` page on Notion
and overwrites the manifest's `rootPage.id`, orphaning the first workspace. **Evidence:** User re-ran `sf update --add-modules srs` to check install status, hit "Which backend should host the SRS?"
prompt — was about to silently double-install. **Fix direction:** When `--add-modules X` targets an already-installed module, refuse with a clear error or print a "no-op, already installed" message.
Never silently re-bootstrap.

### 6. `sf srs` not wired in the CLI — only accessible via the skill script

**Where:** `src/index.ts` + `.claude/skills/sf-srs/scripts/srs-cli.sh` **What:** Users running `sf srs eval` get `error: unknown command 'srs'`. The runtime actions (`eval`, `draft`, `write`, `spawn`,
`apply-update`) only exist behind the skill's shell wrapper. There is no non-interactive CLI path to the day-to-day SRS operations. **Evidence:** User tried `sf srs draft --from codebase` and hit an
unknown-command error. **Fix direction:** Add `src/commands/srs.ts` that forwards `sf srs <action> ...` to `.claude/skills/sf-srs/scripts/srs-cli.sh <action> ...` (or imports the same bin entrypoints
directly, avoiding shell indirection).

### 7. No `sf status` — impossible to see project state at a glance

**Where:** `src/commands/` (missing) **What:** There's no command that reads `.saasfoundry.json` and prints configured modules, linked services (GitHub Projects URL, Notion SRS root, etc.) and missing
preconditions. Users and AI agents have to piece this together from manifest diffs + git + external systems. **Fix direction:** New `sf status` command. Output both human-readable and `--json` for
agent consumption. Related to #8 (SessionStart hook consumes `sf status --claude-friendly`).

### 8. No SessionStart hook + CLAUDE.md misses precondition directive

**Where:** `.claude/settings.json` + `CLAUDE.md` + scaffold mirrors **What:** When an AI agent opens a session in the project, nothing auto-summarises the state. CLAUDE.md also lacks "first, read
`.saasfoundry.json` and check tool preconditions before acting". Result: agents open dialogue about scope/backend before verifying the manifest already has the answers. **Evidence:** Another Claude
session this morning asked the user to pick between notion/atlassian/local-markdown + specify a Notion parent page — all answers were in the manifest. **Fix direction:** (a) Add a `SessionStart` hook
that runs `sf status` (once shipped) and injects the summary. (b) Add a "Preconditions first" section to CLAUDE.md + scaffold mirrors. Saved as `feedback_skill_precondition_check.md` memory for
immediate effect.

### 9. Skill trigger "bootstrap an SRS" is ambiguous between install and draft

**Where:** `.claude/skills/sf-srs/SKILL.md:211` **What:** The trigger table maps "bootstrap an SRS on an existing project" to `--from codebase` drafting — but actual bootstrap belongs to
`sf update --add-modules srs`. New users following the skill hit the wrong flow and waste a turn on clarifying questions. **Fix direction:** Split the trigger into (a) **install** SRS module (routes
to CLI), and (b) **draft** initial content (routes to `--from codebase`). Rename "bootstrap" to "initialise" on one side.

### 10. `write-srs` doesn't resolve Epic→FR links inside a single batch

**Where:** `src/srs/bin/write-srs.ts:123-138` **What:** Spec files must pre-declare `FrSpec.parentEpicPageId` — but that ID only exists after the Epic has been created on Notion. Today the user (or
skill) has to run `write` twice: once for Epics, collect IDs, build a second spec for FRs, run again. **Evidence:** This audit had to generate `.srs-audit/draft-spec-epics.json` → write → parse report
→ generate `draft-spec-frs.json` → write. Two manual passes. **Fix direction:** Allow a spec to reference Epics by logical ID (`"parentEpicId": "EPIC-COMMANDS"`), resolve references at write time
using the in-batch `created` list, fail cleanly if unresolved.

---

## P2 — UX & persistence gaps (continued)

### 12. SRS completeness — generate DS / TC / NFR sections via AI

**Where:** `src/builders/srs/templates/pages/*` + `src/srs/bin/draft-from-codebase.ts` + new AI pass in `src/srs/ai/` **What:** Today's draft pipeline produces UR + FR only. The DIAMONFORGE shape
(reference: Notion DIAMONFORGE-PRODUCT-SPECS) expects four sections per Epic — UR, FR, **DS** (Design Specification), **TC** (Test Cases), **NFR** (Non-Functional Requirements). Without DS/TC/NFR, the
generated SRS can't pass a real audit. **Why AI:** these sections are interpretive, not extractive. DS needs architectural synthesis across scanner findings; TC needs scenario enumeration from tests +
FR semantics; NFR needs cross-cutting concerns from stack detection + SaaS conventions. **Fix direction — reuse the L1+L2+L3 architecture from §1:**

- **DS** — AI synthesises from endpoint + service + entity + frontend-route findings in the FR's area → architecture paragraph + data-flow bullets. Deterministic findings are the input.
- **TC** — AI enumerates scenarios from `tests.scanner` findings in the area + FR description. If 0 tests found, TC proposed as "to write" (surface as drift, not as gap in the spec).
- **NFR** — AI proposes from stack detection (auth module present → security NFRs, i18n present → a11y/i18n NFRs, etc.) + catalogue of standard SaaS NFRs. Marked "proposed, needs human validation".
  **Exit:** `sf srs draft --from codebase --with ds,tc,nfr` produces a full DIAMONFORGE-shaped Epic/FR tree. Humans validate/edit before write. All AI output cached for CI determinism.

---

## P3 — Polish

### 11. `parseFrPageTitle` case-sensitivity and separator variance handled in tests, but rendering uses em-dash (`—`, U+2014)

Verified by inspection; not a bug, just a note that Notion page-title-from-spec rendering must use the exact `FR-<AREA>-<NN> — <Title>` separator (em-dash, not hyphen) so eval's `parseFrPageTitle`
parses correctly on round-trip. Keep the templates and the parser in sync on any future rewrite.

---

## Proposed parent ticket

**Title:** SRS toolchain — post-capstone follow-ups (polish from #203 dogfood) **Body:** References #203 audit, lists the 11 items above, groups by priority. Each sub-issue carries its own
`complexity:` label and scope.
