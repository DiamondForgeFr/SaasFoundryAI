# Modules Catalogue — JSON Schema

**Audience**: authors of Claude Code skills (e.g. `tool-saasfoundry`) that read the SaaSFoundryAI module catalogue programmatically.

The catalogue is the **single source of truth** for what modules SaaSFoundryAI can install. It is consumed by `sf new`, `sf update`, and the public `sf modules` command group.

Skill consumers should call `sf modules` with `--json` rather than parsing human output. The JSON envelope is versioned by `cliVersion` so consumers can detect and adapt to future additions.

## Stability guarantees

- **Additive between minor CLI versions** — new fields may appear; existing fields are not renamed or removed without a major bump.
- `cliVersion` is always present at the top of every `--json` response.
- Field semantics (meaning of `category`, of `installOnly`, etc.) are stable across minor versions.
- Array order in `CATALOGUE` is stable within a given CLI version but not guaranteed across versions — consumers should key by `name`, not index.

## Entry point: module names

Every entry is identified by a stable machine `name`. The canonical list is emitted by `sf modules list --json`.

Current entries (as of `1.0.0-beta`):

- **Modules** (addable via `sf update`): `email`, `storage`, `analytics`
- **Skills** (advanced Claude Code skills): `sf-skill-context7`, `sf-skill-atlassian`, `sf-skill-notion`, `sf-skill-figma`
- **Structural** (shipped with `sf new`, not addable later): `auth`, `i18n`, `workflow-system`

## `sf modules list --json`

```json
{
  "cliVersion": "1.0.0-beta",
  "modules": [
    { "name": "email", "displayName": "...", "category": "module", "installed": false, ... },
    ...
  ]
}
```

Each array entry is a full `ModuleDefinition` augmented with `installed: boolean` computed from `.saasfoundry.json` in the current working directory (defaults to `false` when no manifest is present).

## `sf modules info <name> --json`

```json
{
  "cliVersion": "1.0.0-beta",
  "module": { "name": "email", ..., "installed": false }
}
```

Exits with code `1` and a human-readable error on stderr when the module name is unknown.

## `sf modules match "<intent>" --json`

```json
{
  "cliVersion": "1.0.0-beta",
  "intent": "send transactional emails",
  "results": [
    {
      "name": "email",
      "displayName": "MailerSend Email Service",
      "category": "module",
      "score": 5,
      "reasons": ["keywords: transactional", "description: transactional, emails"]
    }
  ]
}
```

Scoring algorithm:

- Tokenize the intent (lowercase, split on non-alphanumeric, ≥ 2 chars, drop stopwords).
- Per module, match tokens against `keywords` (exact set match, weight 3), `alternatives` (substring match, weight 2), `description` (substring match, weight 1).
- Return modules with `score > 0`, sorted descending.

The score is **relative**, not calibrated — consumers should use it for ranking, not for absolute thresholds. Claude is expected to do the final semantic matching client-side using `keywords`,
`provides`, `alternatives`, and `description` from the top candidates.

## `ModuleDefinition` — field reference

| Field                 | Type                                  | Meaning                                                                                                                                                                     |
| --------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                | string                                | Stable machine id. Used by `--add-modules`, `sf modules info`, installed-state lookups. Never renamed.                                                                      |
| `displayName`         | string                                | Human-readable label for tables and prompts. May change for clarity.                                                                                                        |
| `description`         | string                                | One-sentence summary. Used in `sf modules list`, `sf update` prompts, and match scoring.                                                                                    |
| `category`            | `'module' \| 'skill' \| 'structural'` | `module` = addable via `sf update`. `skill` = advanced Claude Code skill. `structural` = baked into `sf new`, not addable later.                                            |
| `keywords`            | string[]                              | Curated lowercase single-word tags for intent matching. Highest match weight.                                                                                               |
| `provides`            | string[]                              | What the module adds to the generated project (services, UI, tables, env vars).                                                                                             |
| `alternatives`        | string[]                              | What users might otherwise custom-build. Feeds the anti-reinvention guardrail — Claude should cite these when proposing a SaaSFoundryAI module over a hand-rolled solution. |
| `introducedInVersion` | string                                | First CLI version that shipped this module (semver).                                                                                                                        |
| `minCliVersion`       | string                                | Minimum CLI version required to install (semver).                                                                                                                           |
| `filesAffected`       | string[]                              | Paths touched when installing. Used by `sf update --dry-run` previews.                                                                                                      |
| `dependencies`        | string[]                              | npm package names added to the generated project.                                                                                                                           |
| `installOnly`         | `'scaffold' \| undefined`             | Present and equal to `'scaffold'` iff the module can only be chosen at `sf new` time. Absent on post-install modules.                                                       |

## Consumer contract (for `tool-saasfoundry` and similar)

Recommended skill flow when a user asks _"how do I add X?"_:

1. `sf modules match "<user intent>" --json` → shortlist candidates.
2. `sf modules info <candidate> --json` → read `provides`, `alternatives`, `filesAffected`.
3. If `category === 'structural'`, inform the user it ships with `sf new` and is not addable via `sf update`.
4. Otherwise, propose `sf update --add-modules <name>` with the appropriate credential flags (derived from `--help`).
5. Check `minCliVersion` against the user's installed CLI version before recommending.
