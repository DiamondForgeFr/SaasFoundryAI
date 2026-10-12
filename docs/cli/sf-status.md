# sf status

Report the current SaaSFoundryAI project state and workflow preconditions (manifest, workflow, SRS module, git, optional GitHub CLI, agent instruction files).

## Usage

```bash
sf status [--json] [--agent-friendly | --claude-friendly] [--check-gh] [--no-network]
```

## Options

| Flag                | Description                                                               | Default |
| ------------------- | ------------------------------------------------------------------------- | ------- |
| `--json`            | Machine-readable JSON report (fails with exit code 1 on any `fail` check) | -       |
| `--agent-friendly`  | Markdown report for initialization in any agent host (exit code 0)        | -       |
| `--claude-friendly` | Compatible alias for `--agent-friendly`; existing hooks keep working      | -       |
| `--no-network`      | Skip network-dependent checks                                             | -       |
| `--check-gh`        | Probe for `gh` (GitHub CLI) availability in `$PATH`                       | off     |

## Preconditions

### Configuration

What the manifest declares, and whether the tooling around it is wired up.

| Name       | Checks                                                                               |
| ---------- | ------------------------------------------------------------------------------------ |
| `manifest` | `.saasfoundry.json` exists at the project root                                       |
| `workflow` | `workflow.tool` is set (non-`none`)                                                  |
| `srs`      | `tools.srs.enabled` with a `rootPage` configured (skipped when SRS is not installed) |
| `git`      | Project is a git repo and the working tree is clean                                  |
| `gh`       | GitHub CLI available in `$PATH` (only when `--check-gh` is passed)                   |

### Agent instructions

Whether the coding agents the project declares (`sf agents list`) read `AGENTS.md` whole. Each problem is a `warn`: the agent still starts, but without some or all of the project's rules, and nothing
in the host says so. A check is skipped when its agent is not declared.

| Name                   | Checks                                                                                                                                                                                                                                                                | Remediation                                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instructionShadowing` | Claude Code: no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` in the project, its app directories or any parent directory. Claude Code reads them instead of `AGENTS.md`; each one found is listed with its path                                              | Move its content into `AGENTS.md` and delete it. `sf update` does this for files an older harness left; a file above the project is yours to move |
| `claudeCodeVersion`    | Claude Code: the `claude` on `$PATH` is 2.1.277 or newer, the first release that reads `AGENTS.md`. Read with `claude --version`, locally, with no network call — also under `--no-network`. Skipped when `claude` is not on `$PATH`                                  | `claude update`                                                                                                                                   |
| `codexInstructionSize` | Codex: what Codex loads in the root and in each app directory with an `AGENTS.md` stays within 32 KiB, its default `project_doc_max_bytes`. The count adds every `AGENTS.md` (or `AGENTS.override.md`) from the Git root down, and the files they import with `@path` | Move detail into docs or skills that `AGENTS.md` names, or raise `project_doc_max_bytes` in `.codex/config.toml`                                  |

### Runtime

Whether the project can actually **run**, which a well-formed manifest says nothing about. A project can be perfectly configured and still have no `node_modules`, no database answering, and no ORM
client generated — and until these existed, `sf status` reported it as healthy.

| Name           | Checks                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `dependencies` | The root workspace in a monorepo, `api` and `web` otherwise                                                                                    |
| `database`     | Something answers on the port the manifest records. Skipped when the project does not host its own database, and when `--no-network` is passed |
| `ormClient`    | The generated Prisma client is present under the API                                                                                           |

All three are skipped on a project that is not a generated one — the CLI's own repository, for instance.

When any of them fails, [`sf resume`](/cli/sf-resume) is what finishes the job.

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
# Explicit initialization in any coding agent
sf status --agent-friendly --no-network
```

## Exit codes

- `0` — All preconditions pass, or either friendly flag was used (both preserve the hook-compatible non-failing exit behavior)
- `1` — At least one precondition has status `fail` (default or `--json` output)

Friendly output can contain failing preconditions even though its process exits successfully. The agent must read and act on those checks. When `--json` and either friendly flag are combined, JSON
output wins and the friendly exit behavior is retained, matching the legacy alias.

The listed skills are filesystem inventory; this report does not prove native skill discovery or hook execution. Use [`sf agents doctor`](./sf-agents.md#diagnosing-agent-capabilities) to distinguish
artifact checks from host capabilities.

## See also

- [`sf new`](./sf-new.md) — Create a new project (resolves a missing manifest)
- [`sf update`](./sf-update.md) — Install additional modules (resolves missing SRS setup)
- [`sf workflow`](./sf-workflow.md) — Configure the workflow tool
