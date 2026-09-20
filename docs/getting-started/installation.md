# Installation

## Start with your situation

SaaSFoundryAI supports three starting points. Choose the one that describes the files in front of you before running a command.

| Starting point                                                       | Safe entry                                                                       | What happens                                                                                                                    |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| A managed SaaSFoundryAI project already contains `.saasfoundry.json` | `sf status --agent-friendly --no-network`, then `sf update` or `sf agents`       | The existing manifest remains the source of truth. Updates and agent declarations are applied without recreating the project.   |
| An empty workspace or a new product                                  | `sf new`                                                                         | Choose the technical stack, AI harness, or both.                                                                                |
| An existing repository without a SaaSFoundryAI manifest              | Read it first, then choose `sf new --profile harness` or a fresh `full` scaffold | A project you keep receives the harness in place. A throwaway POC is preserved as reference before a clean scaffold is created. |

The detailed choices for each path are below. The [Quick Start](/getting-started/quick-start) is the shortest runnable example.

## Assistant-first setup

For Claude Code, give the assistant this line from the folder you want to work in:

> Install the SaaSFoundryAI skill from https://github.com/DiamondForgeFr/SaasFoundryAI

The current user-scope bootstrap installs `tool-saasfoundry` into Claude Code's skill directory:

```bash
npx saasfoundryai-cli@beta skill install --yes --force
```

Use `--project` to place that meta-skill in the repository for review and team sharing.

This bootstrap path is currently native to Claude Code. With Codex, Gemini CLI, Kimi Code, Qwen Code, or another coding-agent host, start with the CLI path below, select the appropriate profiles, then
open the generated project in that host. The generated harness itself supports several coding-agent profiles; installing the assistant-facing meta-skill and configuring the project harness are
separate operations.

## Prerequisites

- **Node.js 24.19.0**, as pinned by generated `.nvmrc` files
- **npm 11 or newer**
- **Git**
- **Docker**, when you choose Docker-managed database or storage services
- At least one coding-agent runtime if you want AI-assisted development

Generated projects use npm workspaces and a `package-lock.json`. yarn and pnpm are not validated against the generated dependency graph.

You can execute the CLI without a global install:

```bash
npx saasfoundryai-cli@beta new
```

Or install it globally:

```bash
npm install -g saasfoundryai-cli@beta
sf --version
```

## Situation 1: an existing managed project

A managed project contains `.saasfoundry.json`. Inspect it before changing anything:

```bash
sf status --agent-friendly --no-network
sf agents list --json
```

Use `sf update` to refresh the installed SaaSFoundryAI files or add supported modules. Use `sf agents` to change coding-agent declarations:

```bash
# Personal to this checkout; tracked files stay unchanged
sf agents enable codex

# Shared through the repository as a reviewable diff
sf agents enable codex --scope shared

# Replace one scope's declaration with an exact non-empty set
sf agents replace claude-code codex --scope shared

# Refresh generated agent surfaces after a harness update
sf agents refresh
```

Local scope is the default and is private to the current checkout or worktree. Shared scope writes the declaration and generated surfaces that the team can review and commit. Enabling one profile does
not disable another profile.

## Situation 2: an empty workspace

Run the interactive flow:

```bash
sf new
```

The first decision is the installation profile:

| Profile   | Installs                                                                               | Choose it when                                                                      |
| --------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `full`    | Technical stack plus workflow, skills, SRS options and coding-agent instructions       | You are starting a product from scratch, or rebuilding a throwaway POC              |
| `harness` | The AI collaboration layer in the current repository                                   | You already have code you intend to keep                                            |
| `stack`   | The technical scaffold and core helper deposits, without workflow or SRS configuration | You deliberately want the technical base without the managed collaboration workflow |

For `full` and `harness`, select one or several registered coding-agent profiles. A scripted example is:

```bash
sf new --non-interactive \
  --profile full \
  --project-name my-saas \
  --structure monorepo \
  --agents claude-code,codex \
  --setup-repo local \
  --db-setup docker \
  --db-type postgresql \
  --email-service none \
  --s3-setup manual \
  --no-analytics
```

Omitting `--agents` keeps the historical Claude Code declaration. The completion screen reports the effective profiles and their instruction entrypoints without claiming that the runtimes were
installed or loaded them.

## Situation 3: an existing repository or POC

First decide whether the existing code remains the product.

### Keep and continue the existing repository

Install the harness in place:

```bash
cd existing-project
sf new --profile harness
```

This path creates no project directory and does not scaffold a replacement API, web app, database, storage or email module. It deposits the collaboration layer in the existing repository and writes a
minimal managed manifest.

If that managed harness project later needs a clean SaaSFoundry technical stack at non-conflicting paths, preview the additive promotion with:

```bash
sf update --target-profile full --dry-run --json
```

This does not merge or replace the external application's existing technical files. If the current code remains the product, keep the project on the harness path whenever the preview reports
conflicts.

### Rebuild from a throwaway POC

Let the `tool-saasfoundry` intake read the code first. Review its findings and move plan. Only after explicit approval does it place the existing experiment under `POC/` and create a clean `full`
project beside it. The old code remains available as reference; it is never silently deleted or overwritten.

Do not run a full scaffold inside a POC directory and do not move a repository that the user intends to keep.

## Choose coding-agent profiles

Profiles identify coding tools and their instruction-discovery surfaces. They do not select a model provider, model name, API credential or reasoning level.

The registered IDs are `claude-code`, `codex`, `kimi`, `gemini-cli`, `qwen-code`, and `generic`. See the single canonical [`sf agents` profile matrix](/cli/sf-agents#tool-profiles-and-model-providers)
for current evidence and limitations.

After installation:

```bash
sf agents list --json
sf agents doctor codex
sf status --agent-friendly --no-network
```

`list` reports shared, local and effective declarations. `doctor` inspects bounded static evidence. Neither command proves authentication, permissions, hooks, native skill activation or model
availability.

## Platforms

The project test suite exercises the CLI and generated shell workflows on macOS and Linux. Windows users should use WSL for the same environment. In V1, `sf update --target-profile full` explicitly
supports macOS, Linux, and WSL; it rejects native Windows before mutation because the profile-transition transaction requires directory durability guarantees not currently provided there. Other native
Windows commands may work, but `sf agents doctor --check-runtime` reports executable-extension lookup as `not-checked`; verify the chosen host directly instead of treating file presence as runtime
proof.

cmux is an optional macOS workspace. It is not required for SaaSFoundryAI or for any coding-agent profile.

## Documentation after installation

Run the bundled documentation locally, without relying on a hosted site:

```bash
sf docs
```

The generated project also contains its own `README.md`, harness documentation and agent entrypoints. Use the [First Project](/getting-started/first-project) tutorial for a complete walkthrough and
[Agent coexistence](/guide/agent-coexistence) for the stricter native-verification and handoff protocol.
