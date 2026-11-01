# sf status

Report the current SaaSFoundryAI project state and workflow preconditions (manifest, workflow, SRS module, git, optional GitHub CLI, agent instruction files, routing and tier agents).

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

`--json` also returns the facts behind these three checks under `instructions`: the effective agents, the shadowing paths, the Claude Code version read, and the bytes counted per directory with the
files that make them up.

### Delegation consent

On a project with a harness block, the agent-friendly output carries a `delegation:` line and `--json` a `delegation` object: the developer's consent to delegate ticket delivery to background agents
(see [`sf agents delegation`](./sf-agents.md#delegated-ticket-delivery-sf-agents-delegation)). A session learns it from the status it already reads at start-up. The line shows the effective answer,
the layer it comes from and its date, for example `delegation: allowed (shared, 2026-10-19T15:34:52.506Z)`. When a clone overrides the team's default it reads
`delegation: declined (local, <date>; shared team default: allowed)`, and `not-asked` while nobody answered. A corrupt local answer shows as `unreadable (…)` and never fails the status.

### Automatic routing

On the same projects, a `routing:` line (and a `routing` object in `--json`) says where the routing stands in this clone (see
[`sf agents routing`](./sf-agents.md#measured-delegations-and-the-adjusted-routing)). It starts with the grid and what the project replaces in it:
`grid v1, 2 overrides (multi-file-feature → plan; tier build for claude-code)` is the version of the grid this CLI ships, then one entry per kind that `modules.harness.routing` sends to another tier
and one per tier it gives other candidates (`grid v1, 0 overrides` when the project keeps the shipped routing). `--json` carries them in the `routing` object as `gridVersion` and `overrides`
(`{ kinds: [{ kind, tier }], tiers: [{ tier, providers }] }`), next to `tierAgents` ([below](#tier-agents)). The line goes on with the moves the adjustment made that nobody promoted yet, so a session
knows the route it gets is not the shipped one, for example
`routing: grid v1, 0 overrides; 1 local automatic adjustment not promoted (multi-file-feature → fix for claude-code, escalate on 2026-10-20; sf agents routing report, promote or reset)`. It names a
kind the adjustment looked at and cannot move (`terminal-ci (claude-code) held: top-of-ladder since 2026-10-20`) and counts the ones that only wait for evidence. It also says, for each declared coding
agent, whether the hooks that record every delegation are in place **and can run**: `claude-code capture enforced` only when the hook is declared and the project's own CLI answers
`agents outcome capture`; `capture hook declared but no CLI can run it` when it does not (install `saasfoundryai-cli` in the project, or put `saasfoundryai` on the PATH: until then delegations are not
recorded); `codex capture declared` when the hook is there but Codex has to trust it first; `capture hook outdated` for the bare-`sf` hook of an earlier build; `capture hook missing`
(`run sf agents refresh --scope shared`); or `not enforced` for a host without hooks, whose delegations are recorded by hand. A damaged local layer shows as `unreadable (…)` and never fails the
status.

### Tier agents

The delegation agents that [`sf agents refresh`](./sf-agents.md#tier-agents) writes under `.claude/agents/` and `.codex/agents/` each carry a model and an effort. Edit one, delete one, or move to a
CLI with a newer grid, and a delegation runs on a route the routing no longer says, with nothing in the host to tell. `tierAgents` compares every tier agent of the declared coding agents the grid
routes with what a refresh would write now, from the grid this CLI ships and `modules.harness.routing`. It only reads the files: it runs no project code and writes nothing. `--json` lists them under
`routing.tierAgents` as `{ path, state }`.

| State      | Meaning                                                                                                                                                                                                                                                                 | Remediation                                                                                                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`       | The file is exactly what a refresh would write                                                                                                                                                                                                                          | None                                                                                                                                                                                                                                     |
| `missing`  | The file does not exist                                                                                                                                                                                                                                                 | `sf agents refresh --scope shared`                                                                                                                                                                                                       |
| `outdated` | Nobody edited it: the file is what an earlier refresh wrote, and the grid or the overrides have moved on since                                                                                                                                                          | `sf agents refresh --scope shared`                                                                                                                                                                                                       |
| `edited`   | The file is neither the render nor a recorded baseline (`fileHashes` in `.saasfoundry.json`, or the private inventory of this clone for a tier agent a local setup wrote), or no baseline is recorded. A link, or any file a refresh refuses to touch, counts as edited | Restore it, or move the change to `modules.harness.routing`, then `sf agents refresh --scope shared`. A refresh never overwrites an edited tier agent: it writes a `.saasfoundry.new` sidecar, so delete the file to have it regenerated |

Any state other than `ok` is a `warn` of the `tierAgents` precondition, which lists the files and gives the remediation of each state. It also warns, with what to fix, when the tier agents cannot be
compared at all: overrides in `modules.harness.routing` that do not render, or a private inventory that cannot be read (`routing.tierAgentsIssue` in `--json`). It is skipped on a project without a
harness and when no declared coding agent has a tier agent.

### Local CI pipeline

When the project declares a local pipeline in `.molten/project.json` (MoltenTerm), a `local-ci:` line (and a `localCi` object in `--json`) names it with its job count:
`local-ci: MoltenTerm pipeline (11 jobs)`. The AI Testing step runs that pipeline (`molten ci run <branch>`) when `molten ci status` answers, and the npm suite otherwise. `sf status` only reads the
file: it never runs `molten` or any project code, and a damaged file shows as `unreadable`, without failing the status. The line is absent on a project that declares no pipeline.

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
