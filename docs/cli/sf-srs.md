# sf srs

Operations on the SRS workspace — the specification tree the AI drafts from and spawns tickets against.

This is the **non-AI path**: everything below can equally be asked of the agent in conversation, which drives these same commands through the `sf-srs` skill. The commands exist so the operations are
scriptable, testable, and inspectable without a model in the loop.

## Usage

```bash
sf srs <action> [args...]
```

Requires the [SRS module](/modules/srs) to be installed and a backend configured in `.saasfoundry.json` under `tools.srs`.

## Actions

| Action         | What it does                                                               |
| -------------- | -------------------------------------------------------------------------- |
| `help`         | Print the usage message                                                    |
| `validate`     | Smoke-test the configured backend, or check a spec offline with `--spec`   |
| `browse`       | List the direct children of a parent page, as JSON                         |
| `draft`        | Produce draft material — from backend pages, or by scanning the codebase   |
| `write`        | Apply a `DraftCandidate[]` spec file through the adapter                   |
| `versions`     | List the versions the SRS declares — what a release scope is proposed from |
| `next-ids`     | The next version number and free requirement ids of a feature              |
| `spawn`        | Turn an Epic page into tickets                                             |
| `normalize`    | Enumerate an Epic's FR pages and create Story sub-tickets                  |
| `apply-update` | Add a requirement, or change an existing FR in place, from a patch         |
| `eval`         | Score SRS freshness against the codebase                                   |

### Details

```bash
sf srs validate [manifest]
sf srs validate --spec <path>
sf srs browse --parent <id> [--manifest <path>]

sf srs draft --from notion-pages --ids <id1,id2,...> [--manifest <path>]
sf srs draft --from codebase [--path <dir>] [--manifest <path>]

sf srs write --spec <path> [--manifest <path>] [--no-clear-pending]
sf srs versions [--root-page <id>] [--manifest <path>]
sf srs next-ids --feature <page-url-or-id> [--json] [--manifest <path>]

sf srs spawn --epic <page-url-or-id> [--ticket <n>] [--version <title-url-or-id>]
             [--milestone <name>] [--complexity <level>] [--dry-run] [--manifest <path>] [--bypass-reason <text>]

sf srs normalize [--feature <url-or-id>] [--version-name <name>] [--apply]
                 [--manifest <path>] [--root-page <id>]

sf srs apply-update [--patch <path>] [--dry-run] [--manifest <path>]
sf srs eval [--path <dir>] [--root-page <id>] [--threshold <pct>] [--json] [--manifest <path>]
```

`write` re-reads a feature it adds a version to, right before the first page, and refuses the batch (exit 2, nothing written) when that feature already holds the version title or number, or any
UR/FR/DS/TC/NFR id the batch declares — two sessions extending one feature used to write the same `v3` and the same ids. `next-ids` gives the numbers to use instead, read from the SRS itself rather
than from an earlier reading.

`apply-update` adds a UR, FR, DS, TC or NFR (`add-ur`, `add-fr`, `add-ds`, `add-tc`, `add-nfr`) where `write` would have put it: in its table on the feature page, with the version of the target page,
and an FR also in its version's FR table and change list. It appends under an "Added …" heading only when the page is not part of the SRS or the table is missing, and says so.

### Changing an existing FR

`apply-update` also changes an FR that already exists, in place, with an `update-fr` patch. The patch names the FR by its id and the fields that change:

```json
{
  "kind": "update-fr",
  "frId": "FR-AEX-014",
  "changes": {
    "description": "Routes by the cost of delivering a ticket, duration included.",
    "acceptanceCriteria": { "add": ["Durations break ties between tiers"], "remove": ["Exact text of a criterion to drop"] }
  },
  "change": "Amends FR-AEX-014 — cost per delivered ticket"
}
```

`changes` may carry `title`, `description`, `priority` (`P1`, `P2` or `P3`), `complexity`, `endpoint`, `requestBody`, `securityRationale`, `acceptanceCriteria` and `validationRules`. A list takes the
whole array, which replaces it and keeps its order, or `{ "add": […], "remove": […] }`, which edits it: `remove` matches the exact text of an entry, an entry already in the list is not added again,
and one that is not in the list only produces a warning.

The FR changes where it is listed, and nothing is appended as a separate item:

- the FR page: its Summary table and its Field/Value table, and for a new title its heading and its page title;
- the FR table of the version that holds the FR, and the FR table of its feature (they show the title and the priority);
- one line in the "What changed in this version" list of the version that holds the FR: the patch's `change`, or `Amends <id> — <title> (<fields>)`. `versionPageId` records it on another version of
  the same feature instead, for an FR of an earlier version that is amended during later work.

`--dry-run` prints the old and new value of every cell, the change line and any warning, and writes nothing. Applying the patch for real prints the same document with `"dryRun": false`:

