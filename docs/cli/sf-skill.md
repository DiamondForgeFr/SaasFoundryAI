# sf skill

Manage the lifecycle of the `tool-saasfoundry` Claude Code skill — install, update, or uninstall at project or user scope.

## Usage

```bash
sf skill <subcommand> [options]
```

## Options

| Flag        | Description                                                                                                                 | Default |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- | ------- |
| `install`   | Install the skill (project scope inside a SaaSFoundryAI project, user scope elsewhere)                                      | -       |
| `update`    | Re-copy the skill if the bundled version is newer than the installed one                                                    | -       |
| `uninstall` | Remove the skill from the chosen scope                                                                                      | -       |
| `--project` | Operate on `.claude/skills/tool-saasfoundry/` (commit to git)                                                               | -       |
| `--user`    | Operate on `~/.claude/skills/tool-saasfoundry/`, for every project. Claude Code gives it precedence over the project's copy | -       |
| `--force`   | Overwrite an existing installation without prompting                                                                        | -       |
| `--yes, -y` | Skip confirmation prompts (useful for CI)                                                                                   | -       |
| `--purge`   | When uninstalling, also delete preferences in `~/.saasfoundry/`                                                             | -       |

`--project` and `--user` are mutually exclusive.

## Default scope

Claude Code gives a personal skill (`~/.claude/skills/`) precedence over a project skill (`.claude/skills/`) of the same name. A personal install of `tool-saasfoundry` therefore hides the copy a
project versions, and keeps running after the project's copy is updated. Inside a managed project the default scope is the project:

- **`install`** writes `.claude/skills/tool-saasfoundry/` under the current directory when it holds a `.saasfoundry.json`, and `~/.claude/skills/tool-saasfoundry/` anywhere else. The output says which
  scope it chose.
- **`update` and `uninstall`** follow an install: they act on the project's copy when the project has one, and on the personal copy otherwise, so a project without a copy of its own behaves as it did
  before.
- **`--project` and `--user`** always decide. Pass `--user` only when you want a personal copy on purpose.
- The SaaSFoundryAI CLI's own source repository counts as "elsewhere": its project skill is a link into the templates the bundle is copied from, and an install must not replace that link.

[`sf status`](./sf-status.md#personal-skills) reports a personal skill that already hides or competes with a project skill, and names the folder to remove.

## Examples

```bash
# Inside a SaaSFoundryAI project: install under .claude/skills/ (commit it)
sf skill install
```

```bash
# Outside a project: install at user scope
sf skill install
```

```bash
# A personal copy for every project, on purpose
sf skill install --user
```

```bash
# Install at project scope from a directory without a manifest
sf skill install --project
```

```bash
# Refresh the installed skill to the current CLI version
sf skill update
```

```bash
# Remove a personal copy that shadows the project's
sf skill uninstall --user
```

```bash
# Remove skill + preferences
sf skill uninstall --purge
```

## Notes

For a full wipe (both scopes + `~/.saasfoundry/`), use `sf uninstall --all` — the top-level convenience command.

## See Also

- [`sf status`](./sf-status.md#personal-skills) — reports personal skills that shadow the project's
- [CLI Commands](/cli/sf-new)
- [Getting Started](/getting-started/quick-start)
