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
| `apply-update` | Apply a conversational eval-hook patch (ADD-only)                          |
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

sf srs apply-update [--patch <path>] [--manifest <path>]
sf srs eval [--path <dir>] [--root-page <id>] [--threshold <pct>] [--json] [--manifest <path>]
```

`write` re-reads a feature it adds a version to, right before the first page, and refuses the batch (exit 2, nothing written) when that feature already holds the version title or number, or any
UR/FR/DS/TC/NFR id the batch declares — two sessions extending one feature used to write the same `v3` and the same ids. `next-ids` gives the numbers to use instead, read from the SRS itself rather
than from an earlier reading.

`apply-update` adds a UR, FR, DS, TC or NFR (`add-ur`, `add-fr`, `add-ds`, `add-tc`, `add-nfr`) where `write` would have put it: in its table on the feature page, with the version of the target page,
and an FR also in its version's FR table and change list. It appends under an "Added …" heading only when the page is not part of the SRS or the table is missing, and says so. Changing an existing FR
is not supported yet.

`--milestone` on `spawn` **declares the release these tickets ship in**: the milestone is created or reused, the version page is linked to it, and every ticket spawned joins it.

`--complexity <level>` on `spawn` labels every created Story whose FR page states no complexity (`bug`, `low`, `medium` or `complex`); an FR page's own Complexity wins. The summary lists any Story
left without one, which the workflow refuses to move out of Backlog.

## Common options

| Flag                | Description           | Default             |
| ------------------- | --------------------- | ------------------- |
| `--manifest <path>` | Manifest file to read | `.saasfoundry.json` |

## Exit codes

A shared contract across every action, so a script can branch on the reason rather than on a message:

| Code | Meaning                                                 |
| ---- | ------------------------------------------------------- |
| `0`  | success                                                 |
| `2`  | bad input                                               |
| `3`  | missing backend                                         |
| `4`  | unknown backend                                         |
| `5`  | runtime failure                                         |
| `6`  | write partial — the output carries a `rollbackHint`     |
| `7`  | write succeeded, but clearing `pendingIngestion` failed |

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