```json
{
  "kind": "update-fr",
  "frId": "FR-AEX-014",
  "dryRun": true,
  "changes": [{ "page": "fr", "where": "FR page › Description", "before": "…", "after": "Routes by the cost of delivering a ticket, duration included." }],
  "changeLine": { "status": "would-add", "text": "Amends FR-AEX-014 — cost per delivered ticket", "versionTitle": "v1 — Routing" },
  "before": { "description": "…" },
  "followUps": ["Story #1017 (open) was spawned from FR-AEX-014 and keeps the old text: edit its body by hand — …"]
}
```

What it refuses, with exit `2` and nothing written: an FR id that no page carries or that several carry (`pageId` names the one to change), a `pageId` or `versionPageId` that does not fit, an FR page
that cannot take the change (a page written before the Complexity row existed, or edited by hand), an empty patch, an unknown field, a value outside `P1`–`P3` or the complexity levels, and `id`,
`group` and the references `urRefs`, `dsRefs` and `tcRefs` — changing a reference also means changing the tables of the UR, DS and TC that list it, which is a follow-up
([#1056](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1056)). A backend whose adapter cannot change a page that already exists exits `5` and writes nothing; Notion can. `--dry-run` belongs
to `update-fr`: an `add-*` patch with `--dry-run` exits `2` rather than writing.

It is safe to repeat. A cell already at its value is left alone and the change line is not written twice, so applying the same patch again makes no write. The FR page is written first, then the
version table, the feature table and the change line, so the history never claims a change the tables lack. A write that stops midway exits `6` and prints `applied`, `pending` and `before`; applying
the same patch again finishes it, and a patch whose `changes` is that `before` goes back.

The Story already spawned from the FR keeps the text the FR had: it is not rewritten ([#1057](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1057)). The result's `followUps` names it, so you
edit its body by hand.

### Spawning tickets

`--milestone` on `spawn` **declares the release these tickets ship in**: the milestone is created or reused, the version page is linked to it, and every ticket spawned joins it.

`--complexity <level>` on `spawn` labels every created Story whose FR page states no complexity (`bug`, `low`, `medium` or `complex`); an FR page's own Complexity wins. The summary lists any Story
left without one, which the workflow refuses to move out of Backlog.

`--version` accepts the version's title, its page id with or without dashes, or its URL from either `www.notion.so` or `app.notion.com`.

Before creating anything, `spawn` searches the repository for tickets that already carry each FR, three FRs per GitHub search. GitHub allows 30 searches a minute; when a search hits that limit,
`spawn` waits 60 seconds and retries, up to three times. Set `SF_SEARCH_RATE_LIMIT_WAIT` (seconds) to change the wait.

`spawn` reuses the ticket that already carries an FR's canonical page, with or without `--reconciliation-plan`. A closed ticket is reused as it is and never reopened, a ticket closed as not planned
(how a duplicate is closed) is ignored, and an FR with no ticket is created. Two candidates for one FR, or a candidate that belongs to another parent, stop the run with exit `10` before anything is
written. Without `--ticket`, the open version Epic that a previous run created is adopted instead of created again.

`--dry-run` prints one line per FR: `reuse #N`, `reuse #N (closed)`, `create`, or `blocked — <reason>` (a blocked FR makes the dry run exit `10` too). A duplicate that already exists is detached from
its Epic with `workflow-cli.sh unlink-subtask <epic> <duplicate>`; close it as not planned and every later `spawn` ignores it.

## Common options

| Flag                | Description           | Default             |
| ------------------- | --------------------- | ------------------- |
| `--manifest <path>` | Manifest file to read | `.saasfoundry.json` |

## Exit codes

A shared contract across every action, so a script can branch on the reason rather than on a message:

| Code | Meaning                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------- |
| `0`  | success                                                                                                   |
| `2`  | bad input                                                                                                 |
| `3`  | missing backend                                                                                           |
| `4`  | unknown backend                                                                                           |
| `5`  | runtime failure, or a backend that cannot amend a page                                                    |
| `6`  | write partial — the output carries a `rollbackHint`, or for `update-fr` `applied`, `pending` and `before` |
| `7`  | write succeeded, but clearing `pendingIngestion` failed                                                   |

An option an action does not know is bad input: the action exits `2` before reading or writing anything. `write` has no dry run — `sf srs validate --spec <path>` runs, without a backend, the checks
`write` makes before creating any page.

## Examples

```bash
# Is the configured backend actually reachable?
sf srs validate
```

```bash
# What would spawning this Epic create, without creating anything
sf srs spawn --epic https://notion.so/... --dry-run
```

```bash
# How stale is the specification against the code, as JSON
sf srs eval --json --threshold 70
```

## See also

- [SRS module](/modules/srs) — what it installs and which backends exist
- [SRS lifecycle](/srs/lifecycle) — how a page becomes a ticket
- [`sf status`](/cli/sf-status) — whether the SRS module is configured at all
