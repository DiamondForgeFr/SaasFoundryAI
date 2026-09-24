# sf new

Turn your choices into a managed project. `sf new` creates a SaaSFoundryAI project and the contract that lets the CLI and your coding agents evolve it safely. Use the guided wizard for a first
project, or provide the same choices as flags in automation.

```bash
sf new [options]
```

## The creation lifecycle

| Stage                          | What happens                                                                                             | What you get                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **1. Choose a profile**        | Select the SaaS stack, the development harness, or both.                                                 | Only relevant questions are shown.                            |
| **2. Describe the project**    | Choose its name, topology, repository setup, ports, and optional services.                               | A complete, validated generation plan.                        |
| **3. Configure collaboration** | Select coding-agent hosts, workflow, tools, and optional SRS.                                            | Shared instructions and skills for the selected hosts.        |
| **4. Generate**                | SaaSFoundry renders files, initializes repositories when requested, and can start local services.        | A working project or an added harness.                        |
| **5. Record the contract**     | The CLI writes `.saasfoundry.json` with choices, capabilities, versions, ports, and managed-file hashes. | Future `sf status` and `sf update` runs do not need to guess. |

The manifest is shared project metadata. Commit it: the CLI reads it to reproduce the selected architecture, while the development harness reads it to understand the workflow, tools, SRS backend, and
repository boundaries.

## Choose what SaaSFoundry manages

`--profile` is the first decision because it changes the rest of the journey.

| Profile   | Installs                                                                        | Best fit                                                                                   |
| --------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `full`    | Technical SaaS stack **and** development harness                                | A new product built and delivered with SaaSFoundryAI. This is the default.                 |
| `stack`   | Technical scaffold and core helper deposits, without managed workflow or SRS    | You want the prebuilt SaaS architecture but use another delivery process.                  |
| `harness` | Workflow, skills, agent entrypoints, and optional SRS in the current repository | You already have a codebase and want the development system without replacing the product. |

`harness` does not create a project directory or overlay the SaaS stack. Run it from the existing repository root. Stack-only questions such as database, storage, email, and PWA are skipped.

In non-interactive mode, the profile defaults to `full` for compatibility with earlier scripted invocations.

## Interactive journey

Start the wizard:

```bash
sf new
```

Questions are conditional. A `full` project asks for the technical architecture and collaboration harness; a `stack` project skips agent/workflow questions; a `harness` project skips product-stack
questions. The CLI validates required combinations before generation instead of leaving a partially described project.

For `full` and `harness`, the supported coding-agent host IDs are `claude-code`, `codex`, `kimi`, `gemini-cli`, `qwen-code`, and `generic`. They identify the host integration, not the model provider.
Model credentials and routing remain in each developer's host configuration.

::: tip CLI or assistant?

The assistant-led setup uses this same generator and manifest contract. Choose the interface that suits you; the resulting project remains compatible with the same `sf status` and `sf update`
lifecycle. See [CLI or assistant setup](/getting-started/setup-paths).

:::

## Repository topology

Both application topologies are supported:

- **Monorepo:** API, web app, harness, and root manifest live in one repository.
- **Multirepo:** the coordinator records the generated API and web repositories; each application repository receives the harness entrypoints it needs.

Topology affects repository boundaries, not the product capabilities. Review [monorepo versus multirepo](/guide/monorepo-vs-multirepo) before choosing. `sf update` can add missing capabilities later,
but V1 does not convert one topology into the other.

## The ownership boundary

SaaSFoundry records hashes for files it generated and still manages. Those hashes become the **base** of the next three-way update comparison:

```text
recorded base + current project + current template = safe update plan
```

- Managed files can receive non-conflicting template improvements.
- Files you change are detected as diverged; the default update strategy preserves them and writes the new template beside them.
- Paths explicitly recorded in `unmanagedPaths` remain outside the template ownership boundary.
- A new template path already occupied by different current bytes is treated as a conflict instead of being overwritten silently.

This is why `.saasfoundry.json` belongs in version control. Its ownership map is authoritative: inspect it when adopting or restructuring files, and do not hand-edit hashes to silence a conflict.
Resolve the files and let `sf update` write the next verified baseline.

## Ports

Default local ports scan forward when already in use:

| Service    | Default | Automatic behavior       |
| ---------- | ------: | ------------------------ |
| PostgreSQL |  `5435` | Uses the next free port. |
| API        |  `3500` | Uses the next free port. |
| Web        |  `5173` | Uses the next free port. |

An explicit port is never moved silently. If `--api-port 3500` is requested and unavailable, generation stops and explains the conflict. Database ports for `credentials` or `manual` setups refer to an
external service and are passed through unchanged.

Resolved ports are stored under `ports` in `.saasfoundry.json` and rendered consistently into the generated environment, Compose, Vite, and documentation files.

## Scripted examples

Create a full monorepo for two coding-agent hosts:

