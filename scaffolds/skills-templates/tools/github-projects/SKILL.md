# GitHub Projects Tool

Integration with GitHub Projects V2 for ticket management, status transitions, and complexity labeling.

## Auto-trigger keywords

github project, create subtask, update ticket status, github issue, project board, set complexity

## Data model

Two orthogonal axes on every ticket:

| Axis           | Where it lives                                         | What it controls                                           |
| -------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| **Status**     | Projects V2 board (Single select field "Status")       | Workflow phase (Backlog → … → Done)                        |
| **Complexity** | GitHub label (`complexity: bug\|low\|medium\|complex`) | Rigor level applied in each phase (agents, tests, reviews) |

Never encode status in a label. Never encode complexity on the board. Keep them independent.

## Configuration

This skill reads everything from `.saasfoundry.json`:

```bash
jq -r '.workflow.projectUrl' .saasfoundry.json
jq -r '.workflow.workingBranch' .saasfoundry.json
```

Supported `projectUrl` formats:

- `https://github.com/orgs/<owner>/projects/<number>`
- `https://github.com/users/<owner>/projects/<number>`

Requires `gh auth login` with `project` + `repo` scopes.

## Commands

All via `.claude/skills/sf-tool-github-projects/github-projects-cli.sh <cmd> [args]`.

| Command                                  | Purpose                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `create-subtask <parent> <title> [body]` | Create a GitHub sub-issue linked to parent via GraphQL `addSubIssue`                              |
| `status <ticket>`                        | Read status from Projects V2 board                                                                |
| `update-status <ticket> <status-name>`   | Write status on Projects V2 board (`gh project item-edit`)                                        |
| `set-complexity <ticket> <level>`        | Set label `complexity: <bug\|low\|medium\|complex>` (removes any existing complexity label first) |
| `get-complexity <ticket>`                | Read current complexity label                                                                     |
| `get-ticket <ticket>`                    | Print title + body (used by `detect-complexity.sh`)                                               |
| `create-pr <ticket>`                     | Push branch + open PR against `workingBranch`                                                     |
| `list [status]`                          | List project items, optionally filtered by status                                                 |

Status names are case-insensitive — the CLI matches against the options defined on the board.

## How the orchestration skill uses this CLI

`sf-workflow/workflow-cli.sh` routes every tool-specific call through this CLI:

```bash
# e.g. sf-workflow/workflow-cli.sh retag 42 complex
#   → github-projects-cli.sh set-complexity 42 complex

# e.g. sf-workflow/workflow-cli.sh status 42
#   → github-projects-cli.sh status 42
```

## Complexity labels

The following labels must exist in the repo (create them once):

| Label                 | Color     | Use case                                        |
| --------------------- | --------- | ----------------------------------------------- |
| `complexity: bug`     | `#FF5555` | Bug fix — direct fix + regression test          |
| `complexity: low`     | `#7CFC00` | Oneshot-style, minimal ceremony                 |
| `complexity: medium`  | `#FFD700` | Structured plan + validation                    |
| `complexity: complex` | `#FF1493` | Full adversarial review (security, logic, perf) |

Create them with:

```bash
gh label create "complexity: bug"     --color FF5555 --description "🐛 Bug fix"
gh label create "complexity: low"     --color 7CFC00 --description "🟢 Low complexity"
gh label create "complexity: medium"  --color FFD700 --description "🟡 Medium complexity"
gh label create "complexity: complex" --color FF1493 --description "🔴 Complex / critical"
```

## SRS workflow labels

Applied on backlog / ready tickets so the `sf-srs` skill picks the right drafter when a ticket becomes active. A ticket carries at most one SRS label at a time ; absence of an SRS label means `sf-srs`
leaves the ticket alone.

| Label          | Color     | Applied when…                                                                  |
| -------------- | --------- | ------------------------------------------------------------------------------ |
| `srs:drafting` | `#8B5CF6` | Spec needs to be drafted / refined before the team can commit.                 |
| `srs:update`   | `#F97316` | Existing SRS page must be updated to match code drift.                         |
| `srs:new`      | `#3B82F6` | New Epic / FR spec to be created from scratch.                                 |

Create them with (idempotent — `|| true` swallows the exit code when the label already exists) :

```bash
gh label create "srs:drafting" --color 8B5CF6 --description "sf-srs: ticket needs spec drafting / refinement" || true
gh label create "srs:update"   --color F97316 --description "sf-srs: existing SRS page must be updated"        || true
gh label create "srs:new"      --color 3B82F6 --description "sf-srs: create a new Epic / FR spec from scratch" || true
```

See `.claude/skills/sf-srs/SKILL.md` for the end-to-end contract and `.claude/docs/github-labels.md` for the full label catalogue.

## Example — full ticket lifecycle

```bash
CLI=.claude/skills/sf-tool-github-projects/github-projects-cli.sh

# 1. Tag complexity (AI suggests, developer confirms)
$CLI set-complexity 42 medium

# 2. Subtasks
$CLI create-subtask 42 "Backend API"
$CLI create-subtask 42 "Frontend UI"

# 3. Status transitions (from the board, not labels)
$CLI update-status 42 "In progress"
$CLI update-status 42 "AI testing"
$CLI update-status 42 "Human testing"

# 4. PR + review + done
$CLI create-pr 42
$CLI update-status 42 "In review"
# (after merge)
$CLI update-status 42 "Done"
```

## Requirements

- `gh` CLI authenticated (`gh auth status` must show `project` + `repo` scopes)
- `jq` for JSON parsing
- Project exists with a single-select "Status" field whose options match `.saasfoundry.json` → `workflow.statuses`

## Troubleshooting

**`Could not load project <N> for owner <X>`** Check `.saasfoundry.json` → `workflow.projectUrl` matches a real project. Run `gh project list --owner <owner>` to see what you have access to.

**`Ticket #N is not on project board`** The issue exists but hasn't been added to the project. Add it via the board UI or `gh project item-add`.

**`Unknown status '<name>'`** Status must exactly match an option on the board (case is ignored). The CLI prints the available options on error.
