# Workflow system

SaaSFoundryAI's development harness turns delivery policy into project files, guarded commands and board state. Humans and coding agents read the same `.saasfoundry.json`; neither side has to
reconstruct the process from chat history.

## What the harness installs

- `sf-workflow` — the router, guards and status instructions;
- one board tool skill — `sf-tool-github-projects` for the complete v1 path;
- branch, commit, pull-request and status policy in `.saasfoundry.json`;
- complexity profiles for adaptive analysis and review;
- native child-ticket, test-plan and merge-evidence rules.

The workflow is coding-agent neutral. Claude Code can use the one-line assistant bootstrap; Codex, Gemini CLI, Kimi Code, Qwen Code and generic hosts consume the shared instructions and installed
`sf-*` skills according to their native capabilities.

## Choose a workflow shape

### Team: `saasfoundry`

```text
Backlog → Ready → In progress → AI testing → Human testing → In review → Done
```

This is the complete workflow documented throughout this site.

- **Human testing means feature testing:** validate behavior in a real runtime from the draft PR and test plan.
- **In review means code review:** mark the same PR ready, run full CI and review the implementation before merge.

Use it when product behavior deserves a separate functional checkpoint before code review.

### Solo: `solo`

```text
Backlog → In progress → AI testing → In review → Done
```

Solo removes the separate `Ready` and `Human testing` columns. It keeps planning, implementation, pushes, test evidence, CI and merge guards. `In review` becomes the single human gate: review the PR
and test manually there when needed.

Select a preset during creation or while adding the harness:

```bash
sf new my-product --profile full --workflow saasfoundry
sf new my-product --profile harness --workflow solo
sf update --profile harness --workflow solo
```

Switch an existing managed project in place:

```bash
sf workflow use solo
sf workflow use saasfoundry
```

The command preserves the project's board, branches and URLs, replaces the status set, regenerates matching status documentation and attempts to align a configured GitHub Project.

### Custom workflow

Interactive setup offers **Custom Workflow**. Define at least two named statuses, give every status a description for agent context and select its board color. Save and reuse the result:

```bash
sf workflow save regulated-team
sf workflow create release-train
sf workflow list
sf workflow show-template regulated-team
sf workflow use regulated-team
```

::: warning Custom means configurable, not unguarded

The built-in Team and Solo presets ship purpose-built status documents and tested guards. For a custom sequence, the team owns the meaning of every phase and must retain an explicit human review
policy.

:::

## The three axes are independent

| Axis           | Controls                                              | Examples                                   |
| -------------- | ----------------------------------------------------- | ------------------------------------------ |
| Workflow shape | Which statuses exist and in what order                | team, solo, custom                         |
| Complexity     | Analysis, planning and review depth inside the phases | bug, low, medium, complex                  |
| Nature         | Delivery ownership and legal route                    | user-facing, internal, bundled child, Epic |

A complex ticket in Solo still receives deep analysis and adversarial review; it simply has one human PR gate instead of separate feature-testing and code-review columns. A low-risk ticket in the team
preset still passes through its configured stages, with lighter ceremony inside them.

Nature adds guarded exceptions. A bundled child has no PR because its atomic commit ships in its delivery parent's PR. An Epic has neither branch nor PR; its status is derived from native children.

## Pull-request lifecycle

For the team preset:

1. commit and push before AI testing;
2. publish the test plan and report;
3. create or reuse a **draft PR** before Human testing;
4. let the developer perform functional feature testing;
5. after approval and non-regression tests, mark the same PR ready;
6. enter In review for code review and full CI;
7. wait for the developer to merge;
8. verify the merge before Done.

```bash
WORKFLOW=.claude/skills/sf-workflow/workflow-cli.sh

$WORKFLOW create-pr 42 --draft
$WORKFLOW ready-pr 42
$WORKFLOW update-status 42 "In review"
# developer merges
$WORKFLOW update-status 42 Done
```

Solo can create a ready PR directly after AI testing because its In review phase is already the human gate.

## Status and configuration commands

```bash
sf workflow show
sf workflow validate
sf workflow set-working-branch develop
sf workflow set-ai-rules

.claude/skills/sf-workflow/workflow-cli.sh status 42
.claude/skills/sf-workflow/workflow-cli.sh update-status 42 "AI testing"
```

Never mutate the board directly to bypass a rejected transition. The rejection is evidence that an entry condition, exit condition or external proof is missing.

## Manifest contract

```json
{
  "workflow": {
    "template": "SaaSFoundry AI Workflow",
    "tool": "github-projects",
    "projectUrl": "https://github.com/orgs/acme/projects/1",
    "workingBranch": "develop",
    "prTargetBranch": "develop",
    "requireCodeReview": true,
    "statuses": [
      { "name": "Backlog", "color": "GRAY" },
      { "name": "Ready", "color": "YELLOW" },
      { "name": "In progress", "color": "BLUE" },
      { "name": "AI testing", "color": "PURPLE" },
      { "name": "Human testing", "color": "ORANGE" },
      { "name": "In review", "color": "PINK" },
      { "name": "Done", "color": "GREEN" }
    ]
  }
}
```

The manifest is the source of truth. Status names, branch names and pull-request targets are not inferred from documentation examples.

## Tool support

| Adapter         | v1 contract                                                                                |
| --------------- | ------------------------------------------------------------------------------------------ |
| GitHub Projects | Complete: issues, native children, status fields, milestones, PR guards and merge evidence |
| Jira            | Experimental: useful operations exist, full contract parity is not guaranteed              |
| Linear          | Experimental: issue operations exist, full contract parity is not guaranteed               |
| Notion          | SRS/documentation backend, not a complete v1 workflow tracker                              |

Run `sf status --agent-friendly --no-network` to inspect declared configuration without claiming that credentials or network access work. Use an explicit connection check only when the task needs the
external service.

## SRS drafting tickets

Specification drafting is not code delivery. Tickets labelled `srs:drafting`, `srs:update` or `srs:new` stay in the board's In progress column and follow:

```text
AI draft → Human review → Spawning → Done
```

Use `workflow-cli.sh transition-drafting`; the CLI rejects code-path transitions for these tickets.

## Continue

- [Team 7-status reference](/workflow/7-status-system)
- [Complexity system](/workflow/complexity-system)
- [GitHub Projects integration](/workflow/github-integration)
- [Connect your tools](/features/your-tools)
- [CLI or assistant setup](/getting-started/setup-paths)
