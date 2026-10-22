# sf update

Evolve a managed project safely. `sf update` is the lifecycle command for an existing SaaSFoundryAI project. It discovers the project through `.saasfoundry.json`, migrates managed metadata and modules
when required, compares upstream templates with your current files, and can add capabilities you did not select at creation time.

```bash
sf update [options]
```

::: tip Preview first

Use `sf update --dry-run --json` before an automated or substantial update. A preview does not write project files or run installers, and its versioned report always states `"mutated": false`.

:::

## The update lifecycle

| Stage                      | What `sf update` does                                                                                                | Safety boundary                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **1. Discover**            | Reads the root manifest and classifies the technical stack, harness, topology, modules, and versions.                | A missing or inconsistent manifest stops the normal update.        |
| **2. Recover and migrate** | Recovers an interrupted technical transition, then runs pending manifest and module migrations on an applied update. | Version stamps advance only after their migration succeeds.        |
| **3. Plan**                | Recreates the selected template in isolation and computes module additions or a profile transition.                  | Dry run keeps generation and provider effects isolated.            |
| **4. Compare**             | Compares recorded base hashes, current bytes, and new template hashes.                                               | User changes become explicit conflicts.                            |
| **5. Apply**               | Writes safe additions/updates and follows the selected conflict strategy.                                            | The default writes sidecars instead of overwriting diverged files. |
| **6. Record**              | Persists the resulting capabilities, module versions, ports, ownership, and new baselines.                           | Future runs start from the last completed state.                   |

Run the command from the directory that owns the relevant `.saasfoundry.json`. For a multirepo profile transition, that is the root coordinator, not an API or web projection.

## The manifest is the shared contract

`.saasfoundry.json` connects three concerns:

- **CLI reproduction:** topology, ports, selected modules, providers, and generation choices tell the current CLI what the project is.
- **Safe ownership:** `fileHashes` records the content SaaSFoundry last managed; `unmanagedPaths` keeps adopted or user-owned paths outside that boundary.
- **Development harness:** workflow, agent, tool, and SRS configuration tells coding hosts which project rules and integrations are active.

Commit manifest changes with the files they describe. Do not copy a manifest from another project or edit hashes by hand: the update algorithm relies on their relationship to the actual repository.

## Preview without mutation

Human-readable preview:

```bash
sf update --dry-run
```

Machine-readable preview:

```bash
sf update --dry-run --json > saasfoundry-update-plan.json
```

`--json` requires `--dry-run`. The CLI reserves stdout for one versioned JSON object and sends diagnostics to stderr. A report can list template actions, pending module migrations with the change each
would make (`moduleMigrations`), module selections, profile-transition blockers, reason codes, and executable remediation without exposing candidate file contents or requiring provider secrets.

A dry run does not become an authorization token for a normal update. Review it, keep the Git tree clean, then run the apply command with the same intent.

## Three-way file comparison

For each managed path, the CLI compares:

| Input       | Meaning                                                | Source                             |
| ----------- | ------------------------------------------------------ | ---------------------------------- |
| **Base**    | The bytes last recorded as managed.                    | `.saasfoundry.json` → `fileHashes` |
| **Current** | The bytes currently in your working tree.              | Read at update time.               |
| **Target**  | The bytes the current CLI generates for this manifest. | Isolated regeneration.             |

That produces conservative actions:

| Situation                                                            | Result                                           |
| -------------------------------------------------------------------- | ------------------------------------------------ |
| Template did not change.                                             | No action.                                       |
| Template changed and current still equals base.                      | Update in place.                                 |
| You already have the target bytes.                                   | No action.                                       |
| Template and current both diverged from base.                        | Conflict strategy.                               |
| Target adds a path that is absent.                                   | Add it.                                          |
| Target adds a path occupied by different user bytes.                 | Conflict strategy.                               |
| Target removed a managed file and current still exactly equals base. | Remove it through the guarded managed-file path. |
| Target removed a file you changed.                                   | Preserve it.                                     |

Paths recorded in `unmanagedPaths` stay outside the ownership map. A new template or module path occupied by different current bytes becomes a conflict. A late module is staged away from the project
and passed through those collision checks before its version or dependencies are committed.

## Conflict strategies

| Strategy             | Diverged-file behavior                                             | Use when                                                                              |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `save-new` (default) | Keeps your file and writes the target as `<path>.saasfoundry.new`. | You want a reviewable manual merge.                                                   |
| `keep`               | Keeps your file and writes no sidecar.                             | Your version is deliberately authoritative.                                           |
| `replace`            | Overwrites your file with the generated target.                    | You have committed or backed up the tree and intentionally want the template version. |

```bash
sf update --accept-template-updates --conflict-strategy save-new
```

