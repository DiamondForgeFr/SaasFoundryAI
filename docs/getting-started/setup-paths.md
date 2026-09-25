# Set up with the CLI or an AI assistant

SaaSFoundryAI has two first-class onboarding paths. You can answer the interactive CLI yourself, or describe the product to an assistant that translates your decisions into one non-interactive
command.

Both paths use the same configuration engine and installers. They produce the same `.saasfoundry.json`, the same generated files, and the same workflow after setup.

## Choose your path

| Choose               | Best when                                                                                                                | You control                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **Interactive CLI**  | You are discovering SaaSFoundryAI, want to see every applicable choice, or prefer a terminal-only workflow.              | Each prompt and the final editable recap.                                 |
| **Assistant-driven** | You use a supported coding agent, can describe the desired product, or want recommendations grounded in an existing POC. | The intent, the proposed command, and explicit approval before execution. |

Neither path is more capable. The assistant path is a conversational controller for the CLI, not a separate generator.

## Path 1 — interactive CLI

Start from the folder that should contain the new project:

```bash
npx saasfoundryai-cli@beta new
# or, after a global install:
sf new
```

The CLI asks only questions that apply to earlier decisions. Its configuration steps run in this order:

1. **Installation profile** — full project, harness on retained code, or technical stack.
2. **Coding-agent profiles** — which supported coding tools share the harness.
3. **Project and repository** — name, description, branch, topology, and optional remotes.
4. **Technical services** — database, email, storage, analytics, and installable-app support when a stack is requested.
5. **Team tools** — tracker, documentation/SRS backend, and design context.
6. **Workflow and language** — delivery preset and language for SRS, tickets, and code comments.
7. **Skills and SRS** — optional tool skills and Notion SRS bootstrap.
8. **Editable recap** — select a line to change it, or confirm and generate.

### The first answer changes everything

| Profile   | Result                                                                                                 | Pick it when                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `full`    | Technical SaaS stack plus managed collaboration harness.                                               | You are creating a new product or rebuilding a throwaway POC.                           |
| `harness` | Workflow, skills, SRS options, and agent instructions in the current repository; no replacement stack. | Existing code remains the product.                                                      |
| `stack`   | Technical scaffold without a configured workflow tool or SRS; core managed skills are still deposited. | You deliberately want the base architecture without the managed collaboration workflow. |

::: danger Do not scaffold a full project over retained code

If the current repository remains your product, choose `harness`. A managed harness can later preview an additive transition with `sf update --target-profile full --dry-run --json`; a full scaffold is
not an in-place merge strategy for arbitrary existing code.

:::

### Review before generation

The interactive flow ends with a recap. Changing one line reopens the owning step and recomputes any dependent choices. Generation starts only after you select **Confirm and continue**.

The answers become a validated configuration object. The scaffold is then rendered, optional integrations are bootstrapped, managed file hashes are recorded, and `.saasfoundry.json` is written.

Use this path when you want to understand every decision or when no assistant runtime is available.

## Path 2 — assistant-driven

The one-line assistant bootstrap is currently native to **Claude Code**:

> Install the SaaSFoundryAI skill from https://github.com/DiamondForgeFr/SaasFoundryAI

It installs the user-scoped `tool-saasfoundry` skill with:

```bash
npx saasfoundryai-cli@beta skill install --yes --force
```

The skill then orchestrates the same CLI. It never answers interactive Inquirer prompts and never writes scaffold files by hand.

::: info Claude-first bootstrap, multi-agent project

The bootstrap sentence above is Claude-specific; the generated harness is not. It can declare Claude Code, Codex, Gemini CLI, Kimi Code, Qwen Code and a generic profile in the same project. For
another host, run the interactive CLI once, select its profile, then open the generated project in that host. Inspect the current registry with `sf agents catalog --json`.

:::

### How the assistant discovers the setup

The skill supports three conversation styles:

| Mode        | Signal                                                   | Behavior                                                                |
| ----------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Guided**  | “I want to start a SaaS.”                                | Asks one relevant question at a time and explains recommendations.      |
| **Express** | “Create a monorepo with PostgreSQL, storage, and email.” | Infers a complete intent, presents one plan, and asks for one approval. |
| **Expert**  | You provide a partial or complete command.               | Checks real flag names and values, then preserves your choices.         |

Before choosing flags, the assistant establishes the starting point:

- **Empty workspace** — propose `full` for a new product.
- **Existing repository you keep** — propose `harness` and leave the technical files in place.
- **Throwaway POC you will rebuild** — read it first, challenge the product intent, preserve it under `POC/` after approval, then generate the new project beside it.
- **Managed project with `.saasfoundry.json`** — read its status and use `sf update`, not a second `sf new`.

### A concrete conversation

