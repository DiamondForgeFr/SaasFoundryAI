# GitHub Projects Integration

The `sf-tool-github-projects` skill is the reference adapter for the SaaSFoundryAI v1 workflow. It connects configured statuses, complexity, and native sub-issues to GitHub Projects V2 and GitHub
Issues.

GitHub Projects is currently the only adapter that covers the complete v1 delivery workflow. Jira and Linear adapters are experimental. Notion provides the complete v1 SRS backend, not a complete
ticket-workflow adapter.

## Data model

Two independent axes shape a delivery ticket:

| Axis           | Storage                                              | Responsibility                         |
| -------------- | ---------------------------------------------------- | -------------------------------------- |
| **Status**     | Projects V2 single-select `Status` field             | Current phase in the configured route  |
| **Complexity** | GitHub label `complexity: bug\|low\|medium\|complex` | Depth of analysis, testing, and review |

A status is not a label, and complexity is not a phase column. Keeping them independent lets the team change the risk level without moving the ticket.

## Prerequisites

- A GitHub Projects V2 board whose `Status` field contains the selected preset's statuses.
- The four complexity labels.
- `gh` authenticated with `project` and `repo` permissions.
- `.saasfoundry.json` configured with the board URL and branches.

The Team preset expects seven statuses. Solo expects five. A Custom workflow uses exactly the route saved in the project manifest.

```json
{
  "workflow": {
    "projectUrl": "https://github.com/orgs/<owner>/projects/<number>",
    "workingBranch": "develop",
    "prTargetBranch": "develop"
  }
}
```

## Adapter commands

GitHub operations are implemented by `.claude/skills/sf-tool-github-projects/github-projects-cli.sh` and orchestrated through `sf-workflow`:

| Command                                  | Purpose                                               |
| ---------------------------------------- | ----------------------------------------------------- |
| `create-subtask <parent> <title> [body]` | Create an issue and attach it as a native sub-issue   |
| `status <ticket>`                        | Read its Projects V2 status                           |
| `update-status <ticket> <status>`        | Move it to a configured board option                  |
| `set-complexity <ticket> <level>`        | Replace its complexity label                          |
| `get-complexity <ticket>`                | Read its current complexity                           |
| `get-ticket <ticket>`                    | Read its title and body                               |
| `create-pr <ticket> --draft`             | Open or reuse the draft PR for feature testing        |
| `draft-pr <ticket>`                      | Return an existing ready PR to draft for retesting    |
| `create-pr <ticket>`                     | Create or mark the PR ready for code review           |
| `list-incomplete-children <ticket>`      | List native children whose board status is not `Done` |

Status names come from the board and manifest. The orchestration layer must not invent them.

## Routing from `sf-workflow`

`workflow-cli.sh` is the tool-independent entry point:

```bash
.claude/skills/sf-workflow/workflow-cli.sh status 42
.claude/skills/sf-workflow/workflow-cli.sh retag 42 complex
.claude/skills/sf-workflow/workflow-cli.sh create-subtask 42 "Backend API"
```

It reads the configured workflow tool and delegates to the GitHub adapter while preserving transition guards.

## Complete Team route

```bash
CLI=.claude/skills/sf-workflow/workflow-cli.sh

# Scope and approve the intent
$CLI retag 42 medium
$CLI update-status 42 "Ready"

# Implement
$CLI update-status 42 "In progress"
$CLI create-subtask 42 "Backend API"
git commit -m "feat(#SUB-1): add backend API" && git push
$CLI update-status <SUB-1> "Done"

# Automated validation
$CLI update-status 42 "AI testing"
npm run test:pre-push

# Functional feature testing on a draft PR
$CLI create-pr 42 --draft
$CLI update-status 42 "Human testing"

# Code review on the ready PR
$CLI ready-pr 42
$CLI update-status 42 "In review"

# After approval, green CI, and merge
$CLI list-incomplete-children 42
$CLI update-status 42 "Done"
```

**Human testing** is functional feature testing on the draft PR. **In review** is code review on the same PR after it is marked ready. Those are different human gates.

## Solo route

Solo removes `Ready` and the separate `Human testing` status:

```text
Backlog → In progress → AI testing → In review → Done
```

After automated testing, PR review is the human gate. The developer can still run manual tests when the change warrants them; push protection, CI, review, and merge requirements remain active.

## Native sub-issues

`create-subtask` creates the issue and establishes the native `addSubIssue` relationship. That relationship powers Epic roll-up and the parent `Done` guard. A title prefix, body reference, or Markdown
checkbox is not a substitute.

`list-incomplete-children` follows those native relationships and checks each child's Projects V2 status. An issue being closed does not prove that its board status is `Done`.

## Troubleshooting

- **Transition refused**: compare the board options with `workflow.statuses`.
- **Child missing from the guard**: restore the native sub-issue relationship; use `create-subtask` instead of raw issue creation.
- **Wrong complexity**: inspect with `get-complexity`, then replace it with `set-complexity`.
- **PR command fails**: check `workflow.prTargetBranch`, the remote feature branch, and ticket number in the branch convention.
- **Human testing confused with review**: keep the PR in draft for feature testing and mark it ready only for `In review`.

## Other board tools

The adapter contract allows other integrations, but their maturity must remain visible: GitHub Projects covers the complete v1 workflow; Jira and Linear are experimental; Notion covers the v1 SRS
without being a complete workflow tracker.
