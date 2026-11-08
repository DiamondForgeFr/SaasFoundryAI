# sf workflow

Manage complexity-adaptive workflow configuration and coding-agent rules. Team and Solo are the end-to-end guarded v1 presets; Custom templates are an advanced configuration surface.

## Usage

```bash
sf workflow [subcommand] [args...]
```

## Options

| Flag                            | Description                                                                                                                               | Default |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `show`                          | Show current workflow configuration                                                                                                       | -       |
| `use <template>`                | Apply a workflow template, keeping the current board; `--project-url <url>` attaches one, `--create-board` creates a GitHub Projects one  | -       |
| `set-working-branch <branch>`   | Set the working branch for git workflow; a PR target that followed it follows it again                                                    | -       |
| `set-pr-target-branch <branch>` | Set the branch pull requests target                                                                                                       | -       |
| `set-local-ci <context...>`     | Record the commit statuses that must be green before review (the local CI gate); `--from-molten`, `--none` or `--clear` instead of a list | -       |
| `set-ai-rules`                  | Configure AI development rules                                                                                                            | -       |
| `validate`                      | Validate workflow configuration                                                                                                           | -       |
| `save <template>`               | Save current config as template                                                                                                           | -       |
| `list`                          | List available workflow templates                                                                                                         | -       |
| `create <template>`             | Create a new workflow template                                                                                                            | -       |
| `delete <template>`             | Delete a workflow template                                                                                                                | -       |
| `show-template <template>`      | Show a specific template                                                                                                                  | -       |

## Examples

```bash
# Show current workflow config
sf workflow show
```

```bash
# Use an existing template
sf workflow use my-template
```

```bash
# Set working branch
sf workflow set-working-branch develop
```

```bash
# Require these commit statuses on a pull request head before review
sf workflow set-local-ci local-unit local-e2e
```

```bash
# Record the local-<job> statuses of the jobs .molten/project.json declares
sf workflow set-local-ci --from-molten
```

```bash
# Configure AI rules
sf workflow set-ai-rules
```

```bash
# List available templates
sf workflow list
```

```bash
# Save current config as template
sf workflow save my-template
```

## Notes

The workflow system is complexity-adaptive: each ticket is tagged `bug | low | medium | complex`, which scales the ceremony (analyze depth, plan approval gates, adversarial review). See
[Workflow System](/workflow/introduction) for the full lifecycle.

Team separates functional feature testing (`Human testing`) from code review (`In review`). Solo removes the separate Human testing status. Custom templates store an ordered status list, but v1 does
not generate complete status documents or arbitrary transition guards for new names. Extend the installed skill before using one as a delivery contract.

`sf workflow validate` checks local manifest fields in v1; it does not compare the configured remote board.

### Local CI gate (`set-local-ci`)

With GitHub Projects, a pull request opened for review (`create-pr` without `--draft`), marked ready (`ready-pr`) or moved to Human testing needs the project's local CI statuses green on its exact
head commit. The statuses come from one of three sources, in this order, and `sf workflow show` and `sf status` print which one applies:

1. **The manifest**: `workflow.localCi.requiredStatuses`. It always wins. `set-local-ci <context...>` records an explicit list (no blank, no duplicate).
2. **A Molten pipeline**: with the key absent, `.molten/project.json` declares at least one job in `ci.jobs` and `"ci": { "statuses": "github" }`. Each job `<name>` publishes the status `local-<name>`
   and every one is required. The list is derived on every run, so a job added to the pipeline is required at once.
3. **Neither**: the status `AI testing / Local CI`, which the agent publishes with `workflow-cli.sh ai-status <ticket> "Local CI" success` once the project's own suite is green.

| Command                      | Effect                                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `set-local-ci <context...>`  | Records the list. The manifest then wins over the other two sources.                                                                                                          |
| `set-local-ci --from-molten` | Records the `local-<job>` list of `.molten/project.json`. Refused when the file is missing, malformed, declares no job or does not publish to GitHub. The list is **pinned**. |
| `set-local-ci --none`        | Records an empty list: a deliberate "this project has no local CI". The gate prints a notice and checks nothing.                                                              |
| `set-local-ci --clear`       | Removes `workflow.localCi`: the gate derives its list again (source 2, then 3).                                                                                               |

A recorded list is pinned: a job added to `.molten/project.json` afterwards is not required until you record the list again (`--from-molten`), or `--clear` it to follow the pipeline. The command
writes a field that already exists in the manifest: there is no manifest migration. Commit the change with your branch. The gate is applied by the GitHub Projects tool only.

## See Also

- [CLI Commands](/cli/sf-new)
- [Getting Started](/getting-started/quick-start)
