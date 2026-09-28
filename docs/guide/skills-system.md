# Skills system

Skills are the development harness's operational layer. Each `SKILL.md` explains when a capability applies, which project facts to read, which guarded script to use and where human approval remains
mandatory.

They do not replace the CLI. A skill gives the coding agent context and procedure; the CLI performs deterministic work and validates preconditions.

## The `sf-*` contract

SaaSFoundryAI reserves the `sf-` prefix for project-owned behavior:

- `sf-workflow` — status routing, complexity and delivery guards;
- `sf-integration-rules` — backend-to-frontend wiring grammar;
- `sf-git-commit` / `sf-git-create-pr` — repository-aware Git operations;
- `sf-srs` — specification lifecycle;
- `sf-tool-*` — adapters for boards, documentation, design and technical context.

When a generic global skill and an `sf-*` project skill overlap, the project skill wins. That rule prevents a globally installed helper from ignoring `.saasfoundry.json` or bypassing the project's
review gates.

## Managed source and portable copies

During the additive multi-agent compatibility phase, the managed source remains under `.claude/skills/`. SaaSFoundryAI can also create reviewable shared copies under `.agents/skills/` for declared
non-Claude profiles:

```text
.claude/skills/           managed source and guarded scripts
.agents/skills/           portable shared copies
CLAUDE.md                 Claude Code entrypoint
AGENTS.md                 portable/Codex entrypoint
GEMINI.md                 Gemini CLI entrypoint when selected
```

Do not infer runtime support from a directory name. `sf agents doctor` checks files and documented capabilities, but only a native observation in the actual host can prove discovery, hooks,
permissions or model access.

## Installation topology

- **Monorepo:** the harness can be shared from the workspace root, so API, web and packages read one contract.
- **Multirepo:** each repository receives the relevant harness files because it must remain operable when checked out alone.

The project manifest records the topology and managed baselines. `sf update` uses those baselines to distinguish upstream changes from user customisation.

## How invocation works

Invocation is host-specific:

- Claude Code can discover the historical `.claude/skills` surface and slash-command conventions.
- Codex and other declared profiles follow their native project instructions and the shared `.agents/skills` procedures.
- A generic host may require the user or agent to open `SKILL.md` explicitly.

The portable invariant is the procedure, not a particular slash-command syntax. A capable agent should:

1. read its project instruction entrypoint;
2. inspect `.saasfoundry.json`;
3. choose the applicable `sf-*` skill;
4. read that skill and its referenced files completely;
5. run preconditions and guarded scripts explicitly;
6. report any missing native capability instead of simulating success.

## Core skills

Core skills cover the repeatable development loop without external credentials:

| Area         | Examples                                            | Responsibility                                 |
| ------------ | --------------------------------------------------- | ---------------------------------------------- |
| Git          | `sf-git-commit`, `sf-git-create-pr`, `sf-git-merge` | Branch, commit and PR policy                   |
| Quality      | `sf-utils-fix-errors`, `sf-utils-fix-grammar`       | Focused repair while preserving unrelated work |
| Workflow     | `sf-workflow`                                       | Guarded Team/Solo routes and custom extension  |
| Architecture | `sf-integration-rules`                              | Complete cross-layer implementation            |

`sf-workflow` is one complexity-adaptive skill. The team preset uses seven statuses and Solo uses five. Custom templates can store another sequence, but teams must add matching documents and guards
before treating it as a delivery contract. Complexity (`bug`, `low`, `medium`, `complex`) controls rigor inside the workflow rather than selecting a separate skill.

## Tool skills and honest support levels

Tool skills may require user-scoped credentials outside the repository.

| Surface                        | v1 status                                                               |
| ------------------------------ | ----------------------------------------------------------------------- |
| GitHub Projects workflow       | Complete delivery adapter                                               |
| Jira workflow                  | Experimental adapter                                                    |
| Linear workflow                | Experimental adapter                                                    |
| Notion SRS                     | Complete v1 SRS backend                                                 |
| Atlassian/Notion/Figma context | Optional tool skills; capability depends on credentials and host access |

Tool-neutral interfaces make future adapters possible; they do not make every adapter equally complete today.

## Native child tickets and test evidence

The workflow skill creates real sub-issues through the configured board tool, never markdown checkboxes. It publishes a test plan before execution and a report after validation. For the team preset,
the same pull request moves from draft feature testing (`Human testing`) to ready code review (`In review`).

## Custom skills

A project-specific skill should use the same prefix and keep its scope narrow:

```text
.claude/skills/sf-deploy-preview/
├── SKILL.md
├── scripts/
└── references/
```

Store reusable logic in scripts, keep credentials outside Git and document which files the skill owns. If the skill needs to participate in a workflow transition, extend the guarded workflow rather
than performing a raw board mutation.

## Updating skills safely

`sf update` compares the installed file, its recorded baseline and the new upstream version:

- unchanged files can advance automatically;
- user modifications produce explicit conflicts;
- removed upstream files are not confused with user-owned content;
- agent declarations never authorize deleting unrelated instructions or settings.

## Diagnostics

```bash
sf skill list
sf skill describe sf-workflow
sf agents list --json
sf agents doctor codex claude-code
sf status --agent-friendly --no-network
```

## Continue

- [Skills overview](/skills/overview)
- [Core skills](/skills/core-skills)
- [Tool skills](/skills/tool-skills)
- [Creating skills](/skills/creating-skills)
- [Agent coexistence](/guide/agent-coexistence)