```text
You
  I want a new B2B SaaS named acme-portal. One team owns the API and web app.
  Use PostgreSQL locally, file uploads, transactional email,
  GitHub Projects, and Notion for the SRS. I use Claude Code and Codex.

Assistant
  I read this as a new full monorepo with Docker-managed PostgreSQL
  and object storage, MailerSend, GitHub Projects, a Notion SRS,
  and shared Claude Code + Codex instructions.

  Proposed command (secrets and external identifiers redacted):
  sf new --non-interactive --profile full \
    --project-name acme-portal --structure monorepo \
    --agents claude-code,codex --setup-repo local \
    --db-setup docker --db-type postgresql \
    --s3-setup docker --email-service mailersend \
    --tracker github-projects --docs notion \
    --srs-enable --srs-backend notion \
    --workflow saasfoundry --language en \
    --no-analytics --no-start-services --start-apps none

  I still need the Notion parent page, the sender identity, and both
  provider credentials. I will not echo those values in the plan.
  Shall I proceed after you provide them?
```

The assistant builds a structured intent and passes it through the skill's versioned flag map. It presents both a human summary and the generated command. If you change a decision, it rebuilds the
plan rather than editing an opaque shell string.

Only explicit approval authorizes execution. Missing values in `--non-interactive` mode fail instead of falling back to hidden prompts.

### Two registries, one adaptive plan

SaaSFoundry separates the tool that reads the repository from the model execution available inside that tool, then builds a plan from both registries:

| Layer                       | What SaaSFoundry records                                                                                                              | What it does not assume                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Coding-agent profile**    | How Claude Code, Codex, Gemini CLI, Kimi Code, Qwen Code or a generic host discovers project instructions and shared skills.          | That the tool is installed, authenticated or capable of native delegation.    |
| **Execution candidate**     | A provider + runtime + model + reasoning-effort combination exposed by the active host, with capability, privacy, price and evidence. | That a configured profile exposes a particular provider, model or credential. |
| **Adaptive execution plan** | The primary attempt, independent validation, bounded retries and fallbacks required for one task.                                     | That an unqualified or unavailable candidate may be dispatched automatically. |

```text
subtask → risk and capabilities → minimum reasoning effort
        → qualified provider/runtime/model candidates
        → primary agent + independent validation + retries/fallbacks
        → budget and approval gates → dispatch by the active host
```

Mechanical work can remain direct and low-effort. Implementation can require a medium-effort candidate and automated checks. Architecture or security work raises the minimum effort and can require
independent agent contexts and stronger tests. The workflow also scales delegation by ticket complexity: none for low work, several exploration contexts for medium work, and specialized analysis plus
adversarial review for complex work when the host supports and authorizes delegation.

::: warning V1 responsibility boundary

SaaSFoundry ships the provider-neutral classification, candidate, planning, cost, budget, retry and explanation contracts. The active coding-agent host must still expose and dispatch the real
candidates. SaaSFoundry does not install provider accounts, move credentials between hosts or claim that a declared agent profile has loaded a particular model. See
[agent coexistence](/guide/agent-coexistence), [execution candidates](/guide/execution-candidates) and [execution planning](/guide/execution-planning).

:::

### Safe defaults and secrets

The skill may recommend a choice when your product description supports it:

- monorepo unless API and web have separate owners or release schedules;
- Docker-managed PostgreSQL for local development;
- no email provider until the product needs invites, password resets, or receipts;
- analytics off until measurement is part of the product plan;
- PWA on unless installability is deliberately unwanted.

Recommendations are shown before execution. High-consequence choices — retaining an existing codebase, where the SRS lives, and where tickets land — are never guessed.

Credentials are collected only when their integration is selected. They are redacted from summaries and must not be committed to `.saasfoundry.json`.

## Where both paths converge

```text
interactive answers                    conversational intent
         │                                      │
         ▼                                      ▼
  config-engine session              tool-saasfoundry plan
         │                                      │
         └──────────────┬───────────────────────┘
                        ▼
             validated sf new options
                        │
                        ▼
       scaffold + installers + file hashes
                        │
                        ▼
           .saasfoundry.json + project
                        │
                        ▼
            sf status / sf update / workflow
```

The manifest records topology, ports, modules, language, workflow, tool selections, agent declarations, and hashes of managed files. It becomes the source of truth for future reads and updates
regardless of how the initial answers were collected.

After generation, both users run the same checks:

```bash
cd acme-portal
sf status --agent-friendly --no-network
sf agents list --json
```

Both later evolve the project with the same command:

```bash
sf update --dry-run --json --non-interactive
```

The assistant normally shows that update preview before asking to apply it. The CLI user can inspect and apply the same plan directly.

## What does not converge automatically

- Selecting an agent profile does not install or authenticate that coding tool.
- A successful credential check does not prove the host can expose the integration to every agent.
- The assistant bootstrap does not make secrets portable between machines.
- `harness`, `stack`, and `full` remain different installed capability profiles even though they share the same manifest format.
- An external repository is not silently merged into a new generated stack.

## Continue

- [Install the prerequisites](/getting-started/installation)
- [Run the shortest setup](/getting-started/quick-start)
- [Create and inspect a first project](/getting-started/first-project)
- [Read the complete `sf new` reference](/cli/sf-new)
- [Understand safe updates](/cli/sf-update)
