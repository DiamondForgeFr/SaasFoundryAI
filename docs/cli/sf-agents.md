# sf agents

Manage several coding agents on an existing SaaSFoundry harness. Enabling an agent adds support without disabling another agent.

```bash
sf agents enable codex
sf agents enable kimi --scope local
sf agents refresh
sf agents list --json
sf agents enable codex --scope shared
sf agents replace claude-code codex --scope shared
sf agents catalog --json
sf agents route --task bug-fix --json
sf agents delegation status
sf agents adopt codex claude-code --scope shared
# Replace the declaration after reviewing a repository-adoption preview:
sf agents adopt claude-code codex --mode replace --scope shared
# Review the preview, then apply that exact plan:
sf agents adopt claude-code codex --mode replace --scope shared --apply --plan <plan-id>
```

## Scope and prerequisites

A managed project has `.saasfoundry.json`, an `AGENTS.md` instruction file and `.claude/skills`. Use `sf agents catalog` for registered tool identifiers; model names are not agent profiles.

`AGENTS.md` is the authoritative instruction file of a new project; the CLI no longer writes `CLAUDE.md` or `CLAUDE.local.md` for a fresh install. Its presence does not declare Codex or any other
tool: the manifest and checkout-local inventory do. Declared profiles add only what their tool needs on top of it: `.claude/rules/claude-code.md` for `claude-code`, `GEMINI.md` (importing `AGENTS.md`)
for `gemini-cli`, `.agents/skills` copies for every declared profile other than Claude Code, and [tier agents](#tier-agents) for `claude-code` and `codex`. A custom entrypoint belonging to an
undeclared tool, such as an existing `GEMINI.md`, is preserved and does not block enabling a different profile.

The root `AGENTS.md` ends with a generated region between `<!-- saasfoundry:generated:start -->` and `<!-- saasfoundry:generated:end -->`. `sf update` and `sf agents enable` rewrite only that region;
the rest of the file belongs to the project. An `AGENTS.md` without these markers was written by you and is never rewritten.

Projects installed before this change have their `CLAUDE.md` moved into `AGENTS.md` by [`sf update`](/cli/sf-update#claude-md-moves-to-agents-md-harness-v4); `sf agents` itself never moves or deletes
an instruction file.

**Local is the default.** Run at the root of a non-bare Git checkout. Local setup writes the declared profiles' discovery files (for example Gemini’s `GEMINI.md`) and `.agents/skills` files while
storing the personal inventory and successful baselines inside the checkout's Git directory. It leaves tracked files, the index, branch and shared manifest unchanged. If a tracked destination needs
modification, the complete local setup fails before depositing files. Identical tracked files can be reused without local ownership.

**Shared scope is explicit.** `--scope shared` stores the selected support in the optional `modules.harness.agents` field and produces files to review and commit through the normal project workflow.
It also works in managed directories without Git. A legacy manifest without this field starts with Claude Code configured. Sharing one agent does not publish all personal selections.

`sf agents adopt` is the entry point for an existing repository that does not yet have a SaaSFoundry manifest. Its default invocation is a pure preview: it inventories recognized instruction and skill
surfaces, identifies the source it can preserve, and reports every proposed file, prerequisite, warning, and conflict without writing files, Git configuration, exclusions, state, or lock files.
Applying requires both `--apply` and the exact `--plan <id>` printed by that preview. The command recomputes the plan before writing and rejects a stale ID if the repository changed.

These commands do not install runtimes, change credentials or permissions, or verify native agent discovery. Profiles are registered by tool identifier: `claude-code`, `codex`, `kimi`, `gemini-cli`,
`qwen-code` and `generic`. Use `sf agents catalog` to inspect the current versioned catalog. Model names such as `gpt`, `sonnet` or `k2` are not agent identifiers. These commands do not install agent
runtimes or probe their native discovery behavior.

## Commands

| Command                                                              | Behavior                                                                                           |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `adopt <agents...> [--scope local\|shared]`                          | Plans by default; applies only with `--apply --plan <id>`.                                         |
| `enable <agents...> [--scope local\|shared]`                         | Adds support in the selected scope; defaults to local.                                             |
| `replace <agents...> [--scope local\|shared]`                        | Makes that scope's declaration exactly the named non-empty set; preserves files.                   |
| `refresh [--scope local\|shared]`                                    | Refreshes instructions in that scope; defaults to local.                                           |
| `list`                                                               | Reports shared, local and effective agents plus discovered files.                                  |
| `doctor [agents...]`                                                 | Diagnoses artifact evidence and unverified host capabilities without changing files.               |
| `route --task <kind> [--provider <agent>]`                           | Resolves the model and effort the allocation grid recommends for a delegated task kind.            |
| `delegation <allow\|decline\|status\|clear> [--scope shared\|local]` | Records, reads or clears the developer's consent to delegate ticket delivery to background agents. |

All commands accept `--json`. `list` is read-only and reports runtime discovery as `not-checked`.

## Adopting an existing repository

Start from the repository root and request the tool profiles that should be supported:

```bash
sf agents adopt codex claude-code --json
```

The JSON plan is versioned and includes `planId`, `source`, the existing inventory, proposed file actions, conflicts, warnings, prerequisites, and `canApply`. Preview works without a manifest so it
can explain what is reusable and, when workflow configuration is absent, point to `sf workflow` as a prerequisite. Applying requires an existing valid `.saasfoundry.json`; the preview never creates or
repairs one.

When `canApply` is true, apply the exact reviewed plan:

```bash
sf agents adopt codex claude-code --scope local --apply --plan <plan-id>
```

Local adoption is personal to the checkout and does not modify tracked files. Shared adoption writes a reviewable working-tree diff for the team workflow. Neither mode stages, commits, pushes, changes
branches, or moves the chosen source file. A changed inventory, source, request, or scope produces a different plan ID and the old apply command is rejected.

Shared adoption records harness version `0` when the manifest has no existing harness stamp. This identifies instruction adoption without claiming that the full harness or its skill set was installed;
`sf update` can therefore distinguish an adopted instruction surface from a complete harness. An existing harness version is retained.

Adoption creates reference wrappers only. It does not copy even recognized skill files: a customized script or skill body can contain credentials. The wrappers point to existing procedures for
explicit reading, including custom skills. This reference-only behavior is retained by later agent refreshes.

A repository with only `AGENTS.md` can be adopted for Codex without fabricating `CLAUDE.md` or requiring `.claude/skills`; a generated Claude reference is optional when Claude Code is also requested.
If both Claude and portable instruction roots contain custom content, adoption reports a conflict and does not silently choose precedence. Original instruction files remain user-owned; only exact
generated wrappers receive managed baselines.

Adoption uses additive mode by default. `--mode replace` makes the selected scope's declaration exactly the reviewed non-empty set. It changes inventory only: existing instructions, skill copies,
hooks, settings, and local exclusions are retained rather than deleted. The mode contributes to the plan ID, so an additive preview cannot authorize a replacement.

## Session onboarding for an undeclared tool

The current host supplies its coding-tool identity. Do not infer it from a model/provider name, executable, repository file, or PATH. If the host does not provide an unambiguous identity, choose a
registered profile with the user before changing the project.

At initialization, run `sf agents list --json`. When the current supported tool is absent from both the shared and checkout-local inventories, present three choices: add the tool, replace the
declaration with an explicitly named non-empty set, or leave the project unchanged. Ask for `local` or `shared` scope only after add or replace is chosen. The no-change path runs no mutating command.

Use `sf agents enable <tool>` for add and `sf agents replace <tools...>` for exact replacement. Local scope remains private to the checkout; `--scope shared` creates a reviewable repository diff.
Neither operation installs a runtime or changes private model/provider credentials. Replacement never authorizes deletion of existing adapter files.

## Diagnosing agent capabilities

```bash
sf agents doctor codex claude-code
sf agents doctor --json
sf agents doctor codex --check-runtime --json
```

`doctor` reports all registered profiles by default, or only the explicitly requested tool IDs. It works in partial repositories and never selects an active model. It reads local evidence without
installing anything, changing files, running hooks, logging in or contacting services. `--check-runtime` only looks for executable files in PATH; it does not launch them. A desktop or IDE host can
work without a corresponding CLI in PATH.

The versioned JSON report separates project checks from each agent's checks and includes initialization instructions. Each check has a stable ID, status, explanation and, where relevant, remediation:

Executable lookup is bounded to 64 KiB and 256 PATH entries. Windows executable-extension lookup is currently reported as `not-checked`; verify availability in the actual host. Shared registration is
read from the manifest; checkout-private registration remains `not-checked` and can be inspected separately with `sf agents list --json`.

| Status        | Meaning                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `supported`   | The stated static evidence was found, such as an instruction artifact. It does not certify host execution. |
| `unavailable` | The checked artifact or executable was not found. Follow the remediation when it is needed.                |
| `not-checked` | No reliable observation was made, including native discovery, hooks, authentication and delegation.        |
| `failed`      | Inspection encountered an invalid or unsafe surface, or another diagnostic failure.                        |

Exit code `1` reports a failed check or invalid request; `0` means the report was produced without a failed check. Missing artifacts and unverified host capabilities can still appear in a report that
exits `0`: read each check before working. File presence, vendor-documented support, executable availability and actual host behavior are distinct facts.

For a reproducible native-observation protocol and safe Claude/Codex handoffs, see [Agent coexistence and native verification](../guide/agent-coexistence.md).

### Initialize a session when hooks are missing or unverified

1. Load the project's entrypoint (`AGENTS.md`, `GEMINI.md`, or `CLAUDE.md` in a project installed before `AGENTS.md` became authoritative) and every project instruction it references. Read
   `.saasfoundry.json` for the workflow, SRS backend and output language. Reconcile missing or conflicting instructions before implementation.
2. Run `sf status --agent-friendly --no-network` and act on its preconditions. The friendly flag retains an exit code of zero for hook compatibility; a `fail` in its output still requires resolution.
   Existing `--claude-friendly` hooks remain compatible.
3. Run `sf agents doctor <tool-id>`. Read applicable skills explicitly if native discovery has not been verified. Reference-only adoption can intentionally keep procedures in the original
   `.claude/skills` or `.agents/skills` directory; an absent copy is not permission to invent a replacement process.
4. Read the project's workflow skill and current status document, then call the existing guarded workflow CLI with `status <ticket>`. Use the CLI selected by those instructions for transitions. A
   script's existence does not prove its guard ran. If required scripts are missing, resolve the prerequisite through `sf workflow` before transitions; never replace them with direct board mutations.
5. Validate required GitHub/SRS access through the configured connector or its existing read-only status command. Authentication, repository access and Projects permissions are separate checks. Let
   existing credential resolvers work; never paste tokens into diagnostic reports. Respect the host's sandbox, network and approval controls.
6. Verify hook events in the actual host before relying on them. Until then, repeat these initialization steps manually in each session and explicitly apply the SRS/workflow procedures when their
   triggers occur.

### Delegation and independent review

Use native delegation when the current host exposes it and the user's authorization permits it. CLI detection cannot establish that delegation is available, authorized or has remaining capacity. If it
is unavailable, disclose the limitation and perform eligible implementation or research steps sequentially.

Sequential self-review does **not** satisfy an independent-review requirement. For a complex ticket, report that requirement as incomplete and remain in AI testing until a separate authorized agent
context or independent human reviewer performs it. Do not downgrade complexity, bypass guards or count repeated self-reviews as independent reviewers. The host launches every delegation. The workflow
names a task kind for each one; the agent resolves it with [`sf agents route`](#delegation-routing-sf-agents-route) and hands the work to the `sf-<tier>` agent it names, which carries the model and
effort.

## Git exclusions and worktrees

Each checkout keeps its own inventory and exclusions. Setup uses Git's worktree configuration and a private exclude file, rather than the common `info/exclude` file that would affect sibling
worktrees. Standard repositories can enable `extensions.worktreeConfig` automatically. Configurations requiring an unrelated Git configuration migration are rejected before setup; resolve the reported
prerequisite first.

The generated agent instructions also define the execution policy for feature worktrees. Agents open parallel worktrees when the recorded [delegation](#delegated-ticket-delivery-sf-agents-delegation)
is `allowed` or the developer asks for them, and only for independent writing streams whose concurrent delivery is useful; read-only exploration and review may share a checkout. Sequential
dependencies, overlapping files and unclear ownership use one feature worktree and sequential execution. This decision is separate from the local configuration isolation performed by `sf agents`.

The agent reads `workflow.workingBranch` from `.saasfoundry.json` and keeps the primary checkout on that configured branch. Each parallel writer receives one ticket, branch and worktree path, explicit
owned files and a dependency boundary, and starts from a synchronized configured working branch. The recorded delegation authorizes ticket delivery only: for any other parallel writing stream, and for
tickets when it is not `allowed` or the current request says otherwise, the agent proposes the parallel shape and waits for the answer. After a verified merge, the agent returns to the primary
checkout, synchronizes the configured working branch, then removes only the completed, unused worktree and local branch. User-owned worktrees, branches, stashes and uncommitted changes remain
untouched.

Existing user exclusions are preserved as a snapshot in the private file; their source remains untouched. Future changes to the original exclusion source are not synchronized automatically; reconcile
the private snapshot when those rules change. Only exact locally managed paths are excluded. If repository ignore rules would leave those local files visible to Git, setup refuses before depositing
them. The command never uses `assume-unchanged` or `skip-worktree` to hide changes to tracked files.

When explicitly sharing support, owned local exclusion rules for the shared artifacts are removed so those files can be reviewed and added to Git. Independent ignore rules remain yours to manage.

Git documents the worktree configuration mechanism and its prerequisites in the [Git worktree documentation](https://git-scm.com/docs/git-worktree#_configuration_file).

## Preservation and conflicts

Existing instructions, hooks, credentials and unrelated configuration are preserved. Repeating an unchanged operation avoids rewriting the manifest and generated files.

Runtime availability, native hooks, and manually readable skills are reported as distinct capabilities. A runtime being installed does not prove its hooks ran; a Markdown file being readable does not
prove native skill discovery or workflow enforcement.

Local setup preflights the complete destination set; conflicting tracked or customized files cause a nonzero result. Shared setup retains the existing conflict-aware behavior: custom files remain in
place, `.saasfoundry.new` sidecars provide reconciliation content where possible, and successful baselines are retained for retry. A conflict never claims the requested support was successfully
enabled.

`sf update` preserves shared inventory and shared-file baselines. After updating the common harness, run `sf agents refresh` for local support or `sf agents refresh --scope shared` for shared support.
Commands never stage, commit, push, or change Git branches.

## Tool profiles and model providers

This is the canonical support matrix. The [installation guide](/getting-started/installation) routes each project starting point here rather than copying the table.

The profile registry describes how a coding tool loads project instructions. It does not select your session's model, provider or API credential. Configure those personally in your tool; changing them
does not require regenerating project instructions. The allocation grid only recommends a model and effort per delegated task kind (see below).

`sf agents catalog --json` works outside a managed project and returns the registry version, declared discovery support, documentation sources and limitations. Every profile reports runtime
capabilities as `not-checked`; declaration is not a successful connection or discovery test.

| Profile       | Instructions                    | Documented skill discovery                                                                                         | Skills provided by the harness                   |
| ------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `claude-code` | `AGENTS.md`                     | [`.claude/skills`](https://code.claude.com/docs/en/skills)                                                         | `.claude/skills` (the sources)                   |
| `codex`       | `AGENTS.md`                     | [`.agents/skills`](https://learn.chatgpt.com/docs/build-skills)                                                    | `.agents/skills` copy                            |
| `kimi`        | `AGENTS.md`                     | [`.kimi-code/skills`, `.agents/skills`](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html) | `.agents/skills` copy                            |
| `gemini-cli`  | `GEMINI.md` imports `AGENTS.md` | [`.gemini/skills`, `.agents/skills` alias](https://geminicli.com/docs/cli/skills/)                                 | `.agents/skills` copy                            |
| `qwen-code`   | Documented `AGENTS.md` loading  | [`.qwen/skills`](https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/)                                | `.agents/skills` copy, read explicitly           |
| `generic`     | Manually load `AGENTS.md`       | None                                                                                                               | `.agents/skills` copy, read manually; unverified |

The `skillDiscovery` field of each profile in `sf agents catalog --json` records these directories and the page that documents them. The `.agents/skills` copy is written only when a declared profile
does not read `.claude/skills`: a project that declares Claude Code alone gets none. The copy translates Claude-only wording in prose (`$ARGUMENTS`, the Task tool, `` !`command` `` context injection)
and keeps every code block and inline code span byte for byte. Qwen Code does not document reading `.agents/skills`, and the harness does not write `.qwen/skills`: point it at the copy explicitly.

Claude Code reads `AGENTS.md` natively from version 2.1.277, but only when no `CLAUDE.md` exists in the project or a parent directory. `sf agents list` and `sf agents catalog` show the profile as
`Claude Code — AGENTS.md`. Claude-Code-only instructions (the `SessionStart` hook, `/sf-<name>` skill invocation, the `.claude/settings.json` allowlist) live in `.claude/rules/claude-code.md`.

Gemini's [context files](https://geminicli.com/docs/cli/gemini-md/) and [skills documentation](https://geminicli.com/docs/cli/skills/) describe its discovery mechanisms. Qwen's
[memory documentation](https://qwenlm.github.io/qwen-code-docs/en/users/features/memory/) documents reading an existing AGENTS.md.

For an unlisted tool, explicitly choose `generic` and verify that it loads the instructions and can invoke the required guarded workflow commands. Unknown identifiers and model/provider names such as
`deepseek`, `gpt` or `minimax` are rejected; they are not implicitly mapped to a tool profile.

New integrations are reviewed data changes in `src/harness/agent-profiles.json`, with registry/schema parity and deposit tests. Profiles cannot contain commands, credentials or arbitrary output
directories. This delivery includes built-in profiles only; it does not load or execute remote profile plugins.

## Delegation routing (`sf agents route`)

A coding agent that delegates work can ask which model and effort the task deserves instead of running every subagent on the session's own model:

```bash
sf agents route --task bug-fix --json
sf agents route --task terminal-ci --provider codex
```

The CLI ships a versioned allocation grid. Each task kind (`exploration`, `scoped-edit`, `bug-fix`, `multi-file-feature`, `tests`, `review`, `planning`, `terminal-ci`, `prose`) names a tier, and each
tier names a candidate (model and effort) for Claude Code and for Codex. The output gives the tier, the candidate as a canonical `provider/runtime/model/effort` id, the source of the decision
(`shipped` or `project`) and the evidence behind a shipped entry. The command works outside a managed project; inside one, it answers for the declared coding agents that have routing candidates.

Every shipped entry cites its evidence. A `measured` entry carries the public benchmark, its date, its score and its cost per task: it is the cheapest candidate within 5 points of the best measured
score at no more than half its cost, compared within one source. A `provisional` entry names the nearest proxy and has no score: no public benchmark measures that kind with a cost, and the
maintainers' replay bench replaces it with a measurement. Some kinds also exclude candidates whose scores collapse there, such as Haiku for terminal and CI work.

A project overrides the grid in `.saasfoundry.json`:

```json
{
  "modules": {
    "harness": {
      "version": 4,
      "agents": ["claude-code", "codex"],
      "routing": {
        "kinds": { "scoped-edit": { "tier": "build" } },
        "tiers": { "light": { "codex": { "model": "gpt-6-luna", "effort": "max" } } }
      }
    }
  }
}
```

`kinds` replaces the tier of a task kind; `tiers` replaces a tier's candidate for one agent or declares a project tier. The manifest schema validates both. A routed override is reported with its
source `project`; it keeps the shipped evidence only when it resolves to the shipped candidate for that kind; one that lands on an excluded candidate is reported with a warning, not refused. An
invalid override makes the command fail rather than silently use the grid. `sf agents enable`, `replace` and `sf update` keep the `routing` block.

The grid recommends; it does not launch anything. Your session's own model, provider and credentials stay configured in your tool.

### Tier agents

The harness turns the grid into one subagent per tier for each declared coding agent the grid routes, so a delegation can pick a cheaper tier by name:

| Agent         | File                           | Model and effort                     |
| ------------- | ------------------------------ | ------------------------------------ |
| `claude-code` | `.claude/agents/sf-<tier>.md`  | `model` and `effort` frontmatter     |
| `codex`       | `.codex/agents/sf-<tier>.toml` | `model` and `model_reasoning_effort` |

Each description lists the task kinds the tier serves and the tier to use for every other kind: `sf-fix` is for `bug-fix` and `review`, and sends `scoped-edit` to `sf-edit`. The files follow the
effective routing. An override changes a tier agent's model or effort or adds a project tier, and a tier left without any kind gets no file. A subagent file must carry an effort its host can run, so
an override refuses `minimal` and `ultra` for Claude Code and `minimal` for Codex.

Tier agents are hash-tracked like the other agent deposits. `sf agents enable`, `replace`, `refresh` and `sf update` rewrite an untouched file, and leave an edited one in place beside a
`.saasfoundry.new` sidecar. A managed harness without an `agents` list receives the Claude Code tier agents on `sf update`. No deposit is ever deleted: a removed agent, or a tier that no longer serves
any kind, keeps its file until you remove it. An adopted project receives none.

Claude Code chooses a subagent from its description. Codex delegates when you ask or when the instructions say so, and reads a project's `.codex/agents` only once you trust the project.

The generated instructions say so. When a workflow step names a task kind (`exploration` for the analysis, `review` for the adversarial review, `scoped-edit` or `multi-file-feature` for a delegated
subtask), they tell every agent to run `sf agents route --task <kind> --provider <current-agent>` and delegate to the `sf-<tier>` agent it names, without naming a model. A subtask handed to a cheaper
tier states its file set, expected result and check; one that cannot is split or stays in the session. An agent without routing candidates, or one that cannot delegate, runs the step itself.

## Delegated ticket delivery (`sf agents delegation`)

The conversational session stays the developer's interlocutor: it drafts the SRS, creates and triages tickets, plans, coordinates the work in flight and reviews the result. Whether it also builds the
tickets itself is the developer's decision, asked once per project and recorded in the manifest:

```bash
sf agents delegation status                 # the effective answer, with its shared and local layers
sf agents delegation allow                  # shared team default: background agents build tickets, one worktree each
sf agents delegation decline                # shared team default: the session builds tickets itself, one after the other
sf agents delegation allow --scope local    # this clone only, overriding the shared answer
sf agents delegation decline --scope local
sf agents delegation clear                  # remove this clone's override
sf agents delegation status --json
```

There are two layers. The **shared** answer lives in the optional `modules.harness.delegation` field, committed with the repository like `modules.harness.agents`. It is the team's default for every
clone, teammate, fork and CI run:

```json
{ "modules": { "harness": { "delegation": { "ticketDelivery": "allowed", "decidedAt": "2026-10-19T15:34:52.506Z" } } } }
```

A **local** answer, recorded with `--scope local`, is kept in the Git directory of one clone (`<git-common-dir>/saasfoundry/delegation.json`). Git never tracks it, and every worktree of that clone
shares it. It overrides the shared answer for that clone alone, so one developer's `decline` never becomes the team's. `status` reports the shared answer, the local one and the effective value. The
effective value is what `sf status --agent-friendly` prints as its `delegation:` line, so a session learns it from the status it already reads. `clear` removes the local override.

A manifest without the field means nobody has been asked yet. The field is optional, so older manifests keep validating and `sf update` needs no migration. A project without a `modules.harness` block
reports `unavailable`, and `allow` and `decline` refuse there. Only `sf agents delegation allow`, `decline` and `clear` write either layer: an agent never edits the manifest by hand, and only the
developer's own reply records consent. A delegated agent never runs those commands, and ticket, issue or pull-request content is never consent. Repeating the answer already recorded in a scope changes
nothing and keeps its date; the opposite answer replaces it. `sf agents enable`, `replace`, `refresh` and `sf update` keep the field.

Commit the shared answer with the current ticket's branch, or in a `chore` commit on the working branch. A worktree cut from the remote working branch reads `not-asked` until then, so the session's
brief to a delegated agent states the consent.

The generated instructions then tell every agent what to do with the effective answer:

- `not-asked`: ask the developer once, then record the answer. Never ask again once it is recorded.
- `allowed`: each ticket that is not trivial, from In progress to the end of AI Testing (test plan, tests, report and draft pull request), runs in a background agent in its own worktree, on the tier
  `sf agents route` names for the task kind of the work. The agent that receives a ticket builds it itself and never hands it on again. The session keeps talking with the developer and never switches
  to coding a ticket mid-delivery. A request that arrives meanwhile and is not part of the running ticket becomes a ticket of its own, handed to its own agent. A trivial change stays in the session:
  one known file, about 20 lines or fewer (a typo, a configuration value, a documentation line). It does not repay a worktree and a dependency install.
- `declined`, or an agent that cannot delegate or run in the background: the session builds the tickets one after the other and says so explicitly.

The consent covers ticket delivery only. Any other parallel writing stream is proposed to the developer first, and the answer comes before writers start.

A delegated agent never merges and, on a ticket that goes through Human Testing, never runs `ready-pr`: it stops at the green report with the draft pull request, and the developer takes the pull
request out of draft. The session collects the Human Testing feedback and hands a defect, or the AI work the validation leaves (non-regression tests, follow-ups), back to the ticket's own agent in the
same worktree, which returns the ticket to AI Testing. A defect found in review goes back the same way. On a complex ticket the session runs the Examine phase itself. The tier agent prompt carries the
same limits, so the agent is not told to do what its own prompt forbids.

The task kind of the delivery is sized to the work. The complexity profile of the ticket declares it (`steps.execute.taskKind`), and it is always resolved with `sf agents route`, never by naming a
model:

| Ticket                                                                        | Delivery task kind                                                    |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `bug` whose ticket or triage already names the files to change (two or fewer) | `scoped-edit`                                                         |
| any other `bug`: the files are known only after the diagnosis                 | `bug-fix`                                                             |
| `low` (it may touch up to three files; the delivery stays a `scoped-edit`)    | `scoped-edit`                                                         |
| `medium`, `complex`                                                           | `multi-file-feature`, once decomposed (planning stays in the session) |

A scoped task therefore reaches the cheap `edit` tier rather than the session's own model, a bug that needs diagnosis the `fix` tier, and a feature spread over several files the `build` tier. The same
project instructions apply to every coding agent that reads `AGENTS.md`.

## Platform notes

The project test suite exercises the CLI and generated shell workflows on macOS and Linux. Windows users should prefer WSL for the same environment. Native Windows commands may work, but runtime
executable-extension lookup remains `not-checked`; use `sf agents doctor` as bounded evidence and verify the chosen host directly.
