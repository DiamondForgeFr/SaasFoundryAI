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
| `validate`     | Smoke-test the configured backend through `adapter.init()`                 |
| `browse`       | List the direct children of a parent page, as JSON                         |
| `draft`        | Produce draft material — from backend pages, or by scanning the codebase   |
| `write`        | Apply a `DraftCandidate[]` spec file through the adapter                   |
| `versions`     | List the versions the SRS declares — what a release scope is proposed from |
| `spawn`        | Turn an Epic page into tickets                                             |
| `normalize`    | Enumerate an Epic's FR pages and create Story sub-tickets                  |
| `apply-update` | Apply a conversational eval-hook patch (ADD-only)                          |
| `eval`         | Score SRS freshness against the codebase                                   |

### Details

```bash
sf srs validate [manifest]
sf srs browse --parent <id> [--manifest <path>]

sf srs draft --from notion-pages --ids <id1,id2,...> [--manifest <path>]
sf srs draft --from codebase [--path <dir>] [--manifest <path>]

sf srs write --spec <path> [--manifest <path>] [--no-clear-pending]
sf srs versions [--root-page <id>] [--manifest <path>]

sf srs spawn --epic <page-url-or-id> [--ticket <n>] [--version <title-url-or-id>]
             [--milestone <name>] [--dry-run] [--manifest <path>] [--bypass-reason <text>]

sf srs normalize [--feature <url-or-id>] [--version-name <name>] [--apply]
                 [--manifest <path>] [--root-page <id>]

sf srs apply-update [--patch <path>] [--manifest <path>]
sf srs eval [--path <dir>] [--root-page <id>] [--threshold <pct>] [--json] [--manifest <path>]
```

`--milestone` on `spawn` **declares the release these tickets ship in**: the milestone is created or reused, the version page is linked to it, and every ticket spawned joins it.

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
