# Skills overview

SaaSFoundryAI installs project-owned `sf-*` skills that explain how to work safely in the generated architecture. They are executable documentation for coding agents: workflow guards, integration
grammar, Git operations, SRS procedures and external-tool adapters live beside the code they govern.

## Why every project skill starts with `sf-`

- `sf-workflow`, not a generic `workflow`
- `sf-git-commit`, not a generic `commit`
- `sf-tool-github-projects`, not a generic GitHub helper

The prefix prevents a globally installed skill from silently replacing project policy. In a SaaSFoundryAI project, agents prefer the repository's `sf-*` procedure whenever both a generic and
project-specific capability exist.

## Skill categories

| Category            | Installed when               | Examples                                                                   |
| ------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| Core                | Every harness installation   | `sf-git-commit`, `sf-git-create-pr`, `sf-utils-fix-errors`                 |
| Workflow            | A workflow is configured     | `sf-workflow` plus the selected board skill                                |
| Integration grammar | A generated app is managed   | `sf-integration-rules`                                                     |
| SRS                 | SRS is enabled               | `sf-srs` and its backend adapter                                           |
| Optional tool       | Selected during setup/update | `sf-tool-context7`, `sf-tool-atlassian`, `sf-tool-notion`, `sf-tool-figma` |

## One source, several agent entrypoints

Claude Code remains the compatibility source during the multi-agent transition:

```text
.claude/skills/          # managed source used by Claude Code and guarded scripts
.agents/skills/          # shared copies for Codex and other declared agent profiles
CLAUDE.md                # Claude entrypoint
AGENTS.md                # portable/Codex entrypoint; points back to project rules
GEMINI.md                # Gemini entrypoint when selected
```

The exact files depend on the declared profiles in `.saasfoundry.json`. `sf agents list`, `sf agents doctor` and `sf status --agent-friendly --no-network` report declarations and file presence. They
do not claim that a host discovered skills, executed hooks or received credentials; verify those behaviors in the actual host.

Generated multirepos place the managed harness where each repository needs it. Monorepos can centralize the shared instruction surface at the root. See [Agent coexistence](/guide/agent-coexistence)
and [Project structure](/guide/project-structure) for the exact topology.

## How an agent uses a skill

1. Read the project's instruction entrypoint.
2. Inspect `.saasfoundry.json` for topology, modules, agent profiles and workflow.
3. Select the matching `sf-*` skill from the declared skill root.
4. Read its complete `SKILL.md` and referenced status/reference files.
5. Execute guarded scripts rather than recreating their side effects manually.

Some hosts support keyword-based discovery or slash commands; others require the agent to read the skill explicitly. SaaSFoundryAI documents both the desired capability and the host limitation instead
of pretending every runtime behaves like Claude Code.

## Workflow skill and board adapters

`sf-workflow` owns the delivery semantics. A board skill performs the actual ticket operations.

| Adapter                   | v1 status                                                  |
| ------------------------- | ---------------------------------------------------------- |
| `sf-tool-github-projects` | Complete v1 delivery contract                              |
| Jira adapter              | Experimental; no promise of full guard or hierarchy parity |
| Linear adapter            | Experimental; no promise of full guard or hierarchy parity |
| Notion                    | Complete v1 SRS backend; not a complete workflow tracker   |

The workflow skill reads the configured status sequence, including the seven-status team preset, the five-status Solo preset or a custom template. It never needs a separate “advanced” workflow skill:
complexity controls analysis and review depth inside the one workflow.

## Discovery and diagnostics

```bash
sf skill list
sf skill describe sf-workflow
sf agents list --json
sf agents doctor codex claude-code
sf status --agent-friendly --no-network
```

To inspect the managed source directly:

```bash
cat .claude/skills/sf-workflow/SKILL.md
cat .agents/skills/sf-workflow/SKILL.md
```

Use whichever path exists for the declared current host. Do not copy personal/global skills into the repository or infer consent from a discovered directory.

## Updates and local customisation

`sf update` compares managed skill files with the baseline recorded in `.saasfoundry.json`:

- unchanged managed files can be updated automatically;
- local edits become explicit conflicts instead of being overwritten silently;
- credentials remain outside the repository;
- shared agent declarations and instruction files remain reviewable changes.

If a convention is specific to your product, create an `sf-*` custom skill in the project and document its ownership. See [Creating skills](/skills/creating-skills).

## Continue

- [Core skills](/skills/core-skills)
- [Tool skills](/skills/tool-skills)
- [Creating skills](/skills/creating-skills)
- [Skills system architecture](/guide/skills-system)
- [Agent coexistence](/guide/agent-coexistence)