`--accept-template-updates` skips the interactive confirmation for non-conflicting template changes. It does not turn `save-new` or `keep` conflicts into successful module installation: unresolved
module collisions keep that module unstamped and skip its dependency refresh until you resolve the paths and rerun.

::: danger `replace` discards local bytes

The CLI does not create a backup of the overwritten file. Commit the working tree first and inspect the preview before choosing `replace`.

:::

## Migrations and recovery

Updates can involve three distinct mechanisms:

1. **Manifest migrations** bring older manifest schemas to the current version.
2. **Module migrations** run each installed module's ordered migration chain and advance its module version only after success.
3. **Template refresh** applies the file comparison above; it is not itself a production database migration.

### CLAUDE.md moves to AGENTS.md (harness v4)

`AGENTS.md` is the single instruction file every coding agent reads, Claude Code included (2.1.277 or later). A project installed before it keeps its instructions in `CLAUDE.md`, and Claude Code
ignores `AGENTS.md` while a `CLAUDE.md` exists. The harness v3 → v4 migration moves them, section by section, in the root and in each app of a monorepo or multirepo:

| `CLAUDE.md` section                                                                     | Where it lands                                                                                      |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Your own sections, the `## Workflow System` section                                     | `AGENTS.md`, verbatim and in the same order                                                         |
| A template section still identical to a version SaaSFoundry shipped                     | `AGENTS.md`, in its current tool-neutral wording                                                    |
| A shipped section the generated region now holds (onboarding, capabilities, file edits) | Dropped: the `saasfoundry:generated` region at the end of `AGENTS.md` regenerates it                |
| An edited copy of one of those sections                                                 | `AGENTS.md`, verbatim under **Kept from CLAUDE.md for review**: merge what you need, then delete it |
| Claude-only notes (session hook, `/sf-<name>` skills, permissions)                      | `.claude/rules/claude-code.md`, deposited when Claude Code is declared                              |

`CLAUDE.md` is removed only once `AGENTS.md` is written and every moved section is read back in it. If `AGENTS.md` is a file you wrote rather than the generated bridge, nothing is overwritten: the
proposal goes to `AGENTS.md.saasfoundry.new` and both files stay until you merge them. A `CLAUDE.local.md` is never deleted; the update reports it, because while it exists Claude Code still ignores
`AGENTS.md`.

The generated bridges are recognised by their bytes, whichever release wrote them: the published v1.0.0 and v1.0.1 as well as the current CLI. A `CLAUDE.md` that is only the generated bridge to an
`AGENTS.md` is removed, because it hides `AGENTS.md` from Claude Code; it is not treated as a `CLAUDE.md` you wrote, which would have left your `AGENTS.md` beside a sidecar. An `AGENTS.md` that is
only the generated bridge to your `CLAUDE.md` is replaced, not kept as a file of yours.

Preview the move first: `sf update --dry-run --json` lists every section under `moduleMigrations`, with its action (`move`, `refresh`, `drop`, `keep-for-review`), its source and its target.

When adding a technical stack to a harness project, SaaSFoundry uses a journaled transaction. A later `sf update --target-profile full` first attempts safe recovery if a previous process stopped
mid-transition. If it cannot prove a complete commit or safe rollback, it stops and reports the unresolved paths rather than guessing.

Application database changes remain an operator action. Review generated Prisma or SQL changes and use the generated project commands appropriate to your environment; `sf update` does not promise to
migrate production data.

### Tier agents

