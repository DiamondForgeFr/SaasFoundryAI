# Workflow System

SaaSFoundry's workflow system is a **complexity-adaptive, status-driven lifecycle** designed for Human + AI collaboration. Every ticket moves through the same seven statuses, but the rigor applied at
each step scales with the ticket's complexity tag.

## Philosophy

Traditional Git flows put all the guardrails at the PR stage. That works for small teams where a reviewer can mentally simulate what the author intended. It breaks down when part of the work is done
by an AI agent that has no memory of prior decisions.

SaaSFoundry inverts the model: **the guardrails live in the workflow itself**. By the time a pull request exists, the code has already been planned, reviewed, tested, and validated by a human. The PR
becomes a final sanity check, not the first line of defence.

```text
┌────────┐   ┌──────┐   ┌─────────────┐   ┌──────────────┐   ┌─────────────────┐   ┌──────────────┐   ┌──────┐
│Backlog │ → │Ready │ → │In progress  │ → │ AI testing   │ → │ Human testing   │ → │ In review    │ → │ Done │
│(specs) │   │(queue│   │(impl +      │   │(automated +  │   │(manual dev      │   │(PR + CI +    │   │(merge│
│        │   │      │   │ subtasks)   │   │ test plan)   │   │ validation)     │   │ reviewers)   │   │ +    │
│        │   │      │   │             │   │              │   │                 │   │              │   │clean)│
└────────┘   └──────┘   └─────────────┘   └──────────────┘   └─────────────────┘   └──────────────┘   └──────┘
```

## Complexity-adaptive ceremony

Every ticket is tagged with one of four complexity levels. The tag controls how much process the AI agent applies:

| Level          | Style            | Ceremony                                                     |
| -------------- | ---------------- | ------------------------------------------------------------ |
| 🐛 **bug**     | Direct fix       | Skip analyze/plan. Regression test mandatory.                |
| 🟢 **low**     | Oneshot          | Minimal analyze (2–3 files), mental plan, no approval.       |
| 🟡 **medium**  | Structured       | 2–4 exploration agents, detailed plan, approval required.    |
| 🔴 **complex** | Full adversarial | 6–10 agents, comprehensive plan, adversarial review (OWASP). |

The complexity tag lives on the ticket itself (as a GitHub label or equivalent), independent of status. See [Complexity System](/workflow/complexity-system) for the full mapping.

## Dogfooding

SaaSFoundry uses its own workflow to build itself. The `.saasfoundry.json`, `.claude/skills/sf-workflow/`, and `.claude/skills/sf-tool-github-projects/` directories in this repository are the exact
same files that get scaffolded into projects created with `sf new`.

This matters because:

- If we bypass our own rules, we cannot guarantee they work for users.
- Bugs in our workflow reach every project built with SaaSFoundry.
- Usability problems we feel in our own flow are problems our users will feel tenfold.

The workflow is not aspirational. It's the binding contract between the human developer and the AI agent.

## Source of truth

All workflow configuration lives in `.saasfoundry.json` at the project root:

- `workflow.statuses` — the ordered list of the seven statuses
- `workflow.workingBranch` — where feature branches rebase from
- `workflow.prTargetBranch` — the merge target for PRs
- `workflow.branchNaming.feature` — feature branch pattern (e.g. `feature/{N}-{description}`)
- `workflow.commitFormat.pattern` — conventional commit pattern (e.g. `<type>(#<ticket>): <description>`)
- `workflow.projectUrl` — GitHub Projects / Jira / Notion / Linear board

The AI agent never hardcodes branch names, status names, or commit formats — it always reads from the config file. This is what makes the workflow portable across projects.

## When to use which tool

The workflow engine is tool-agnostic — it delegates to a per-board adapter for the "move the ticket, create the sub-issue, post the comment" plumbing. The table below captures the adapters we plan
to support and their current availability:

| Tool            | Strength                                         | Use case                                     | Availability    |
| --------------- | ------------------------------------------------ | -------------------------------------------- | --------------- |
| GitHub Projects | Native to the repo, free, sub-issues via GraphQL | Default for open-source + small teams        | Available today |
| Jira            | Mature PM surface, sprints, custom fields        | Medium/large teams with existing Jira usage  | On the roadmap  |
| Notion          | Flexible, doc-adjacent, great for product teams  | Hybrid product/engineering orgs              | On the roadmap  |
| Linear          | Fast, opinionated, cycles                        | Startups optimising for engineering velocity | On the roadmap  |
| ClickUp         | All-in-one PM, lightweight PM surface            | Ops-heavy teams outgrowing Trello            | On the roadmap  |

::: info Today vs. roadmap
The only adapter that ships today is `sf-tool-github-projects`. Jira, Notion, Linear and ClickUp adapters are scheduled next — the `sf-workflow` skill already reads `workflow.projectUrl` and routes
commands through the configured adapter, so the day they land you flip one config entry and you are in.
:::

::: tip Customizable workflow coming in future versions
The 7-status lifecycle is currently fixed because it encodes the patterns we have most battle-tested. Upcoming versions will expose it as configuration — rename statuses, drop optional checkpoints,
or add team-specific stages from `.saasfoundry.json`. The generated skills and CLI already read their transitions from config, so opening up the shape is mostly a matter of surfacing the right knobs.
:::

The `sf-workflow` skill automatically routes commands to the right tool based on `workflow.projectUrl`. You write workflow commands once — they run against whichever adapter is wired up.

See [GitHub Integration](/workflow/github-integration) for the reference implementation.

## Next steps

- [7-Status System](/workflow/7-status-system) — mandatory actions and exit conditions per status
- [Complexity System](/workflow/complexity-system) — how ceremony scales with complexity
- [AI Rules](/workflow/ai-rules) — the eight non-negotiable rules the AI agent must follow
- [GitHub Integration](/workflow/github-integration) — how the GitHub Projects adapter works
