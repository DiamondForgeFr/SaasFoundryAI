# GitHub Labels — Feedback Loop

The `sf feedback` command family expects these labels to exist on the SaaSFoundry upstream repository (`DiamondForgeFr/SaaSFoundry`). They're used for issue classification, dedup search, and voting
filters.

## Labels used by `sf feedback`

| Label            | Color     | Purpose                                                                                                |
| ---------------- | --------- | ------------------------------------------------------------------------------------------------------ |
| `module-request` | `#0e8a16` | A user-filed request for a new module or optional skill. Sortable by 👍 for `sf feedback vote --list`. |
| `cli-bug`        | `#b60205` | A bug in the `sf` CLI itself (commands, prompts, non-interactive flags, etc.).                         |
| `scaffold-bug`   | `#d93f0b` | A bug in generated project code (scaffolds/blueprints/overlays/modules).                               |

## One-time setup on a fresh fork or repo

Run once, from anywhere (requires `gh auth login`):

```bash
gh label create module-request --repo DiamondForgeFr/SaaSFoundry --color 0e8a16 --description "User-filed module request" || true
gh label create cli-bug        --repo DiamondForgeFr/SaaSFoundry --color b60205 --description "Bug in the sf CLI"       || true
gh label create scaffold-bug   --repo DiamondForgeFr/SaaSFoundry --color d93f0b --description "Bug in generated code"   || true
```

The `|| true` makes the command idempotent — existing labels return a non-zero exit code but we don't want to fail the script.

## How the CLI uses these labels

- **`sf feedback request`** creates issues with `module-request` and searches existing `module-request` issues to dedup.
- **`sf feedback bug --source cli`** creates with `cli-bug`; `--source scaffold` uses `scaffold-bug`. Both search their own label for dedup.
- **`sf feedback list`** filters by all three labels by default and shows them in a single table.
- **`sf feedback vote --list`** ranks open `module-request` issues by 👍 reaction count.

## Not managed here

- `complexity: {bug,low,medium,complex}` — internal workflow labels, managed by `sf-tool-github-projects` (see `.claude/skills/sf-tool-github-projects/`).
- Any custom label a maintainer adds manually — the CLI ignores unrecognized labels.