Every update refreshes the [tier agents](/cli/sf-agents#tier-agents) of the declared coding agents from the current routing grid and the project's `routing` overrides: an untouched file is rewritten,
an edited one gets a `.saasfoundry.new` sidecar. A managed harness without an `agents` list is treated as Claude Code and receives the `.claude/agents/sf-<tier>.md` files only; its other instruction
files are left as they are.

### Delegation capture and permissions (harness v5)

`.claude/settings.json` is your file, and `sf update` keeps two things current in it on **every run**, with no prompt and no flag (`--non-interactive` included):

- the **hooks** that record each routed delegation in the clone's ledger (`SubagentStop` for the `sf-<tier>` agents, `PostToolUse` on the delegation tool), see
  [capture and signals](/cli/sf-agents#capture-and-signals);
- the **permission rules** that let the agent read a route, the delegation consent and the routing report without asking, while the forms that write evidence (`--record`, `--retry-of`) still ask.

It is the same merge as `sf agents refresh --scope shared`, so `sf agents refresh` is no longer required after an update for these. The harness v4 → v5 migration (`wire-delegation-capture`) is that
merge too: a harness installed by an earlier release, v1.0.1 included, gets it on the update that raises it to v5, together with the tier agents and the `AGENTS.md` move that every update already did.
Nothing else is deposited by the migration, and it never writes the consent to delegate: only your own answer records it (`sf agents delegation`).

| Situation                                                                                                                                   | Result                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| The file lacks the hooks or the rules.                                                                                                      | They are merged in. Your own keys, hooks and rules stay, in their order; the summary names the file.                                           |
| The file has everything.                                                                                                                    | Nothing is written: same bytes, same modification time, nothing printed.                                                                       |
| There is no file.                                                                                                                           | It is created with the harness's hooks and rules.                                                                                              |
| The file is a symbolic link, a hard link, or text that is not a JSON object.                                                                | It is left as it is and the merged proposal goes to `.claude/settings.json.saasfoundry.new`; the update goes on.                               |
| `hooks` is not an object, a hook event is not a list of hook groups, `permissions` is not an object, or its `allow` or `ask` is not a list. | Same: it is left as it is and the proposal goes to the sidecar, with the reason in the summary. Merging would have overwritten what you wrote. |
| The hook is the bare `sf agents outcome capture` command a first build wrote.                                                               | It is replaced by the command that resolves the project's own CLI.                                                                             |

**A plain `sf update` only adds.** It never removes a rule from your `permissions`, so a rule you added on purpose stays, run after run. The only rules the harness ever takes away are the two that a
pre-release build had pre-approved, `Bash(sf agents outcome record *)` and `Bash(sf agents outcome mark *)`: they write evidence the routing acts on, so the harness keeps them asking. That happens
**once, in the harness v4 → v5 migration, and in `sf agents refresh`**, never in the every-update merge, and each rule removed is named in the output (and in the preview of `--dry-run`).

It applies to the root of the project, and to each app repository of a multirepo project that has a `.claude/`. It skips a harness with `managed: false`, one whose declared agents leave Claude Code
out, and a reference-only adoption, whose instructions ask the agent not to change settings, hooks or permissions.

A generated project starts from the same hooks and rules: the three `.claude/settings.json` templates of the scaffold carry them. Because the merge owns the file, it is no longer part of the template
comparison: a template change never turns a file the merge brought up to date into a conflict.

Preview it: `sf update --dry-run` lists the file under `harnessSettings` of the report (`merged`, `created`, `sidecar`), or in the preview of the pending `wire-delegation-capture` migration when the
harness is still below v5.

## Add capabilities after creation

Interactive module selection:

```bash
sf update
```

Scripted preview and apply:

```bash
sf update --dry-run --json --add-modules email,analytics
sf update --non-interactive --add-modules email,analytics
```

Available choices depend on what the manifest already contains. The catalogue includes email, storage, analytics, PWA, SRS, supported tool skills, and the harness compatibility spelling used by stack
projects. Re-requesting an installed module is skipped.

### Converge to the full profile

V1 profile transitions are additive:

| Current profile             | `--target-profile full`                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `harness`                   | Plans and adds a monorepo or multirepo technical stack when every candidate path is absent or byte-identical. |
| `stack`                     | Adds the managed development harness. `--add-modules harness` is the compatibility spelling.                  |
| `full`                      | Succeeds as a no-op.                                                                                          |
| multirepo `projection`      | Stops and directs the transition to the root coordinator.                                                     |
| `unknown` or `inconsistent` | Stops with manifest remediation.                                                                              |

It does not remove modules, split or combine repositories, convert monorepo↔multirepo, or transition away from `full`.

```bash
sf status --json --no-network
sf update --target-profile full --dry-run --json
sf update --target-profile full
```

For a non-interactive harness → full transition, provide every required technical choice:

```bash
sf update --non-interactive \
  --target-profile full \
  --structure monorepo \
  --db-setup manual \
  --db-type postgresql \
  --email-service none \
  --s3-setup manual \
  --no-analytics \
  --pwa
```

An unmanaged collision at a generated technical path blocks the entire initial stack addition; conflict strategies cannot force that adoption. Profile-transition execution requires macOS, Linux, or
WSL in V1. Native Windows stops before mutation.

## Adopt a verified beta project

A project generated before manifests cannot use the normal lifecycle until it has a trustworthy baseline. V1 supports only the verified multirepo output of the published `saasfoundry-cli@1.0.0-beta`
package.

Preview and capture the fingerprint:

```bash
sf update --adopt-legacy --dry-run --json \
  --project-name my-app \
  --main-branch main
```

Apply exactly that reviewed plan:

```bash
sf update --adopt-legacy \
  --project-name my-app \
  --main-branch main \
  --adopt-plan <fingerprint>
```

Adoption verifies the historical layout and inspected bytes, then writes only `.saasfoundry.json`. It never replaces an existing manifest. Any inspected change invalidates the fingerprint. Adoption
flags cannot be mixed with module, workflow, stack, SRS, or credential options; run a normal update afterwards.

The published beta did not generate monorepos, so synthetic or reconstructed beta monorepo layouts are not eligible.

## Automation and secrets

Keep credentials out of generated planner commands and shell history. Apply-time environment variables include:

| Secret              | Environment variable            |
| ------------------- | ------------------------------- |
| Database password   | `SF_UPDATE_DB_PASSWORD`         |
| MailerSend API key  | `SF_UPDATE_MAILERSEND_API_KEY`  |
| S3 access key       | `SF_UPDATE_S3_ACCESS_KEY`       |
| S3 secret key       | `SF_UPDATE_S3_SECRET_KEY`       |
| Context7 API key    | `SF_UPDATE_CONTEXT7_API_KEY`    |
| Atlassian API token | `SF_UPDATE_ATLASSIAN_API_TOKEN` |
| Notion API token    | `SF_UPDATE_NOTION_API_TOKEN`    |
| Figma API token     | `SF_UPDATE_FIGMA_API_TOKEN`     |

Example:

```bash
SF_UPDATE_MAILERSEND_API_KEY="$MAILERSEND_KEY" \
  sf update --non-interactive \
  --add-modules email \
  --accept-template-updates
```

## Recovery checklist

Before applying a substantial update:

```bash
git status
sf status --agent-friendly --no-network
sf update --dry-run --json > saasfoundry-update-plan.json
```

Then:

1. Commit or otherwise back up the current tree.
2. Review the report and resolve blockers.
3. Apply with the default `save-new` strategy unless overwrite is intentional.
4. Inspect `git diff` and every `.saasfoundry.new` sidecar.
5. Merge or discard sidecars deliberately, then remove them.
6. Run the generated project's build, lint, tests, and any required database procedure.
7. Commit the updated files and `.saasfoundry.json` together.

If the command fails, read its recovery message and rerun the same lifecycle command after correcting the reported cause. Do not delete transition journals or rewrite ownership hashes manually.

## Options

| Flag                                                                | Description                                                                      | Default    |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------- |
| `--non-interactive`                                                 | Fail if required values are missing instead of prompting.                        | -          |
| `--dry-run`                                                         | Preview without writing files or running installers.                             | -          |
| `--json`                                                            | With `--dry-run`, emit one versioned JSON object on stdout.                      | -          |
| `--target-profile <profile>`                                        | Add the missing capability to reach `full`; V1 supports `full` only.             | -          |
| `--project-description <text>`                                      | Description used when a harness project adds the technical stack.                | derived    |
| `--structure <structure>`                                           | `monorepo` or `multirepo` for harness → full.                                    | -          |
| `--db-setup <setup>`                                                | `docker`, `credentials`, or `manual`.                                            | -          |
| `--db-type <type>`                                                  | `postgresql` or `sql`.                                                           | -          |
| `--db-host`, `--db-port`, `--db-user`, `--db-password`, `--db-name` | Database choices for credential-based setup.                                     | -          |
| `--api-port`, `--web-port`                                          | Explicit API and web host ports.                                                 | automatic  |
| `--email-service <service>`                                         | `none` or `mailersend`.                                                          | -          |
| `--analytics` / `--no-analytics`                                    | Include or omit analytics in a new stack.                                        | -          |
| `--pwa` / `--no-pwa`                                                | Include or omit PWA support.                                                     | -          |
| `--accept-template-updates`                                         | Apply non-conflicting template updates without prompting.                        | -          |
| `--conflict-strategy <strategy>`                                    | `keep`, `replace`, or `save-new`.                                                | `save-new` |
| `--add-modules <modules>`                                           | Comma-separated modules to add.                                                  | -          |
| `--workflow <preset>` / `--no-workflow`                             | Configure `solo`, `saasfoundry`, `none`, or no workflow when adding the harness. | -          |
| `--adopt-legacy`                                                    | Inspect or adopt verified beta multirepo output.                                 | -          |
| `--adopt-plan <fingerprint>`                                        | Apply the exact reviewed legacy-adoption plan.                                   | -          |
| `--project-name <name>`                                             | Original generated name used for legacy verification.                            | directory  |
| `--main-branch <branch>`                                            | Shared legacy branch when it cannot be proven automatically.                     | detected   |
| `--s3-setup <setup>`                                                | Storage setup for a transition or applicable module addition.                    | -          |
| `--srs-backend <backend>`                                           | SRS backend when adding SRS; V1 supports `notion`.                               | -          |
| `--srs-parent-page-input <url>`                                     | SRS root page URL or ID.                                                         | -          |

Credential and integration-specific flags are available for enabled modules. Use `sf update --help` for the exhaustive current surface.

## Continue the lifecycle

- [Understand the complete update model](/guide/updating-projects)
- [Inspect project status](/cli/sf-status)
- [Compare monorepo and multirepo](/guide/monorepo-vs-multirepo)
- [Review the SRS lifecycle](/srs/lifecycle)
