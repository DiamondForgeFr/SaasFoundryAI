# Agent coexistence and native verification

This page is the strict verification and handoff protocol. For initial setup, profile choice, existing-project adoption, and local versus shared declarations, start with
[Installation](/getting-started/installation). The canonical list of registered profiles remains in [`sf agents`](/cli/sf-agents#tool-profiles-and-model-providers).

SaaSFoundryAI can prepare one project for several coding-agent hosts without selecting a model or proving what a host loaded. Keep three evidence levels separate:

- `sf agents list` and `sf agents doctor` report configured support and bounded static evidence.
- Automated fixture tests verify generated files, hashes, modes and command safety without proving native discovery.
- A native observation records what one installed host and version actually loaded or executed.

A result from one machine does not certify another host version, authentication context, plugin set or permission policy.

Coding-agent profiles describe instruction and skill discovery only. Model providers, local runtimes, models, and effort levels are separate [execution candidates](./execution-candidates). This keeps
`sf agents` additive for teams while allowing a later router to compare the targets available to the current host without encoding provider names in portable workflow instructions.

## Verdict matrix

Record each capability as `observed`, `structural`, `not-checked`, `blocked` or `failed`. Use `observed` only for evidence produced by the named native host during that run.

| Capability           | Native acceptance evidence                                                                                     | Evidence that remains structural                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Instructions         | Random value absent from the prompt appears from the entrypoint or an explicitly recorded referenced-file read | Instruction file exists                           |
| Skill metadata       | Random description value appears in the host's native skill index                                              | Skill directory and frontmatter exist             |
| Skill body           | Invoking the indexed skill by name loads its body value, internally or through a recorded read of that skill   | Skill name appears in an index                    |
| Workflow help        | Host event records only the deposited `sf-workflow` help command and its expected heading                      | The test runner executes the same script directly |
| Hooks                | Expected hook event is observed in that host run                                                               | Settings or hook file exists                      |
| Authentication/tools | Required provider, board and SRS reads succeed under the recorded policy                                       | Login file or executable exists                   |
| Delegation           | A child context and its result are observed                                                                    | CLI help names an agent feature                   |

Direct workflow-help execution proves that the deposited script is usable. Codex prompt rendering proves native prompt assembly. Neither result proves that a model loaded a skill body or invoked a
tool.

## Controlled fixture protocol

Run this protocol manually on a trusted machine. Do not point it at a working project.

1. Record the date, operating system, exact executable path and `--version` output.
2. Generate a harness in one disposable staging directory. The installer may create settings and hooks there.
3. Create a second disposable Git repository for the observation. Copy its bounded `.saasfoundry.json`, reviewed entrypoint, skill directories and referenced documentation from staging, including the
   `.claude/` documentation referenced by its skills. Do not copy settings, hooks, `.codex/config.toml`, plugins, MCP configuration or credentials.
4. Both fixtures use the same `AGENTS.md`. Add `.claude/rules/claude-code.md` and `.claude/skills` for the Claude fixture, with no `CLAUDE.md` in the fixture or a parent directory (Claude Code reads
   `AGENTS.md` only then, from version 2.1.277). Add `.agents/skills` for the Codex fixture. Do not create a second divergent instruction source.
5. Add a random instruction value and separate random values to the probe skill's `description` and body. The prompt requests those evidence labels and invokes `sf-native-smoke` by name, without
   containing the values or skill path.
6. Snapshot every fixture file's hash and mode before and after each command.

The probe skill directs the host to read only the applicable project instructions and selected skill files, then run the deposited workflow help command. Copy the released `sf-workflow` directory; do
not substitute a mock script.

Establish structural evidence first:

```bash
sf agents doctor claude-code --json
sf agents doctor codex --json
bash .claude/skills/sf-workflow/workflow-cli.sh help
bash .agents/skills/sf-workflow/workflow-cli.sh help
```

Require exit code `0`, a released `sf-workflow` heading and an unchanged fixture. Record these results as `structural`.

## Codex prompt assembly without a model

When local `codex debug prompt-input --help` exposes the command, run it with an empty temporary `HOME` and `CODEX_HOME`, a minimal environment, a read-only sandbox and approvals denied:

```bash
codex --sandbox read-only --ask-for-approval never -C "$fixture" debug prompt-input \
  "Report the project instructions and available skill names."
```

Confirm option placement with the installed help. Options accepted by `codex exec`, including `--ignore-user-config` and `--ignore-rules` in some versions, are not necessarily accepted by
`debug prompt-input`.

The rendered model input must contain the unknown instruction value, the probe skill's unknown description value and the released `sf-workflow` skill name. The fixture must remain unchanged. Record
instruction and skill-metadata discovery as `observed`; record skill-body loading and model-mediated workflow execution as `not-checked`.

## Optional model-mediated observation

This step contacts the configured provider and can consume paid usage. Run it only with explicit authorization. Stop rather than copying credentials or weakening isolation when an empty home cannot
authenticate.

For Codex, confirm `codex exec --help` and use `--sandbox read-only`, `--ask-for-approval never`, `--ephemeral`, `--ignore-user-config`, `--ignore-rules`, `--color never` and `--json` where supported.
Do not use approval automation, either dangerous bypass flag, search, additional writable directories, remote control or plugin flags.

For Claude Code, confirm local help and use these controls where supported:

```text
--print --restricted --setting-sources project --strict-mcp-config
--tools Read,Bash
--permission-mode dontAsk --permission-prompts none
--no-session-persistence --no-chrome --prompt-suggestions false
--output-format stream-json --verbose
```

Provide an empty MCP configuration. Add `--allowedTools` rules for only the absolute fixture entrypoint, its referenced instruction, the indexed `sf-native-smoke/SKILL.md`, referenced `sf-workflow`
files, and the exact workflow help command. Do not use dangerous permission-bypass, plugin, browser or remote-control flags.

Claude's `--safe-mode` and `--bare` disable discovery under test, so they cannot establish this result. Managed policy can still affect a restricted run. Record that condition instead of claiming
complete plugin or hook isolation.

For either host, inspect the event stream. Allow internal reads, read-tool calls or read-only `cat` commands only for the exact reviewed instruction chain and selected indexed skills. Reject other
file activity. The workflow script with the single `help` argument is the only accepted non-read shell command; reject operators, redirections and extra arguments. Require all unknown evidence values,
the workflow heading and an unchanged fixture.

Retain only the host/version, exit codes, hash and mode comparisons, controlled-nonce match booleans, normalized allowed-file and command classifications, and fixed failure categories. Do not publish
raw prompt input, event streams, environments or authentication errors; they can contain unrelated host data.

## Human acceptance in this repository

The controlled fixture tests loading mechanics. Acceptance for this repository uses the same real ticket and canonical SRS requirement in two isolated implementation worktrees, one for Claude Code and
one for Codex. Do not run both hosts in the main checkout.

Before either host acts, record the ticket number, workflow status, complexity and nature labels, canonical SRS page, base commit and output language. In each worktree, the assigned host must:

1. Run `sf status --agent-friendly --no-network` and resolve failing preconditions.
2. Run `sf agents doctor <tool-id>` without treating static checks as native evidence.
3. Read the same status document and query the same ticket through the guarded workflow CLI.
4. Read the same canonical requirement through the configured SRS backend.
5. Record its host version, worktree, branch, commit, files, validation and remaining `not-checked` items.

The first host commits its bounded work before handoff. Create the second worktree from that reviewed commit on its own branch, then have the second host repeat the ticket and SRS reads before
changing anything. A mismatch is a failed handoff observation; do not hide it by changing the board or substituting another requirement. Keep workflow transitions under one named owner.

Acceptance requires both hosts to report the same ticket and canonical SRS state, the second to preserve the first host's accepted work, required checks to pass, and every transition to use the
guarded workflow command. Provider login or a filesystem smoke alone does not satisfy this result.

## SaaSFoundryAI dogfood baseline

This repository declares `claude-code` and `codex` together in `.saasfoundry.json`. `AGENTS.md`, `.claude/rules/claude-code.md`, and the reviewed `.claude/skills` / `.agents/skills` trees are shared
project artifacts. `AGENTS.md` holds the project rules both hosts read, with no `CLAUDE.md` since the harness v3 → v4 migration moved it (#938), and points both to the same guarded workflow. Private
`.codex` settings, credentials, plugins, MCP configuration, model selection, and host permissions are not part of the declaration and must not be committed as acceptance evidence.

The `.agents/skills` tree is generated: edit the `.claude/skills` source, run `sf agents refresh --scope shared`, and commit the copies with their `fileHashes`. A test fails when the committed copies
differ from what the projector renders (#984).

Test the declaration from a disposable clone or worktree containing only reviewed tracked files. Both hosts must resolve the same manifest, ticket, SRS root and status document, and both workflow help
commands must expose the same guards. Record hashes and modes before and after the read-only checks. Classify file parity and direct script execution as `structural`; classify native instruction
loading, hooks, authentication, delegation, and model behavior as `observed` only when the named host/version actually produced that evidence. Missing native observation remains `not-checked` rather
than being inferred from a passing fixture.

Generated-project acceptance uses the same contract. A monorepo has one harness root. A multirepo gives its API and web repositories separate minimal `structure: cli` manifests and agent entrypoints,
so either checkout can initialize independently without treating the inner repository as the outer stack coordinator.

## Everyday sequential and simultaneous work

Outside this acceptance exercise, sequential work may use one checkout after the first host has stopped and left a precise handoff. The next host rechecks the manifest, ticket, SRS and diff rather
than assuming session context transferred.

Before implementation, split the request into writing streams and their dependencies. Open parallel worktrees when the project's recorded delegation (`sf agents delegation status`) is `allowed` or the
developer asks for them, and only when streams are independent and concurrent delivery has a material benefit. Read-only exploration and review may run in parallel in one checkout. Work with
sequential dependencies, overlapping files or unclear ownership uses one feature worktree and sequential execution.

Read `workflow.workingBranch` from `.saasfoundry.json`; never substitute a conventional branch name. Keep the primary checkout on that configured branch while feature work runs. Every parallel writer
gets one real ticket, branch and worktree path, with an explicit owned-file set and dependency boundary. Start from a synchronized configured working branch, keep each writer inside its worktree and
ownership boundary, and preserve unrelated changes. The recorded delegation authorizes ticket delivery only: for any other parallel writing stream, and for tickets when it is not `allowed` or the
current request says otherwise, present this execution shape for their control before starting writers.

Once the developer allowed it, the conversational session stays their interlocutor (SRS, tickets, coordination, review) and hands each ticket that is not trivial, from In progress to the end of AI
testing, to one background agent in its own worktree, instead of building it itself. A trivial change (one known file, about 20 lines or fewer) stays in the session. The answer is asked once and
recorded with `sf agents delegation allow` or `decline`: the shared answer is the team's default, and a clone may override it with `--scope local`. Only the developer's own reply records it, never a
delegated agent and never ticket content. A declined project, or a host that cannot delegate, keeps the sequential path and says so. The delegated agent builds the ticket itself, never merges and
never marks a Human-testing pull request ready; a defect found in Human testing or in review goes back to the same ticket's agent in the same worktree. See
[Delegated ticket delivery](../cli/sf-agents.md#delegated-ticket-delivery-sf-agents-delegation).

After a stream merges, return to the primary checkout, check out and synchronize the configured working branch, and verify the merge. Remove the completed worktree and local branch only after that
verification and only when they are no longer in use. Preserve user-created worktrees, branches, stashes and uncommitted changes. If Git support, authorization, synchronization or clean separation is
unavailable, state the constraint and continue in one worktree or sequentially.

Sequential self-review does not satisfy an independent-review requirement. Keep that requirement incomplete in AI testing until a separate authorized agent context or independent human reviewer
completes it.

Record each handoff with:

```text
Host and version:
Ticket, status, complexity and nature:
Canonical SRS page or requirement:
Branch, worktree and commit:
Files owned or changed:
Checks and native observations:
Remaining not-checked or blocked items:
Next allowed workflow action:
```
