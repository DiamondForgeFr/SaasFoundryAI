# sf status

Report the current SaaSFoundryAI project state and workflow preconditions (manifest, workflow, SRS module, git, optional GitHub CLI).

## Usage

```bash
sf status [--json | --claude-friendly] [--check-gh] [--no-network]
```

## Options

| Flag                | Description                                                               | Default |
| ------------------- | ------------------------------------------------------------------------- | ------- |
| `--json`            | Machine-readable JSON report (fails with exit code 1 on any `fail` check) | -       |
| `--claude-friendly` | Markdown report tailored for Claude Code SessionStart hooks (exit code 0) | -       |
| `--no-network`      | Skip network-dependent checks                                             | -       |
| `--check-gh`        | Probe for `gh` (GitHub CLI) availability in `$PATH`                       | off     |

## Preconditions

| Name       | Checks                                                                               |
| ---------- | ------------------------------------------------------------------------------------ |
| `manifest` | `.saasfoundry.json` exists at the project root                                       |
| `workflow` | `workflow.tool` is set (non-`none`)                                                  |
| `srs`      | `tools.srs.enabled` with a `rootPage` configured (skipped when SRS is not installed) |
| `git`      | Project is a git repo and the working tree is clean                                  |
| `gh`       | GitHub CLI available in `$PATH` (only when `--check-gh` is passed)                   |

## Examples

```bash
# Human-readable status (default)
sf status
```

```bash
# Machine-readable JSON — suitable for scripts
sf status --json
```

```bash
# Claude Code SessionStart hook usage
sf status --claude-friendly --check-gh
```

## Exit codes

- `0` — All preconditions pass, or `--claude-friendly` was used (it never fails)
- `1` — At least one precondition has status `fail` (default or `--json` output)

## See also

- [`sf new`](./sf-new.md) — Create a new project (resolves a missing manifest)
- [`sf update`](./sf-update.md) — Install additional modules (resolves missing SRS setup)
- [`sf workflow`](./sf-workflow.md) — Configure the workflow tool
