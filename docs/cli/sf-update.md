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

`--json` requires `--dry-run`. The CLI reserves stdout for one versioned JSON object and sends diagnostics to stderr. A report can list template actions, module selections, profile-transition
blockers, reason codes, and executable remediation without exposing candidate file contents or requiring provider secrets.

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

When adding a technical stack to a harness project, SaaSFoundry uses a journaled transaction. A later `sf update --target-profile full` first attempts safe recovery if a previous process stopped
mid-transition. If it cannot prove a complete commit or safe rollback, it stops and reports the unresolved paths rather than guessing.

Application database changes remain an operator action. Review generated Prisma or SQL changes and use the generated project commands appropriate to your environment; `sf update` does not promise to
migrate production data.

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
sf status --claude-friendly --no-network
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
