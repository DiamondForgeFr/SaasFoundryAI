# Development tools

SaaSFoundryAI separates four concerns that are often mixed together: the generated application, its deterministic CLI, the development harness and the external services you choose to connect.

```text
coding agent ──reads──► project instructions + sf-* skills
                              │
                              ▼
                         SaaSFoundry CLI
                              │
                              ▼
                    generated SaaS workspace
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
        GitHub Projects    Notion SRS     optional tools
        delivery board     requirements   design/context
```

No single editor, terminal or AI provider is required for the generated application to run.

## 1. The SaaSFoundry CLI

The CLI is the deterministic layer used by humans and agents:

```bash
sf new --project-name my-product
sf status --agent-friendly --no-network
sf modules list
sf update
sf workflow show
```

It owns scaffolding, configuration, managed-file updates and diagnostics. An agent should propose and execute explicit CLI commands, not invent an undocumented parallel generator.

## 2. Coding-agent hosts

The harness can declare these profile identifiers:

- `claude-code`
- `codex`
- `gemini-cli`
- `kimi`
- `qwen-code`
- `generic`

These identify host integrations, not model providers. A profile writes appropriate instruction entrypoints and shared skill references; it does not install the runtime, select a model, transfer
credentials or prove native discovery.

```bash
sf agents list --json
sf agents enable codex
sf agents replace claude-code codex --scope shared
sf agents doctor codex claude-code
```

Claude Code currently has the native one-line assistant bootstrap. Other hosts begin with the CLI path and their declared profile, then follow the generated `AGENTS.md` or host-specific entrypoint.

## 3. Project instructions and skills

The historical managed source remains under `.claude/`; portable shared copies for declared agents live under `.agents/`:

```text
CLAUDE.md
AGENTS.md
.claude/skills/sf-*/
.agents/skills/sf-*/
```

In a SaaSFoundry project, prefer `sf-*` procedures over generic global skills. The project versions understand `.saasfoundry.json`, branch policy, topology and workflow guards.

## 4. Delivery board

The workflow core delegates ticket operations to a board adapter.

| Board           | v1 level                                                                     |
| --------------- | ---------------------------------------------------------------------------- |
| GitHub Projects | Complete: issues, native children, statuses, milestones, PR and merge guards |
| Jira            | Experimental adapter                                                         |
| Linear          | Experimental adapter                                                         |
| Notion          | Not a complete workflow tracker in v1                                        |

GitHub authentication comes from the `gh` CLI and, for some Project V2 operations, the configured token. Credentials are never committed to `.saasfoundry.json`.

### Team, Solo, and Custom

The workflow shape is independent from the selected board adapter:

- **Team** uses `Backlog → Ready → In progress → AI testing → Human testing → In review → Done`. **Human testing** is functional feature testing; **In review** is code review.
- **Solo** removes the separate Human testing status. The developer still performs any warranted functional checks during PR review before merging.
- **Custom** stores and synchronises advanced status configurations. Team and Solo remain the only v1 routes with complete generated status documents and tested end-to-end guards.

## 5. SRS and product documentation

Notion is the complete v1 SRS backend. It stores the Epic/FR/DS/TC hierarchy, supports ingestion and reconciles approved requirements into delivery tickets. Confluence and local Markdown are future
backend targets.

This SRS role is independent from the delivery board. A project can use GitHub Projects for delivery and Notion for its requirements without claiming that Notion implements the GitHub workflow
contract.

## 6. Optional context tools

Optional `sf-tool-*` skills can connect the agent to library documentation, Atlassian, Notion or Figma when credentials and native tool access exist. They enrich decisions; they do not silently grant
write access.

```bash
sf tools list
sf tools add notion work
sf tools use notion work
sf status --agent-friendly --no-network
```

A successful configuration read proves only that the project declares the tool. Use an explicit connection check before depending on the remote service.

## A practical terminal layout

Any terminal or IDE works. A useful local arrangement is:

```text
┌─────────────────────────┬─────────────────────────┐
│ coding agent / editor   │ web browser             │
├─────────────────────────┼─────────────────────────┤
│ API logs                │ web / test logs         │
└─────────────────────────┴─────────────────────────┘
```

Run the generated project according to its topology:

```bash
# monorepo
npm run dev

# or per repository in a multirepo
npm run dev --prefix apps/api
npm run dev --prefix apps/web
```

Use the ports reported by `sf status`; do not assume examples match a customised manifest.

## What is safe to automate

- reading project state and documentation;
- proposing commands and configuration;
- scaffolding after explicit answers;
- running local builds and tests;
- preparing test plans, reports and pull requests;
- using guarded board transitions.

The harness still requires humans for decisions such as destructive actions, external writes, feature validation, code-review approval and merges according to the configured workflow.

## Continue

- [Installation](/getting-started/installation)
- [CLI or assistant setup](/getting-started/setup-paths)
- [Connect your tools](/features/your-tools)
- [Agent coexistence](/guide/agent-coexistence)
- [Skills system](/guide/skills-system)
