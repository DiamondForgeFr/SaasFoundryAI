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

**An unregistered name is refused, with a hint when it is close to a registered one.** `enable`, `replace`, `adopt`, `list` (a manifest that declares the name) and `route --provider` refuse a name
that no profile registers and exit non-zero. When the name differs from a registered id or display name only by case, punctuation or one typo (`kimi-code`, `Kimi`, `kimi_code`), the message adds
`Did you mean kimi?`:

```text
'kimi-code' is not a registered coding agent. Did you mean kimi? Routed coding agents: claude-code, codex, kimi.
```

The hint is only a suggestion. sf never accepts, infers or aliases the name: run the command again with the registered id. A name with no close match, such as `moonshot` or `gpt-5`, is refused without
a suggestion.

## Commands

| Command                                                              | Behavior                                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `adopt <agents...> [--scope local\|shared]`                          | Plans by default; applies only with `--apply --plan <id>`.                                                   |
| `enable <agents...> [--scope local\|shared]`                         | Adds support in the selected scope; defaults to local.                                                       |
| `replace <agents...> [--scope local\|shared]`                        | Makes that scope's declaration exactly the named non-empty set; preserves files.                             |
| `refresh [--scope local\|shared]`                                    | Refreshes instructions in that scope; defaults to local.                                                     |
| `list`                                                               | Reports shared, local and effective agents plus discovered files.                                            |
| `doctor [agents...]`                                                 | Diagnoses artifact evidence and unverified host capabilities without changing files.                         |
| `route --task <kind> [--provider <agent>]`                           | Resolves the model and effort the allocation grid recommends for a delegated task kind.                      |
| `delegation <allow\|decline\|status\|clear> [--scope shared\|local]` | Records, reads or clears the developer's consent to delegate ticket delivery to background agents.           |
| `outcome <record\|mark\|capture\|status-event>`                      | Records what a routed delegation cost and whether it did the job, ties a later signal to it, times a ticket. |
| `routing <adjust\|promote\|report\|reset>`                           | Adjusts the routing from those outcomes, shares a move, reports the outcomes, undoes a move.                 |
| `guard --host <claude-code\|codex>`                                  | Run by the `PreToolUse` hook: refuses the tool calls an agent must not make on its own.                      |
| `shell-guard <refuse\|warn\|off\|status>`                            | Records or reads what the guard does with a shell line that is not one plain command.                        |

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
   The `--claude-friendly` alias remains accepted; a session-start hook that runs the bare `sf status --claude-friendly --no-network` is replaced by a refresh with one that runs the project's own CLI
   ([the session-start hook](/cli/sf-status#the-session-start-hook)).
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
`sf update` itself keeps `.claude/settings.json` current (the delegation capture hooks and the permission rules), so a refresh is no longer required after an update for that file; see
[Delegation capture and permissions](/cli/sf-update#delegation-capture-and-permissions-harness-v5). Commands never stage, commit, push, or change Git branches.

## Tool profiles and model providers

This is the canonical support matrix. The [installation guide](/getting-started/installation) routes each project starting point here rather than copying the table.

The profile registry describes how a coding tool loads project instructions. It does not select your session's model, provider or API credential. Configure those personally in your tool; changing them
does not require regenerating project instructions. The allocation grid only recommends a model and effort per delegated task kind (see below).

`sf agents catalog --json` works outside a managed project and returns the registry version, declared discovery support, documentation sources, limitations and the
[capability block](#the-capability-block-of-a-profile). Every profile reports runtime capabilities as `not-checked`; declaration is not a successful connection or discovery test.

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
[memory documentation](https://qwenlm.github.io/qwen-code-docs/en/users/features/memory/) documents reading an existing AGENTS.md. Kimi Code's
[agents documentation](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents.html) names `AGENTS.md` in the project tree as an instruction file, so its profile reads `documented` and no
longer asks you to load the file by hand; the profile still reports `runtime: not-checked`, and the [hooks documentation](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/hooks.html) is
why the harness installs no hook for it (see [Kimi Code](#kimi-code)).

For an unlisted tool, explicitly choose `generic` and verify that it loads the instructions and can invoke the required guarded workflow commands. Unknown identifiers and model/provider names such as
`deepseek`, `gpt` or `minimax` are rejected; they are not implicitly mapped to a tool profile.

New integrations are reviewed data changes in `src/harness/agent-profiles.json`, with registry/schema parity and deposit tests. Profiles cannot contain commands, credentials or arbitrary output
directories. This delivery includes built-in profiles only; it does not load or execute remote profile plugins.

### The capability block of a profile

Beyond how a tool loads instructions and skills, each profile declares what the harness does for that tool in a `capabilities` block. The routing providers, the efforts a tool can write, the
tier-agent folders and formats, the hook files and the wording of `sf status` are all read from it: no other source names Claude Code or Codex to decide them, so a new tool is first a data change.

| Field         | Says                                                                                                                                                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routing`     | `{ vendor, efforts }`: the grid has candidates for the tool, filed under this vendor, and a tier-agent file of the tool can express these efforts. `null` without                                                                                                      |
| `tierAgents`  | `{ dir, format, modelBinding }`: the project folder of the tool's subagent files, their file format (`claude-md`, `codex-toml`, `kimi-md`) and whether the model is written in the file (`file`) or chosen per call (`call-alias`). `null` without. Needs `routing`    |
| `hooks`       | `{ scope, file, guardEvent, captureEvent, needsTrust }`: the file that declares the tool's hooks (`project` or `user` scope), the events of the guard and the capture hook, and whether the tool runs a project hook only once the developer trusts it. `null` without |
| `worktrees`   | `native` (the tool isolates a delegate in a worktree itself), `manual` (the session opens it with Git) or `none`                                                                                                                                                       |
| `limitations` | The reason for every capability the tool lacks, keyed by capability name                                                                                                                                                                                               |

**The rule for a missing capability.** A profile that lacks a capability (a `null` block, or `worktrees` other than `native`) must say why in `limitations`, and says nothing for a capability it has:
the registry refuses a profile that breaks either half. Every command that needs the capability then names that reason instead of a bare "no routing". `sf agents route --provider gemini-cli` answers
`gemini-cli (Gemini CLI) cannot be routed: The harness ships no routing candidates for Gemini CLI, so sf agents route cannot name a tier for it. Routed coding agents: claude-code, codex, kimi.`, and
`sf status` says a guard or a capture is `unavailable (<reason>)` for a tool whose profile declares no hooks. An id that no profile registers is said to be unregistered. `sf status` reads a hook as
`enforced` when the harness installs it and the tool runs it, `declared` when the tool must trust it first (`needsTrust`), and `not enforced` for a tool whose profile has hooks that nothing runs.

Only the file formats differ in code: each `tierAgents.format` has one renderer over the same tier-agent model (name, description, model, effort, instructions), and a format without a renderer does
not compile. Everything that only differs in value (a folder, an effort list, an event name) is a field of the profile. The block adds no field to `.saasfoundry.json`, so it needs no manifest
migration.

## Delegation routing (`sf agents route`)

A coding agent that delegates work can ask which model and effort the task deserves instead of running every subagent on the session's own model:

```bash
sf agents route --task bug-fix --json
sf agents route --task terminal-ci --provider codex
```

The CLI ships a versioned allocation grid. Each task kind (`exploration`, `scoped-edit`, `bug-fix`, `multi-file-feature`, `tests`, `review`, `planning`, `terminal-ci`, `prose`) names a tier, and each
tier names a candidate (model and effort) for Claude Code, for Codex and for Kimi Code. The output gives the tier, the candidate as a canonical `provider/runtime/model/effort` id, the source of the
decision (`shipped` or `project`) and the evidence behind a shipped entry. A host whose tier-agent file binds no model, Kimi Code, also gets the model alias the call passes (see
[Kimi Code](#kimi-code)). The command works outside a managed project; inside one, it answers for the declared coding agents that have routing candidates. A coding agent without routing is refused
with the limitation its profile documents (see [the capability block](#the-capability-block-of-a-profile)), never with a bare "no routing".

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

The answer also reflects the project's own runs (see [Measured delegations](#measured-delegations-and-the-adjusted-routing)). The order is the developer's shared override in `modules.harness.routing`,
then the moves the automatic adjustment made in this clone (source `auto`, with the move and its rule in `adjustment`), then the shipped grid. Within the declared share of a kind's runs, the answer is
the cheaper tier below the routed one (or a new stronger candidate above it) and says so with `trial: true` and `effectiveTier`; delegate to that tier. `--no-trial` answers the routed tier, for
display. `--record` (with `--ticket`, `--complexity`, `--nature`, `--retry-of`) issues a **route record** for a delegation that is measured: it prints `route=<id>` to put in the brief, and reserves
the trial it hands out (see [Route records](#route-records)). With `--ticket` and no `--complexity` (or `--nature`), the value is read from the ticket's labels. A damaged ledger or local layer is
reported on stderr and the shared routing answers.

### Kimi Code

Kimi Code is routed by its profile and the grid (`routing: { vendor: "moonshot", efforts: ["low", "high", "max"] }`), and writes tier agents from its profile too
(`tierAgents: { dir: ".kimi-code/agents", format: "kimi-md", modelBinding: "call-alias" }`): no command has a branch for it, and only its file format has a renderer. Its candidates are
`moonshot/kimi/<model>/<effort>`:

| Tier       | Task kinds                    | Candidate (model, effort) |
| ---------- | ----------------------------- | ------------------------- |
| `light`    | `exploration`, `prose`        | `k3`, `low`               |
| `edit`     | `scoped-edit`                 | `k3`, `high`              |
| `build`    | `multi-file-feature`, `tests` | `k3.1-pro`, `high`        |
| `fix`      | `bug-fix`, `review`           | `k3.1-pro`, `high`        |
| `plan`     | `planning`                    | `k3.1-pro`, `high`        |
| `terminal` | `terminal-ci`                 | `k3.1-pro`, `max`         |

- **Every Kimi route is provisional.** No public benchmark measures these candidates with a cost, so each entry has no score and no cost, and `sf agents route` says so in its evidence
  (`provisional: No Kimi measurement exists yet; …`). The maintainers' replay bench replaces them with measurements. The `highspeed` aliases are not used: they bill twice.
- **Efforts.** Kimi Code expresses `low`, `high` and `max`. A project override of a Kimi tier at any other effort (`minimal`, `medium`, `xhigh`, `ultra`) is refused, naming the three it accepts.
- **Tier agents, and the model alias a route names.** `sf agents refresh` writes `.kimi-code/agents/sf-<tier>.md` for every tier: a Markdown file whose frontmatter has `name`, `description`,
  `whenToUse` and an explicit `tools` list (the same for every tier, ending with `mcp__*` so the MCP tools of the session reach the delegate), and whose body is `${base_prompt}` (the default Kimi Code
  system prompt) followed by the instructions every tier agent carries. **The file names no model and no effort**: Kimi Code binds no model in an agent file. A call to the `Agent` tool passes
  `model: <alias>`, a key of your own `[secondary_model.models]` pool, so the route names the alias, and the session copies it:

  ```text
  bug-fix → fix (shipped) kimi: k3.1-pro, effort high, alias sf-k3-1-pro-high — provisional: …  route=<id>
  ```

  `--json` adds `alias` to the route and `aliasPool` (`present`, `missing` or `unknown`: whether your pool declares it). Both fields are optional and additive, so `routeVersion` stays 2; a Claude Code
  or Codex route carries neither. The alias is named after the candidate, not the tier (`sf-<model>-<effort>`, with a dot in the model name written as `-`), so it follows an override of the tier's
  candidate, and two tiers on one candidate share one alias:

  | Alias              | Candidate (model, effort) | Tiers                  |
  | ------------------ | ------------------------- | ---------------------- |
  | `sf-k3-low`        | `k3`, `low`               | `light`                |
  | `sf-k3-high`       | `k3`, `high`              | `edit`                 |
  | `sf-k3-1-pro-high` | `k3.1-pro`, `high`        | `build`, `fix`, `plan` |
  | `sf-k3-1-pro-max`  | `k3.1-pro`, `max`         | `terminal`             |

- **sf never writes your Kimi Code configuration.** Your `~/.kimi-code/config.toml` (or `$KIMI_CODE_HOME/config.toml`) holds your credentials and your pool, and belongs to you. The CLI only **reads**
  it, to learn the key names of `[secondary_model.models]` and, when a snippet needs them, the `provider`, `max_context_size` and `capabilities` of your entry for the same model; it never reads a
  value such as an `api_key` into anything it prints. When an alias is missing from your pool, `sf agents route` prints the TOML to paste on stderr, and `sf agents enable`, `replace` and `refresh` say
  the same in a warning (and in the `report.warnings` of `--json`). The snippet gives the `[models.<alias>]` tables first, because a pool key that points at no entry makes Kimi Code fail at start,
  then the lines to add **under your existing** `[secondary_model.models]` table, never a second header for it. A pool you have not declared yet gets the `[secondary_model]` and
  `[secondary_model.models]` tables whole, with a placeholder for the `default_model` that must be one of its keys. A config that cannot be read (not a file, not UTF-8 text, larger than 1 MiB) is
  `unknown`: the route still names the alias, and the snippet is printed as if nothing were declared. If `[secondary_model].default_effort` is set it outranks the effort of every alias, and the CLI
  says so. With a single-entry pool Kimi Code does not advertise the `model` parameter at all.
- **Worktrees opened with git, like Codex.** The profile says `worktrees: manual`: a Kimi Code lead with delegation `allowed` opens one worktree per ticket with git (`git fetch origin`, then
  `git worktree add <path> -b <branch> origin/<workingBranch>`) and delegates the ticket to its `sf-<tier>` agent there, so each Kimi tier agent carries the same whole-ticket delivery line as the
  Claude Code and Codex ones. This is decided from the profile data, with no branch for Kimi Code in the renderer. Until #1332 the profile said `worktrees: none` and a Kimi lead built tickets in the
  current checkout, which switched a checkout another lead shared.
- **Not checked in a real session.** The profile keeps `runtime: not-checked`: that Kimi Code resolves `subagent_type: "sf-<tier>"` and honours the alias on a call is declared from its documentation,
  not verified here.
- **No hook.** Kimi Code reads its hooks from the user's own configuration only, never from the project, so the harness installs no guard and no capture hook. `sf status` says
  `kimi guard unavailable (…)` and `kimi capture unavailable (…; record its delegations with sf agents outcome record)`. The CLI's own guards still refuse an escape hatch; nothing stops an agent from
  setting one before it reaches them.
- **No host-native worktree.** Kimi Code has no worktree tool the harness uses, so the session opens the worktree itself and hands the delegate its path (`limitations.worktrees`). A refused or failed
  route never sends the session to another host's CLI (see [Delegated ticket delivery](#delegated-ticket-delivery-sf-agents-delegation)).
- **Recording by hand.** A delegation to Kimi is recorded with `sf agents outcome record --provider kimi …` (host `manual`: rated for the report, never moves the routing), and its models are unpriced
  until the project declares a price in `modules.harness.routing.adjust.prices`.
- **Identity.** The agent is `kimi`, declared explicitly (`sf agents enable kimi`). No path infers it from a model name, and `kimi-code`, `moonshot` or `k3` are refused as unregistered. `kimi-code`
  (and `Kimi`, `kimi_code`) is refused with `Did you mean kimi?`, so a host that names a Kimi Code session `kimi-code` learns the registered id from the refusal; `moonshot` and `k3` get no suggestion.

A CLI older than this release does not know `kimi` as a routed agent: it refuses `sf agents route --provider kimi` and `sf agents outcome record --provider kimi`, and reads a ledger line whose
provider is `kimi` as an invalid line, which it skips and counts. Upgrade the CLI of every clone that shares a ledger before recording Kimi delegations in it.

### Tier agents

The harness turns the grid into one subagent per tier for each declared coding agent the grid routes and whose profile declares tier agents, so a delegation can pick a cheaper tier by name:

| Agent         | File                             | Model and effort                                                                                  |
| ------------- | -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `claude-code` | `.claude/agents/sf-<tier>.md`    | `model` and `effort` frontmatter                                                                  |
| `codex`       | `.codex/agents/sf-<tier>.toml`   | `model` and `model_reasoning_effort`                                                              |
| `kimi`        | `.kimi-code/agents/sf-<tier>.md` | None in the file: the call passes the alias `sf agents route` names (see [Kimi Code](#kimi-code)) |

Each description lists the task kinds the tier serves and the tier to use for every other kind: `sf-fix` is for `bug-fix` and `review`, and sends `scoped-edit` to `sf-edit`. The files follow the
routing of the manifest; a move the automatic adjustment made in this clone stays local until it is promoted. Each agent also asks its delegate to close with the `SF-DELEGATION` line (see
[Measured delegations](#measured-delegations-and-the-adjusted-routing)). An override changes a tier agent's model or effort or adds a project tier, and a tier left without any kind gets no file. A
subagent file must carry an effort its host can run, so an override refuses `minimal` and `ultra` for Claude Code, `minimal` for Codex and anything but `low`, `high` and `max` for Kimi Code.

Tier agents are hash-tracked like the other agent deposits. `sf agents enable`, `replace`, `refresh` and `sf update` rewrite an untouched file, and leave an edited one in place beside a
`.saasfoundry.new` sidecar. A managed harness without an `agents` list receives the Claude Code tier agents on `sf update`. No deposit is ever deleted: a removed agent, or a tier that no longer serves
any kind, keeps its file until you remove it. An adopted project receives none. [`sf status`](./sf-status.md#tier-agents) compares every tier agent with what a refresh would write and warns about a
missing, an edited or an outdated one, with the command that fixes it.

Claude Code chooses a subagent from its description. Codex delegates when you ask or when the instructions say so, and reads a project's `.codex/agents` only once you trust the project. Kimi Code
reads `.kimi-code/agents` of the project (review it like a script in a repository you do not know: an agent file is prompt configuration); its description says the model is chosen by the alias a call
passes, and its `whenToUse` lists the kinds the tier serves. A file format and a model binding go together: `kimi-md` writes no model and so declares `modelBinding: call-alias`, and the registry
refuses a profile that pairs a format with the other binding.

Local onboarding of Kimi Code (`sf agents enable kimi`, the default scope) writes the six files as untracked, excluded files and leaves every tracked file and the manifest as they were; the text of
`AGENTS.md` that mentions the alias is static, so it does not depend on which agent a clone declared. `--scope shared` writes the same files for review and records their baselines in the manifest.

The generated instructions say so. When a workflow step names a task kind (`exploration` for the analysis, `review` for the adversarial review, `scoped-edit` or `multi-file-feature` for a delegated
subtask), they tell every agent to run `sf agents route --task <kind> --provider <current-agent>` (with `--ticket <n> --record` when the delegation is measured) and delegate to the `sf-<tier>` agent
it names, without naming a model. A subtask handed to a cheaper tier states its file set, expected result and check; one that cannot is split or stays in the session. An agent without routing
candidates, or one that cannot delegate, runs the step itself.

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

Commit the shared answer with the current ticket's branch. A `chore` commit on the working branch is only for a branch with no required status check or pull request: after recording a shared answer,
the command reads the working branch's protection (`gh api` on its rulesets and branch protection) and offers the working branch only when it is known to be unprotected. When a required status check
or pull request applies, or when the protection cannot be read, it names the ticket branch or a pull request, never a direct commit there. A worktree cut from the remote working branch reads
`not-asked` until then, so the session's brief to a delegated agent states the consent.

The generated instructions then tell every agent what to do with the effective answer:

- `not-asked`: ask the developer once, then record the answer. Never ask again once it is recorded.
- `allowed`: each ticket that is not trivial, from In progress to the end of AI Testing (test plan, tests, report and draft pull request), runs in a background agent in its own worktree, on the tier
  `sf agents route` names for the task kind of the work. The agent that receives a ticket builds it itself and never hands it on again. The session keeps talking with the developer and never switches
  to coding a ticket mid-delivery. A request that arrives meanwhile and is not part of the running ticket becomes a ticket of its own, handed to its own agent. A trivial change stays in the session:
  one known file, about 20 lines or fewer (a typo, a configuration value, a documentation line), in a worktree of its own. It does not repay a delegation and a dependency install.
- `declined`, or an agent that cannot delegate or run in the background: the session builds the tickets one after the other and says so explicitly.

The consent covers ticket delivery only. Any other parallel writing stream is proposed to the developer first, and the answer comes before writers start.

Every ticket is built in a worktree of its own, whoever builds it and a trivial change included, and the primary checkout stays on the working branch: no lead switches its branch or moves another's
uncommitted changes there (see [The primary checkout](#the-primary-checkout)). A `native` host (Claude Code) opens the worktree for its delegate; a `manual` one (Codex, Kimi Code, Gemini CLI, Qwen
Code, generic) opens it with git and hands the delegate its path. A profile with no worktree support (`worktrees: none`; no registered profile declares it today) delivers the tickets in the session,
one after the other, each in a worktree it opens with git, and delegates sub-tasks only; the generated instructions say so statically, whatever agents the project declares.

A refused or failed route is never worked around. When `sf agents route` refuses an agent, or a delegation cannot start, the step runs in the session; the session never starts another coding agent's
CLI (`claude`, `codex`, or any other) or a background session of another host to delegate anyway, since such a session is one the harness does not route, record or guard. The generated instructions
and the workflow skill state this rule, so it holds for every agent and does not depend on the declared ones.

A delegated agent never merges and, on a ticket that goes through Human Testing, never runs `ready-pr`: it stops at the green report with the draft pull request, and the developer takes the pull
request out of draft. The session collects the Human Testing feedback and hands a defect, or the AI work the validation leaves (non-regression tests, follow-ups), back to the ticket's own agent in the
same worktree, which returns the ticket to AI Testing. A defect found in review goes back the same way. On a complex ticket the session runs the Examine phase itself. The tier agent prompt carries the
same limits, so the agent is not told to do what its own prompt forbids.

The branch of a delegated ticket is the agent's to name, unless the host names it first. Claude Code's `isolation: "worktree"` starts the agent on `worktree-agent-<id>`; the agent keeps that local
branch and pushes the work to the ticket branch (`git push origin HEAD:feature/<N>-<description>`). `create-pr` accepts that checkout when origin holds the ticket's branch at the local `HEAD` commit:
it finds it on its own when it is the only such branch, or takes it from `--head <branch>`. A branch missing from origin, pushed but behind `HEAD`, or belonging to another ticket is refused. The brief
to the agent names the ticket branch, so it can pass `--head`. See [GitHub integration](../workflow/github-integration.md#pull-request-commands-on-a-branch-the-host-named).

The session runs `ready-pr <ticket>` and `draft-pr <ticket>` from the primary checkout, on the working branch, never from the agent's worktree: off the ticket branch they find the ticket's one open
pull request on GitHub from the branch naming, refuse and list the candidates when several match (`--pr <number>` picks one), and check its head commit against origin and the local CI gate. See
[GitHub integration](../workflow/github-integration.md#ready-pr-and-draft-pr-from-the-primary-checkout).

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

## Measured delegations and the adjusted routing

The grid is a prior built from public benchmarks. The project's own delegations correct it: every routed delegation records what it cost and whether it did the job, and the routing moves a task kind
by itself, within declared bounds, with every move and every hold logged with its evidence, visible and reversible. A task kind moves up a tier after repeated failures. It moves down only after a
cheaper tier, tried on a bounded sample of its runs, keeps succeeding. What decides a descent is the cost of delivering the work, failures included, never the price of a call.

### The ledger

The ledger is an append-only file in the **Git common directory** of the clone, `<git-common-dir>/saasfoundry/delegations.jsonl`. Every worktree of the clone (one per delegated ticket) writes to and
reads the same history. Git never tracks it, the file has mode 0600 and appends are locked. It holds five kinds of line:

- a **run**, one per stop of an agent: the task kind, the coding agent, the tier and the candidate (model and effort) that ran, the ticket and its complexity, the active time, the tokens (input,
  output, cache read, cache write), the **cost**, the outcome and the checks run, and whether the run was a trial. The outcome and check codes are those of the
  [execution calibration library](../guide/execution-calibration.md). The agent id of the host is stored hashed, never as it came;
- a **route**, issued by `sf agents route --record` (see below), which says what a delegation is;
- a **detail**: what the host's tool result adds to a run, its own measure of the duration, the model it resolved, a failed or killed status;
- a **signal**: a later verdict (`rework`, `human-defect`) tied to a run or a ticket;
- a **status**: a ticket changed status, which lets the report time a ticket.

The cost is tokens times a price, kept as an exact decimal and rounded up once at 1e-8 USD. The CLI ships a dated price list for the Claude models of the grid (`src/harness/model-prices.json`, with
its source and date). A price is a decimal string above zero. Haiku 5.5 charges more for a prompt over 100K tokens, so a model with such a rate is priced **call by call**, each call by the size of its
own prompt (input, cache read and cache write tokens), from the transcript; a run whose calls are unknown is `partial`: it keeps its tokens, has no cost and stays out of the cost comparisons. A model
without a published price, such as the Codex models, is **unpriced**: its runs count for reliability but have no cost until the project declares one in `modules.harness.routing.adjust.prices` (USD per
million tokens, optionally with a `longPrompt` rate). A cost is never guessed.

A measurement that is missing is recorded as **unknown**. A delegation without a verdict is `outcome-unknown`, a run without a route has no task kind, and a cancelled or killed run or an unavailable
candidate says nothing about the tier. All of them are kept and shown but **censored**: they never count as a success or as a failure. A failed or timed-out run is an execution failure.

Writers take a lock that names its holder (`pid:token`). It is broken only when that pid is gone, and released only by the writer that took it. A writer that cannot get it in time leaves its line in a
spool next to the ledger (`delegations.spool/`): every reader sees it at once and the next writer appends it, so a record is not lost to a killed hook.

### Route records

What a delegate says about itself is not believed. The session issues the truth when it routes the work:

```bash
sf agents route --task multi-file-feature --provider claude-code --ticket 1035 --complexity complex --nature user-facing --record
# multi-file-feature → build (shipped) claude-code: claude-sonnet-5-5, effort xhigh — … route=0a1b2c3d4e5f60718293
```

`--record` writes a **route record** in the ledger (the kind, the tier, whether it is a trial, the ticket, the complexity and the nature) and prints its id (`routeId` in `--json`, `routeVersion: 2`).
The session puts `route=<id>` in the brief and the delegate echoes it. The capture takes the task kind, the tier, the ticket and the trial flag **from the record**, so a delegate cannot name its own
kind or call itself a trial. A run with no id, an id nobody issued, an id issued for another tier or another agent, or one that another agent already used is kept and censored, and says why in its
evidence references. Reading a route without `--record` records nothing. `--retry-of <route or run id>` routes the retry **one tier above** the one the earlier delegation used, never a trial, and
links the two: that link, and nothing else, says the earlier run did not do the job. A retry keeps the coding agent and the task kind of the delegation it follows, and at the top of the ladder the
command says that no stronger tier is left instead of answering the same tier again.

The record is also a **reservation**. A trial it hands out holds its place in the trial share until a run echoes the id or seven days pass, and the check and the reservation are one step under the
ledger lock, so routes asked for at the same moment cannot all be trials. A route nobody echoed within those seven days is **expired**: a run that echoes it later is kept and censored
(`route-expired`), because its kind and its trial flag can no longer be trusted. An agent that already used the route is never expired, so a resumed agent that hands back days later keeps its verdict.
A record is written for one coding agent: pass `--provider` when several are declared.

**The ticket says its complexity.** The form above names `--complexity` and `--nature`, but the form most sessions copy does not:
`sf agents route --task <kind> --provider <agent> --ticket <n> --record`. For a value the flags leave out, the command reads the labels of the ticket (`complexity: <bug|low|medium|complex>`,
`nature:<user-facing|internal|bundled-pr>`) through the tool CLI the workflow itself uses (`.claude/skills/sf-tool-<tool>/<tool>-cli.sh get-labels <n>`, then the `.agents/skills` copy for a Codex-only
project), and records them. An explicit flag wins, and a ticket whose complexity and nature are both given is not asked. The text output says where each value came from
(`Ticket #1105: complexity medium (from the ticket label), nature internal (from the ticket label).`, above the route line, which stays the last line), and `--json` adds `complexity`,
`complexitySource`, `nature` and `natureSource` (`flag`, `label` or `null`).

The read never holds up a delegation. It runs before the ledger lock is taken, is bounded to ten seconds, and fails open: a tool whose CLI has no `get-labels` (only GitHub Projects has it today), no
tool CLI, a `gh` that is offline, a timeout or a ticket without a complexity label records no complexity, and says so once on stderr, naming the cause and the flag to pass:
`Warning: the complexity of #1105 could not be read (<why>): the route record carries none; pass --complexity <level>`. A ticket with no `nature:` label is the default one (user-facing), not a gap,
and is not reported. Nothing is read without `--ticket`.

### What the delegate reports

The host knows what a delegation cost; only the delegate knows whether it did the job. Every tier agent ends its final message with one line:

```text
SF-DELEGATION: pass route=0a1b2c3d4e5f60718293 checks=type-check,automated-tests
```

`pass` means the check the brief named was run and met; `fail` that it failed or the result is incomplete. The checks are the codes of the calibration library: `self-review`, `type-check`,
`automated-tests`, `affected-tests` (the tests a change affects, run while it works), `integration-tests`, `independent-review`, `security-tests`; the prompt lists them, because a delegate that is not
told the codes writes free text. A `pass` that names no check, or only `self-review`, is recorded as unknown. The line is the **last non-empty line of the message outside a code fence**. The fences
are tracked over the **whole message** from its first line (a fence closes only with the same mark, at least as long, and nothing after it), however long the message is, so an example quoted earlier
or a long fenced block cannot decide the verdict. Any other key on the line (`kind=`, `ticket=`, `trial=`) is ignored. A message without the line is an unknown outcome, and the delegate is asked for
it once (next section).

### Interim stops

A delegate that ends a turn while a job it started in the background still runs (a test suite, a commit hook, `molten ci run`) is not done: the host wakes it when the job reports, and the delegation
ends at a later stop. Every tier agent is told to wait for its own jobs (on Claude Code, the Monitor tool with an until-loop) and never to write its final message while one runs. A turn that ends
anyway is an **interim stop**, and the capture records it without an outcome:

- **Claude Code** lists the session's background tasks in every `SubagentStop` payload (`background_tasks`: id, type, status). That list is the session's, with the shells and monitors of every
  delegate running beside this one and the stopping agent itself, so the capture keeps only the running tasks the agent's own transcript launched (a shell run in the background, a monitor, a subagent
  launched in the background). When one of them still runs, the stop is interim.
- **On any host**, a delegate that ends a turn with `SF-DELEGATION: pending route=<id>` says the same. It is the only signal on Codex, and on a Claude Code release whose payload has no task list.

An interim stop keeps its cost and its route, carries the evidence references `interim-stop` (and `background-work-running` when the task list showed it), and, when the delegate wrote a verdict all
the same, `interim-verdict-<pass|fail>`: a fact, never the outcome. It is never asked for the line. While an interim stop is an agent's latest one, the delegation is censored, a verdict an earlier
stop gave included, and `sf agents routing report` counts it apart. Its final stop carries the verdict that counts. A CLI older than this change reads a `pending` line as a missing line and asks for
it once, as it did before.

The routing report and the adjustment read the same folded ledger; on 2026-11-13 they disagreed only in time. The adjustment runs after each capture, and three delegations had just recorded a `fail`
at an interim stop: `bug-fix` was moved up on "3 failures in the last 10 rated runs", and the final `pass` of the same delegations, recorded later, did not undo the move. An interim stop now has no
outcome, so neither reads a failure there.

### Asking for the missing line

A delegate that forgets its closing line used to be recorded as an unknown outcome and dropped: nobody saw it, and the routing could not learn from the run. The capture now answers the `SubagentStop`
of such a delegate with a **block decision**, on Claude Code and on Codex alike: the host keeps the subagent running and hands it the reason as its next instruction.

```json
{
  "decision": "block",
  "reason": "Your final message has no SF-DELEGATION line, so this delegation cannot be measured. Do not redo any work. …\nSF-DELEGATION: <pass|fail> route=<the id from your brief, if it gave one> checks=<codes>"
}
```

It asks only when every condition holds, and never twice:

- the event is a `SubagentStop` of a routed `sf-<tier>` agent whose tier is declared for the host, with a non-empty final message that has **no line at all** (a `pass` that names only a self-review
  has a line, so it is never asked: asking again would not change the check);
- the stop is not [interim](#interim-stops): a delegate whose own background job still runs, or that wrote `SF-DELEGATION: pending`, gives its line at its final stop;
- the host does not say it is already continuing because of a stop hook (`stop_hook_active`);
- no earlier segment of the same agent carries the evidence reference `asked-for-sf-delegation-line`. That guard is ours: it holds when a host's own loop flag is wrong or missing.

The stop is recorded first, with that reference, so nothing is lost if the agent never stops again. The stop that answers is the next segment of the same agent, so it folds into **one delegation**
with the verdict and the route of the answer and the cost of both stops (see below). When the brief gave a route id (`route=<id>` in a user prompt of the agent's transcript, never a tool result) and
the route record would accept this agent for it, the reason carries it as the exact line to write; otherwise it says to use the id from the brief. That id only fills in the suggestion: the line the
delegate writes is what attributes the run.

### Capture and signals

`sf agents outcome capture --host <claude-code|codex>` reads a hook payload on stdin, appends one record, then runs the adjustment on the state it just wrote. It never fails the host: what goes wrong
after the arguments were understood exits 0. Run it by hand only to test a hook. It prints nothing on stdout, except one JSON object when it asks a delegate for its missing line
([above](#asking-for-the-missing-line); `--json` carries it in the versioned result instead).

The hook is a shell line, not a bare `sf` (that name may be another CLI, or an older SaaSFoundry without the command). It leaves at once, before Node starts, unless the payload mentions an `sf-<tier>`
agent, then runs the CLI the **project** resolves: `node_modules/.bin/saasfoundryai`, then its `sf`, then the build of this repository when the project is SaaSFoundry itself, then `saasfoundryai` on
the PATH. It exits 0 whatever happens, so a missing or too old CLI never disturbs the agent. The CLI's **stdout** reaches the host (that is how the decision gets there) and its stderr is discarded. A
CLI too old to know `agents outcome capture` exits non-zero: the hook then writes one line on stderr and an entry of stage `cli` in the capture error log below, instead of passing in silence.

A failure is not lost with it. The capture appends one line to **`capture-errors.jsonl`**, next to the ledger in the Git directory of the clone (never tracked, shared by every worktree), for a payload
that cannot be read, a ledger that cannot be written or a routing adjustment that was skipped, and for the abnormal ignores (a payload that is not an object, a tier the project never declared for the
host, a tool result without an agent id). The ordinary ignores (an event that is not a delegation, an agent that is not an `sf-<tier>`, a background launch) leave nothing. A line holds the time, the
host, the hook event, a stage (`payload`, `ledger`, `adjustment` or `ignored`) and a message of about 300 characters, with no payload text and no host agent id. Past 64 KiB the file keeps its last 200
lines. `sf status` counts the errors of the last 7 days (see [`sf status`](./sf-status.md#capture-errors)) and so does `sf agents routing report`. Outside a Git checkout there is no log, and the
failure stays on stderr.

- **Claude Code.** `SubagentStop` (matcher `sf-.*`, so the other subagents never start it) is the primary event: the tier comes from the `sf-<tier>` agent and the tokens are summed over the distinct
  API calls of the subagent transcript. `PostToolUse` on the `Agent` tool is joined to the stop by the agent id and adds the duration the host measured, the model it resolved and a failed or killed
  status. Both go into `.claude/settings.json`.
- **Codex.** `SubagentStop` in the tracked `.codex/hooks.json`, which keeps the hooks a project already has there. Tokens come from the rollout and stay unknown when it cannot be parsed. Codex runs a
  project hook once the `.codex/` layer is trusted and the hook itself has been trusted (it persists that trust per hook); nothing here can see that, so `sf status` says **declared**, not enforced.
  The trust follows the text of the hook: when `sf update` or `sf agents refresh` replaces an earlier capture command (the v1.1.0 one, see below), it says so, and Codex skips the new hook until you
  review and trust it with `/hooks`. Until then the delegations of that project are not recorded.
- **Other hosts.** No hook. The session records by hand with `sf agents outcome record`, and `sf status` says capture is unavailable, with the reason the host's profile gives. Kimi Code is routed and
  has no hook: it reads hooks from the user's own configuration only, so its delegations are always recorded by hand.

An agent the session **resumes** to hand a result back emits another `SubagentStop` with the same agent id. Each stop is a run of its own: it counts only the transcript bytes written since the
previous stop, it links to the previous one, and the whole is one delegation. The last stop carries the cost and the active time of all of them, and the latest verdict is the outcome. The **active
time** of a stop is the sum of the gaps between its transcript events, each capped at five minutes, so the idle time between a stop and its resume is not work; the duration the host reports for the
first call wins when there is one.

`sf update` and `sf agents refresh --scope shared` deposit the hooks, merged into what the files already hold and replacing the commands an earlier release wrote: the bare-`sf` one of the first build,
and the shell line **v1.1.0** shipped, which discarded the CLI's stdout and so could not carry a decision to the host. Both are recognised by their exact text and replaced, never left beside the new
hook; a copy you edited by hand is yours and stays. `.claude/settings.json` is written whole or not at all. Enabling an agent never touches it. `sf status` reports `enforced` only when the hook is
declared **and** the project's CLI answers `agents outcome capture --help`; otherwise `declared-not-runnable`, `declared` (Codex), `outdated` (the hook of an earlier release) or `missing`.

```bash
# A host without hooks, or a run the hooks could not see: shown in the report, never moves the routing
sf agents outcome record --provider claude-code --tier build --kind multi-file-feature --ticket 1035 --outcome pass \
  --model claude-sonnet-5-5 --input-tokens 120000 --output-tokens 9000 --duration-ms 240000 --checks type-check,automated-tests

# A later signal tied to the same step; the original line is never edited
sf agents outcome mark 1035 rework                  # the session had to rework what the agent delivered
sf agents outcome mark 1035 human-defect --kind tests --note "wrong default"

# Run by workflow-cli.sh update-status, best effort, to time a ticket
sf agents outcome status-event 1035 "In progress"
```

`record` and `mark` write evidence the routing acts on, so the harness does not pre-approve them in `.claude/settings.json`: they ask. The same goes for the forms of `sf agents route` that write a
route record: the read form is pre-approved, while `--record` and `--retry-of` are listed under `permissions.ask`, which the host evaluates before `permissions.allow`. A run recorded by hand has the
host `manual`; it is rated for the report and **never moves the routing**. A ticket without `--kind` is marked on the kind that delivered it (`multi-file-feature`, `scoped-edit`, `bug-fix`, `tests`,
`terminal-ci`, the first one it has a run of), never on a `review` or an exploration; `--kind` names another.

A success that carries a signal counts as a failure, as does one that a later run linked to it with `--retry-of` redid on a higher tier. The session marks `rework` when it redoes delegated work and
`human-defect` when a defect comes back from Human Testing or review.

`workflow-cli.sh update-status` runs `status-event` in the background after a transition that succeeded. It never blocks, never fails the transition and records nothing when the project has no CLI.

### The adjustment

`sf agents routing adjust` evaluates every task kind and coding agent the ledger has runs for. The capture hooks run it after each recorded delegation; `--dry-run` decides without writing, `--json`
prints the decisions. Only **decisive** runs count: rated, and recorded by a host hook, never by hand. The shipped defaults:

- **Window.** The last 20 rated runs of a candidate. Statistics follow the candidate (model and effort), not the tier name.
- **Escalate.** One tier up after 3 failures among the last 10 rated runs of the candidate the kind is routed to. It **does not depend on cost**: the rework of a failing tier is not metered, so the
  expected cost of staying is underestimated and a cost test would hold a kind on a failing tier. The expected costs of both tiers are in the evidence, and a stronger tier whose p95 duration is over
  `maxDurationMs` is noted in the rule, not obeyed.
- **De-escalate.** One tier down once the cheaper tier has 8 successes and no failure among the runs the routing **offered as a trial**, and costs less to deliver the work.
- **Trial.** The cheaper tier is tried on at most 10 % of the kind's rated runs since the evidence started, the routes already issued and not recorded yet included: `(trials + 1) / (runs + 1)` stays
  within that share. A failed trial leaves that tier alone for 14 days.
- **Floors.** A candidate the grid excludes for the kind (Haiku for terminal and CI work) is never chosen; the descent stops there.
- **Ladder.** The tiers in grid order, `light`, `edit`, `build`, `fix`, `plan`, `terminal`. Tiers that share a candidate (the Codex ones mostly do) are one rung. A tier the project introduced is not
  on it. A kind that moves back to the shipped candidate loses its local entry and is routed to the shipped tier name again, even when that tier shares its candidate with another.

The descent compares the **expected feature cost** of a candidate, failures included. A failure is paid once, at the tier above:

```text
E(tier) = c + (1 - s) x E(next tier up)        top of the ladder, or a next tier never measured:  E = c / s
```

with `c` the mean cost of a delegation on the tier and `s` its success rate. A cheap tier that fails often is therefore expensive. A move down needs the cheaper tier to cost less by more than the cost
band (10 %); within the band, the lower p95 duration breaks the tie, and a tier whose p95 duration is over `maxDurationMs` (optional) is not chosen. A candidate with no priced run has no expected
cost: a kind can move away from it on reliability, never move to it on cost. Every move records the figure that justified it, the window it counted, the rule and the runs behind it.

**Holds** are logged too. When the adjustment looks at a kind and leaves it where it is (`top-of-ladder`: it keeps failing and nothing is stronger; `cheaper-tier-costs-more`; `tie-not-faster`;
`unpriced`; `over-duration-ceiling`; or an ordinary wait for evidence), the reason is written once to the log and kept until it changes. `sf agents routing report` lists them and `sf status` names the
ones that say something.

A **new candidate** (a new model or effort in the grid or in a project tier) is told from a known one by the candidates the adjustment saw the last time it looked at the ladder. One that appears on a
rung next to the routed tier is tried by itself within the same bounded share, below the routed tier as for any cheaper tier, or **above** it when it is a stronger one, and it is adopted by the same
expected-cost rule, which then accepts it. A candidate that replaces another **under the same tier name** takes that tier at once: a tier agent runs one candidate, so the previous one cannot stay
routed. A grid update keeps the measured history of every unchanged candidate and starts a fresh window only for a changed one.

**What the decisions rest on.** A move applies to every worktree of the clone, and a delegated agent can edit the manifest of its own worktree. The thresholds, the prices and the overrides a decision
uses are therefore read from the **committed working branch**, never from the manifest on disk. The branch is named by the `.saasfoundry.json` committed on the remote's default branch, then by the one
on the commit the worktree is on (`workflow.workingBranch`); when none names it, the remote's default branch stands. `origin/<branch>` is read first, then the local branch, so a local branch that was
never updated cannot stand for the team's. While the routing block of a worktree differs from the committed one, `adjust` decides and moves nothing and says so, and `sf agents route` answers by the
worktree's own block for display, with no trial. When no committed manifest can be read (the named branch is not fetched, or the repository has no commit holding `.saasfoundry.json` yet), nothing is
decided either, and the refusal says what to fix: the manifest on disk is never a substitute. With no branch named anywhere, the manifest committed at `HEAD` is the committed copy.

### The local layer, promote and reset

The moves live in `<git-common-dir>/saasfoundry/routing.json`, next to the ledger: a local layer with the move, its provenance and its evidence, the holds, the candidates seen, and a log of the last
100 entries (moves, holds that changed, adoptions). It applies at once to every worktree of the clone and is never committed. Resolution is the developer's shared overrides first (a kind pinned in
`modules.harness.routing` is **never** changed or hidden by an automatic move), then this layer, then the shipped grid.

The tier agent files are tracked and rendered from the shared routing, so a local move does not rewrite them; `adjust` and `report` say how many differ, and `sf agents route` is the authority.

The worktrees of a clone share this file, so two CLI versions often read it, for example while a delivery changes the routing. From 1.4.0, a CLI skips the entries it does not know (a provider, a task
kind, a key or a log action a newer CLI wrote, or an entry whose shape it does not read), applies the others, and names what it skipped in one `Notice:` line on the stderr of `sf agents route`. When
it writes the file, it writes those entries back as they were. Only a file that cannot be the layer (not JSON, or without its sections) is refused, and a file of a newer layer version asks you to
upgrade the CLI, not to delete the file. The ledger is append-only: a line an older CLI cannot read is skipped and counted, and never rewritten.

```bash
sf agents routing promote multi-file-feature      # copy the move into modules.harness.routing, as a reviewable change
sf agents routing promote --provider codex        # when the two agents moved the kind differently
sf agents routing reset multi-file-feature        # undo the automatic moves of the kind
```

`promote` writes the tier to `modules.harness.routing.kinds` through the same atomic, edit-detecting replacement as `sf agents enable`, drops the local entry and logs it. A shared override covers
every agent, so two moves that differ need `--provider`. A kind the manifest already overrides is skipped: the developer's choice wins. Review the change, run `sf agents refresh --scope shared` to
regenerate the tier agents and commit both. `reset` returns the kind to the shared routing or the grid and restarts its evidence, so the same runs do not move it again at the next capture; a shared
override is not changed.

### The report

`sf agents routing report [--json]` is read-only. It shows, per task kind and tier, the delegations, the censored count, the success rate, the p95 cost and duration and the expected feature cost, and,
per ticket by complexity (and nature), the median and p95 of the cost, of the **active time** of the delegations, and of the time **from the first In progress to the first Human testing** (to In
review for a ticket that skips it), taken from the status transitions `workflow-cli.sh` recorded. A ticket with a delegation that has no cost is a lower bound: it is counted apart from the medians and
the p95. A resumed agent is one delegation, and the report says how many further stops it counted. It also names the models without a price, the capture state of each agent, the capture errors of the
last 7 days (`Capture errors: 2 in 7 days (last 2026-11-06, ledger: …)`, or `none`), the holds and the local moves nobody promoted. `--json` is versioned (`reportVersion: 2`). `sf status` carries one
`routing:` line with the grid version and the project overrides, the unpromoted moves, the notable holds and the capture state, and a `tierAgents` precondition for the tier agents on disk (see
[`sf status`](./sf-status.md#tier-agents)).

The report says what it cannot see: the tokens the session spends planning, talking and reviewing are metered by no host hook, so the cost of a ticket is the cost of its delegations. A ticket is
counted once it has a recorded delegation; the report does not know whether it reached Done, and the time of a ticket needs the transitions to have been recorded in this clone.

### Settings

All optional; the defaults apply to omission, so older manifests keep validating and `sf update` needs no migration.

```json
{
  "modules": {
    "harness": {
      "routing": {
        "adjust": {
          "enabled": true,
          "window": 20,
          "escalate": { "failures": 3, "of": 10 },
          "deescalate": { "successes": 8, "failures": 0 },
          "trialShare": 0.1,
          "trialCooldownDays": 14,
          "costBand": 0.1,
          "maxDurationMs": 900000,
          "prices": {
            "gpt-6.1-sol": { "input": "0.30", "output": "1.20", "cacheRead": "0.03" },
            "some-long-context-model": {
              "input": "1.00",
              "output": "4.00",
              "longPrompt": { "abovePromptTokens": 200000, "input": "2.00", "output": "8.00" }
            }
          }
        }
      }
    }
  }
}
```

`enabled: false` stops the moves and the trials; outcomes are still recorded. `prices` are USD per million tokens as decimal strings above zero; a missing `cacheRead` is a tenth of `input` and a
missing `cacheWrite` 1.25 times it. A `longPrompt` block gives the rates of a call whose prompt is over `abovePromptTokens`.

One limit remains: the hook payload fields were captured from a live Claude Code and a live Codex session and are exercised through those fixtures, but the hosts may change them.

## The guard hook

A workflow guard refuses a transition and names what to do next. It never names the way round the guard: an escape hatch (`SF_WORKFLOW_BYPASS_*`, `--skip-local-ci`) and the nature label that skips
Human testing are the developer's to apply. `sf agents guard --host <claude-code|codex>` is what keeps an agent to that. It is the command of a `PreToolUse` hook that the harness writes into
`.claude/settings.json` (matcher `Bash|PowerShell`, 10 second timeout) and `.codex/hooks.json` (matcher `Bash`), on `sf new`, `sf update` and `sf agents refresh`. It reads the tool event on stdin and
prints the host's deny decision, or nothing:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Refused by the SaaSFoundry guard hook: … Stop, report the guard's refusal to the developer and ask. …"
  }
}
```

Staying silent leaves the host's normal permission flow in place: the hook never allows a call, it denies one, or in `warn` mode [adds context](#the-modes) and leaves the flow in place. It always
exits 0 and fails open. A payload it cannot read (not JSON, larger than 1 MiB) lets the call through and is written to the [capture error log](#capture-and-signals), which `sf status` counts. Run it
by hand only to test a hook.

**What it refuses.** For everyone, the main session included:

| Rule            | The call                                                                                                                                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bypass variable | A `SF_WORKFLOW_BYPASS_<X>=…` assignment in front of a command, in `export`, `declare -x`, `typeset -x`, `env`, `bash -c '…'` or `eval`. `SF_WORKFLOW_BYPASS_REASON` alone, and the name as a plain argument (`grep SF_WORKFLOW_BYPASS_PUSHED_GUARD file`), are allowed |
| Local CI skip   | `--skip-local-ci` given to `workflow-cli.sh` or `github-projects-cli.sh`, also through `bash <path>`. `grep -- --skip-local-ci` is allowed                                                                                                                             |
| Nature label    | `gh issue edit … --add-label nature:internal\|nature:bundled-pr` (also `--add-label=` and a list of labels), and `gh api` that writes one. Removing `nature:user-facing`, and reading labels, are allowed                                                              |

and, **for a delegated agent only**, that is a tool event with an `agent_id` (Claude Code adds it to every event fired inside a subagent), or a call whose working directory, `cd` or `git -C` target is
under `.claude/worktrees/` or `.codex/worktrees/`:

| Rule               | The call                                                                       |
| ------------------ | ------------------------------------------------------------------------------ |
| Delegation consent | `sf agents delegation allow\|decline\|clear`, whichever way the CLI is spelled |
| Pull request ready | `ready-pr` of either script, and `gh pr ready` (not `--undo`)                  |
| Merge              | `gh pr merge`, and `gh api …/pulls/<n>/merge`                                  |
| Nature at creation | `github-projects-cli.sh create-ticket … --nature internal\|bundled-pr`         |

The same calls from the primary checkout are allowed: the session and the developer run them. The command is read the way a shell reads it: quotes, `;` `&&` `|` and newlines, `bash -c '…'`, `eval`,
`env`, heredocs and here-strings are looked into, to three levels. It does not expand `$(…)` in a string or a variable.

### The primary checkout

Agents of several hosts and the developer may work in one folder, like several developers on one repository: each ticket is built in a worktree of its own, and the primary checkout stays on
`workflow.workingBranch`. When one lead stashed the developer's change and switched the shared checkout to its ticket branch, the other lead's work changed branch under it (#1332). So, for everyone
and **in the primary checkout only** (a linked worktree is left alone), the hook refuses:

| Call           | Refused                                                                                                                                                     | Allowed                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `git switch`   | any branch but the working branch; `-c`, `-C`, `--orphan`, `--detach`, `-`                                                                                  | `git switch <workingBranch>`, `--help`                                                                                                       |
| `git checkout` | `-b`, `-B`, `--orphan`, `--detach`, `-`, and one operand that can name a branch or a commit (`fix/12-x`, `HEAD~1`) other than the working branch and `HEAD` | anything after `--`, `-p`, `<tree-ish> <path>…`, one operand that cannot be a branch name (`.`, `./x`, `.env`, `src/*.ts`, an absolute path) |
| `git stash`    | everything that moves changes or drops a stash: bare, `push`, `save`, `pop`, `apply`, `drop`, `clear`, `branch`                                             | `list`, `show`, `create`, `store`                                                                                                            |

`git checkout README` is ambiguous (a branch or a file) and is refused: the refusal says to write `git checkout -- README` or `git restore README`. The refusal names the worktree command to use
instead, one command per call: `git fetch origin`, then `git worktree add <path> -b <ticket branch> origin/<workingBranch>`.

The hook tells the two apart from the `.git` entry nearest to the directory the command runs in (its working directory, a `cd`, or `git -C`): a directory is the primary checkout, a file whose
`gitdir:` points into `<common-dir>/worktrees/<name>` is a linked worktree. No `git` process runs. Anything else (a submodule, `--git-dir`, `--work-tree`, `cd ~`, no checkout) is not guessed: the call
goes through. The working branch is read from the nearest `.saasfoundry.json`; without one, every switch is refused. The hook line lets a payload that mentions `checkout`, `switch` or `stash` reach
the CLI; the line v1.3.0 wrote did not, and a refresh replaces it.

### A shell line that is not one plain command

`AGENTS.md` asks an agent to keep each shell call to one plain command. A host cannot analyse a chained, substituted or scripted line before it runs, so it stops for a permission on every such call,
even when each command in it is allowed: the developer is prompted for what the agent could have split. After the rules above, the hook reads the **shape** of the line and refuses what is not one
plain command. It is not an escape hatch: the refusal asks the agent to rewrite its call, and it names the construct and the split to make (`1. cd apps/site 2. npm install`). On Claude Code it reads
the Bash tool only, since a PowerShell line has other quoting; on Codex it reads the same constructs, and a Codex argument vector `bash -lc '<line>'` stands for its line.

| Construct                 | Refused                                                                                                                             | Instead                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A chain                   | `a && b`, `a; b`, `a \|\| b`, two lines in one call (`cd dir && cmd` included)                                                      | One command per call, in order; give the directory to the command (`git -C <dir>`, `npm --prefix <dir>`) |
| A substitution            | `$(…)`, backticks, `<(…)` and `>(…)`, at the top level, inside double quotes (where the shell runs them) and in an unquoted heredoc | Run the inner command in its own call, then use its output in the next                                   |
| A loop, a group           | `for`, `while`, `until`, `if`, `case`, `select`, `{ …; }`, `( … )`, a function definition, in command position                      | One call per item, or one command that takes every item                                                  |
| A background job          | a `&` that is not part of a redirection                                                                                             | The host's background option (`run_in_background` on Claude Code)                                        |
| An inline script          | `node -e`, `python3 -c`, `python3 - <<EOF`, `bash -c`, `eval`, a script piped into a shell, also behind `env`, `timeout` or `xargs` | Write the script to a file with the file tool, then run the file                                         |
| A file written by heredoc | `cat <<EOF > path`, `tee path <<EOF`                                                                                                | The file tools (Write, Edit)                                                                             |

Only what is in command position counts: `rg for src`, `git log --grep "if this; then"`, a `;` or `&&` inside quotes, `find … -exec … \;`, `node script.js -e x` and `python3 -m pytest -c conf` are
plain commands. A pipe, a redirection (`2>&1`, `&>`, `> file`), a comment, a `[[ a && b ]]` test and a heredoc fed to a program that only reads it (`cat <<'EOF' | wc -l`, `git commit -F - <<'EOF'`)
are not refused either. A substitution that is never closed is refused like any other, and so is text nested more than 24 levels deep, which the lexer does not read further.

**The commit message exception, and what was measured.** The idiom `git commit -m "$(cat <<'EOF' … EOF)"` is a substitution, so by default it is refused, with the instruction to write the text to a
file and pass it with `git commit -F <file>`. Whether Claude Code prompts on it was measured, on Claude Code 2.1.325 started with `--permission-prompts none` and only the command allowed:

| Allowed rule           | The call                                                                        | Result                    |
| ---------------------- | ------------------------------------------------------------------------------- | ------------------------- |
| `Bash(git commit:*)`   | `git commit -m "$(cat <<'EOF' … EOF)"`, single-quoted delimiter                 | ran, no prompt            |
| `Bash(git commit:*)`   | the same with an unquoted `<<EOF`                                               | denied (would have asked) |
| `Bash(gh pr create:*)` | `gh pr create --title … --body "$(cat <<'EOF' … EOF)"`, single-quoted delimiter | ran, no prompt            |

So on Claude Code the guard leaves exactly that form alone, for `git commit` and for `gh pr create`: a double-quoted word that is one substitution and nothing else, holding only
`cat <<'DELIM' … DELIM` with a single-quoted delimiter. Anything around it, another command in the substitution, a redirection, an unquoted or double-quoted delimiter, or another program is refused.
The `gh pr create` case goes one step past the decision recorded on #1251, which names `git commit`: it is one entry of `takesQuotedHeredocArgument` in `src/harness/shell-shape.ts`, and removing it
makes the guard refuse that form too. Codex was not measured, so on Codex the form is refused like any other substitution.

#### The modes

What the hook does with such a line is a setting of the project, `modules.harness.guard.shellShape` in `.saasfoundry.json`:

| Mode     | The hook                                                                                                                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refuse` | Denies the call and names the split. This is the default: **absence means `refuse`**, in a new project and in one updated from an earlier release. `sf update` writes nothing; it prints one line that says what the guard now does.                                  |
| `warn`   | Does not deny: it prints the same text as `additionalContext`, which the agent reads, and the host's own permission flow goes on, so a host that prompts for the line still prompts. Claude Code honours it on `PreToolUse` (checked on 2.1.325); Codex documents it. |
| `off`    | Does not read the shape of a line.                                                                                                                                                                                                                                    |

The rules above (a bypass variable, `--skip-local-ci`, a nature label and, for a delegated agent, a merge) apply in every mode. The hook reads the manifest nearest to the working directory of the call
(a worktree of an agent has its own copy), then `CLAUDE_PROJECT_DIR`, on every call, so a change applies to the next call; a manifest it cannot read or a value it does not know means `refuse`.

#### `sf agents shell-guard`

```bash
sf agents shell-guard status
sf agents shell-guard warn
sf agents shell-guard refuse
sf agents shell-guard off
```

`status` prints the mode and where it comes from (`recorded in .saasfoundry.json`, or the default); `refuse`, `warn` and `off` record it as the shared team default, in
`modules.harness.guard.shellShape`. It is the only writer: it goes through the same atomic, edit-detecting replacement as `sf agents delegation`, keeps every other key of the harness block and of the
guard block, writes nothing for the mode already recorded, and says where to commit the change (never directly on a protected working branch). It fails on a project without a `modules.harness` block.
`--json` prints `{ "shellGuardVersion": 1, "shellShape": "warn", "source": "manifest", "changed": true }` (`changed` only when a mode was recorded; `source` is `default` while nothing is). The schema
declares the block and leaves it open to a key a later release adds; an older manifest still validates, with no `manifestVersion` bump and no migration. Which mode a project uses is the developer's
decision: an agent never changes it.

**How the developer applies a hatch.** In Claude Code, `! <command>` typed in the session runs without going through the Bash tool, so the hook does not fire; on any host, the developer's own terminal
does the same. Run either from the primary checkout.

**The hook line.** It is a shell line, not a bare `sf`, for the reasons [the capture hook](#capture-and-signals) is. It reads the payload and leaves before Node starts unless the raw JSON of the
payload mentions `SF_WORKFLOW_BYPASS_`, `skip-local-ci`, `nature` (in any case), `addLabels`, `delegation`, `ready` or `merge`, or one of the characters and flags a line that is not one plain command
needs: `;`, `&&`, `||`, a newline (`\n` in the JSON), `$(`, a backtick, `<<`, `<(`, a background `&`, an interpreter flag (`node -`, `python … -`, `sh -`, `eval `, `deno eval`), or a script piped into
a shell (`| bash`). The filter is a deliberate superset: a plain command, a pipe and a redirection pay for no process, a payload that passes it only costs one fast Node start, and no keyword is
matched (`for`, `if`), because the description of a call is prose. Then it runs the CLI the project resolves: `node_modules/.bin/saasfoundryai`, then this repository's own `bin/sf.js` when `dist/` is
built, then `saasfoundryai` on the PATH. `bin/sf.js` answers `agents guard --host <claude-code|codex>` through a dedicated entry that loads only the guard (no commander, no other command, not the
ledger), so a refused call costs a Node start, tens of milliseconds, where the whole CLI takes about half a second to a second; any other form (`--help`, an unknown host) is the full CLI. With no CLI,
or one that lacks `agents guard`, the call goes through; a CLI that lacks it exits non-zero, and the hook writes one line on stderr and an entry of stage `cli` in the capture error log, which
`sf status` counts. A project updated to this release but reaching an older CLI is not checked for the shape of a line, and each call that reaches that CLI costs the full CLI: upgrade it (`sf status`
says so).

**Limits, stated plainly.** The hook is a guardrail against the ordinary path the refusals used to teach, not a security boundary.

- It reads the command the agent wrote. A bypass written into a script that is then run, built through a variable, or decoded at run time is not seen. `update-status` still announces every hatch it
  honours on the ticket, and `workflow-cli.sh` and `github-projects-cli.sh` refuse a hatch, `--skip-local-ci` and `ready-pr` themselves when they run in a delegated worktree.
- It covers the Bash tool (and PowerShell). A GitHub MCP tool that adds a label is not covered.
- Claude Code reads its settings when a session starts: a session that is already running keeps its old hooks. A developer can switch hooks off (`disableAllHooks`).
- Codex runs a project hook only once the `.codex/` layer and the hook's text are trusted. `sf update` says when it added the hook: review and trust it with `/hooks`. A Codex subagent carries no agent
  id, so the delegated-only rules apply there to a call in a recognised worktree path.
- It reads the text of the call, not what a script does once it runs: `node script.js` is a plain command whatever the script holds, and a program that wraps another one the lexer does not know
  (`find … -exec sh -c '…' \;`, `ssh host 'a && b'`) is not looked into.
- `sf status` reports the state on the `routing:` line for each declared agent, naming the CLI the hook reaches when it cannot run it (`guard enforced`, `guard declared`,
  `guard hook declared but the CLI it reaches (…) cannot run sf agents guard`, `guard hook missing`, `guard not enforced`, and `guard unavailable (<reason>)` for a tool whose profile declares no
  hooks, such as Kimi Code) and ending with the mode (`shell shape: refuse`, or `warn`, or `off`), and the `guardHook` precondition **fails** when that CLI cannot run the hook, and warns when it is
  older than the project or when the hook is missing or outdated (see [`sf status`](./sf-status.md#the-guard-hook)).

## Platform notes

The project test suite exercises the CLI and generated shell workflows on macOS and Linux. Windows users should prefer WSL for the same environment. Native Windows commands may work, but runtime
executable-extension lookup remains `not-checked`; use `sf agents doctor` as bounded evidence and verify the chosen host directly.
