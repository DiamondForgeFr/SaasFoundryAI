# Workflow system

SaaSFoundryAI installs a status-driven delivery contract that humans and coding agents can both inspect. The workflow is not a prompt convention: its ordered statuses, branches, pull-request target
and board live in `.saasfoundry.json`, while guarded CLI commands enforce transitions.

## Two built-in workflows

### SaaSFoundry AI Workflow · team preset

The complete preset separates functional validation from code review:

```text
Backlog → Ready → In progress → AI testing → Human testing → In review → Done
                                                       │              │
                                               feature testing   code review
```

- **Human testing** is feature testing. A human exercises the delivered behavior from a draft pull request and its test plan.
- **In review** is code review. The same pull request is ready, full CI runs, reviewers inspect the implementation, and the developer merges it.

This seven-status preset is recommended for teams and for user-facing changes that benefit from an explicit functional checkpoint.

### SaaSFoundry Solo · solo preset

The lighter preset keeps the same implementation and automated-test discipline but folds the human gate into pull-request review:

```text
Backlog → In progress → AI testing → In review → Done
```

There is no separate `Ready` or `Human testing` column. `In review` is both the human checkpoint and code review; the reviewer can also test the feature manually when needed. A project can move
between the built-in presets with `sf workflow use saasfoundry` or `sf workflow use solo`.

## Custom workflows and reusable templates

Interactive setup also offers **Custom Workflow**. You name and describe at least two statuses, choose their board colors, and SaaSFoundryAI writes that sequence to the manifest. You can then:

```bash
sf workflow save my-team-flow
sf workflow create another-flow
sf workflow list
sf workflow use my-team-flow
sf workflow validate
```

Saved templates retain statuses, branch policy, issue types and AI rules. Applying a template regenerates the installed workflow skill; when GitHub Projects is configured, SaaSFoundryAI also attempts
to align the board's Status options.

::: warning Guard coverage follows the installed status documents

The two built-in presets ship matching status documents and tested transition guards. A custom sequence is supported as configuration, but teams must give every status a precise description and verify
that their review policy still has an explicit human gate.

:::

## Three independent control axes

The workflow shape is only one part of the contract:

- **Preset or custom statuses** decide which phases exist.
- **Complexity** (`bug`, `low`, `medium`, `complex`) decides how much analysis, planning and review happens inside those phases.
- **Nature** decides the delivery path: user-facing, internal, bundled child or Epic.

Nature-controlled routes are intentional, guarded exceptions rather than accidental skipped columns. For example, a bundled child contributes an atomic commit to its delivery parent's pull request,
and an Epic owns neither a branch nor a pull request.

SRS drafting tickets also use a dedicated drafting lifecycle inside the `In progress` board column: AI draft → human review → spawning → Done. They do not pretend to be code changes.

## Why the guardrails start before code review

Traditional Git flows often place the first serious checkpoint at the pull request. SaaSFoundryAI starts earlier:

1. clarify the ticket and classify risk;
2. approve the plan when complexity requires it;
3. implement on the configured branch with native child tickets;
4. commit and push before AI testing;
5. produce a test plan and evidence;
6. run the human gate configured by the workflow;
7. complete code review and verify the merge before Done.

The result is an audit trail that explains not only what changed, but why the change was allowed to advance.

## Source of truth

The agent reads, rather than guesses, these manifest fields:

- `workflow.template` and `workflow.statuses`
- `workflow.workingBranch` and `workflow.prTargetBranch`
- `workflow.branchNaming` and `workflow.commitFormat`
- `workflow.projectUrl` and `workflow.tool`
- `aiRules`

Run `sf workflow show` to inspect them and `sf workflow validate` to compare the manifest with the configured board.

## Tool support in v1

| Surface         | v1 status                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| GitHub Projects | Complete delivery contract, including native sub-issues, statuses, milestones and pull-request guards |
| Jira            | Experimental adapter; not full parity with the GitHub contract                                        |
| Linear          | Experimental adapter; not full parity with the GitHub contract                                        |
| Notion          | Complete SRS backend, not a complete v1 workflow tracker                                              |

The workflow core remains tool-neutral, but neutral interfaces do not imply equal adapter maturity. See [Connect your tools](/features/your-tools) for the detailed matrix.

## Next steps

- [Team 7-status system](/workflow/7-status-system)
- [Complexity system](/workflow/complexity-system)
- [Agent rules](/workflow/ai-rules)
- [GitHub Projects integration](/workflow/github-integration)