```bash
sf new --non-interactive \
  --profile full \
  --project-name my-saas \
  --agents claude-code,codex \
  --structure monorepo \
  --setup-repo local \
  --db-setup docker \
  --db-type postgresql \
  --email-service none \
  --no-analytics \
  --start-services \
  --start-apps all
```

Create the same product boundary as separate application repositories:

```bash
sf new --non-interactive \
  --profile full \
  --project-name my-saas \
  --agents codex \
  --structure multirepo \
  --setup-repo existing \
  --backend-repo-url git@github.com:acme/my-saas-api.git \
  --frontend-repo-url git@github.com:acme/my-saas-web.git \
  --db-setup docker \
  --db-type postgresql \
  --email-service none \
  --no-analytics \
  --start-apps none
```

Add only the harness to the current repository:

```bash
sf new --profile harness --agents codex,claude-code
```

Enable SRS with its currently supported Notion backend:

```bash
sf new --non-interactive \
  --project-name my-saas \
  --structure monorepo \
  --setup-repo local \
  --db-setup docker \
  --db-type postgresql \
  --email-service none \
  --no-analytics \
  --advanced-skills notion \
  --srs-enable \
  --srs-backend notion \
  --srs-parent-page-input "https://www.notion.so/your-workspace/SRS-root-abc123"
```

## Verify the result

From the generated project root:

```bash
sf status --claude-friendly --no-network
git status
```

The first command reports the effective profile, topology, modules, tools, and any actionable configuration issue without contacting external services. Review and commit the generated files, including
`.saasfoundry.json`, before starting feature work.

For local startup commands, follow the generated README because they depend on the chosen topology and service options.

## Options

| Flag                                             | Description                                                       | Default        |
| ------------------------------------------------ | ----------------------------------------------------------------- | -------------- |
| `--profile <profile>`                            | Install `full`, `harness`, or `stack`.                            | `full`         |
| `--agents <agents>`                              | Comma-separated coding-agent host IDs for the harness.            | legacy Claude¹ |
| `--non-interactive`                              | Fail when a required value is missing instead of prompting.       | -              |
| `--project-name <name>`                          | Project name in kebab-case.                                       | -              |
| `--project-description <description>`            | Product description.                                              | -              |
| `--structure <structure>`                        | `monorepo` or `multirepo`.                                        | -              |
| `--main-branch <branch>`                         | `main` or `master`.                                               | -              |
| `--setup-repo <setup>`                           | `local` or `existing`.                                            | -              |
| `--monorepo-url <url>`                           | Existing monorepo remote URL.                                     | -              |
| `--backend-repo-url <url>`                       | Existing API remote URL for multirepo.                            | -              |
| `--frontend-repo-url <url>`                      | Existing web remote URL for multirepo.                            | -              |
| `--db-setup <setup>`                             | `docker`, `credentials`, or `manual`.                             | -              |
| `--db-type <type>`                               | `postgresql` or `sql`.                                            | -              |
| `--db-port <port>`                               | Database host port.                                               | `5435`         |
| `--api-port <port>`                              | API host port.                                                    | `3500`         |
| `--web-port <port>`                              | Web host port.                                                    | `5173`         |
| `--email-service <service>`                      | `none` or `mailersend`.                                           | -              |
| `--s3-setup <setup>`                             | `docker`, `credentials`, or `manual`.                             | -              |
| `--analytics` / `--no-analytics`                 | Include or skip analytics.                                        | -              |
| `--pwa` / `--no-pwa`                             | Include or skip installable-app support.                          | on             |
| `--advanced-skills <skills>`                     | Comma-separated `context7,atlassian,notion,figma`.                | -              |
| `--srs-enable` / `--no-srs-enable`               | Enable or skip the [SRS module](/modules/srs).                    | -              |
| `--srs-backend <backend>`                        | SRS backend; V1 supports `notion`.                                | -              |
| `--srs-parent-page-input <url>`                  | SRS root page URL or ID.                                          | -              |
| `--srs-ingest-enable` / `--no-srs-ingest-enable` | Configure one-shot ingestion of existing notes.                   | -              |
| `--srs-ingest-parent-input <url>`                | Source parent page for ingestion.                                 | -              |
| `--workflow <config>` / `--no-workflow`          | Choose a workflow preset, `none`, or omit workflow configuration. | -              |
| `--start-services` / `--no-start-services`       | Start or skip local database and storage services after setup.    | -              |
| `--start-apps <mode>`                            | Start `all`, `backend`, `frontend`, or `none`.                    | -              |

¹ Compatibility fallback when `--agents` is omitted. An explicit selection is stored in `modules.harness.agents`.

Credential flags are available for the selected database, MailerSend, storage, and tool integrations. Use `sf new --help` for the current exhaustive surface; options are validated only when their
module is relevant.

## Continue the lifecycle

- [Inspect the generated architecture](/guide/project-structure)
- [Understand monorepo and multirepo boundaries](/guide/monorepo-vs-multirepo)
- [Ship the first ticket](/getting-started/shipping-first-ticket)
- [Preview and apply safe updates](/cli/sf-update)
