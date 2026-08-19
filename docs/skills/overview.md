# Skills Overview

SaaSFoundryAI bundles a catalogue of **Claude Code skills** with every generated project. Skills are short, focused capabilities that Claude picks up automatically (keyword auto-trigger) or that you
call explicitly (`/skill-name`). They are the primary way the AI stays consistent with your project's conventions.

## The `sf-` prefix, and why it matters

Every SaaSFoundryAI skill is prefixed with `sf-`:

- `sf-git-commit`, not `git-commit`
- `sf-tool-atlassian`, not `tool-atlassian`
- `sf-workflow`, not `workflow`

The prefix is the contract that lets your project's AI agent coexist with globally installed skills without collisions. When your generated `CLAUDE.md` says "prefer `sf-*` skills", it's because a
globally installed `git-commit` might do the wrong thing for this repo — the `sf-` variant is always the right one.

## Three categories

| Category          | Installed when                                            | Credentials                       | Examples                                                                                                              |
| ----------------- | --------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Core**          | Always — every generated project                          | None                              | `sf-git-commit`, `sf-utils-fix-errors`, `sf-workflow`                                                                 |
| **Tool**          | Opt-in during `sf new` or via `sf update --add-modules`   | Sometimes                         | `sf-tool-context7`, `sf-tool-atlassian`, `sf-tool-notion`                                                             |
| **Workflow tool** | One installed per project, matches your chosen board tool | None (uses `gh` / project tokens) | `sf-tool-github-projects` today; `sf-tool-jira`, `sf-tool-linear`, `sf-tool-notion`, `sf-tool-clickup` on the roadmap |

See [Core Skills](/skills/core-skills) for the always-installed set, [Tool Skills](/skills/tool-skills) for the opt-ins, and [Creating Skills](/skills/creating-skills) for writing your own.

## Where skills live

In a generated **multirepo** project, each app owns its own copy:

```
apps/api/.claude/
├── skills/              # Core skills
└── skills-optional/     # Tool skills you enabled
apps/web/.claude/
├── skills/              # Same set as API
└── skills-optional/     # Same set as API
```

In a **monorepo**, skills are centralised at the root:

```
.claude/
├── skills/              # Shared across apps/api + apps/web
└── skills-optional/
```

Either way, Claude Code discovers them automatically — you never have to point it at a path.

## How skills are invoked

**Auto-trigger** — Claude activates a skill when it spots relevant keywords in your message:

| You say                            | Skill auto-loaded     |
| ---------------------------------- | --------------------- |
| "commit these changes"             | `sf-git-commit`       |
| "fix the typescript errors"        | `sf-utils-fix-errors` |
| "create a PR"                      | `sf-git-create-pr`    |
| "what's the status of ticket #42?" | `sf-workflow`         |
| "use context7 for the NestJS docs" | `sf-tool-context7`    |

**Explicit** — type `/skill-name` to force a skill to load:

```
/sf-git-commit
/sf-workflow status 42
/sf-tool-atlassian jira issue PROJ-123
```

**Chained** — a skill can call another. `sf-workflow` uses `sf-tool-github-projects` under the hood to transition ticket statuses on your board; you never touch the GraphQL yourself.

## How the CLI keeps skills in sync

`sf update` propagates skill evolutions exactly like any other scaffold file (see [Updating Projects](/guide/updating-projects)). If a new version of `sf-git-commit` ships upstream, `sf update` offers
to replace your copy — or flags it as a conflict if you have customised it.

Two invariants hold across upgrades:

- **Core skills are always installed.** `sf update` will re-copy them if they are missing. You cannot uninstall a core skill short of deleting it manually.
- **Tool skill credentials are preserved.** The skill logic lives in `.claude/skills-optional/<name>/` (subject to upgrade); the credentials live in `~/.claude/credentials/<tool>/<account>.env`
  (user-scoped, never touched by `sf update`).

## Discovery

List every skill installed in the current project:

```bash
sf skill list
```

Fetch details about a single skill (auto-trigger keywords, allowed tools, CLI entrypoint):

```bash
sf skill describe sf-git-commit
```

Open the SKILL.md reference directly (most readable form):

```bash
cat .claude/skills/sf-git-commit/SKILL.md
```

## Next steps

- **Want to use a specific skill?** → [Core Skills](/skills/core-skills) or [Tool Skills](/skills/tool-skills)
- **Need a skill that doesn't exist yet?** → [Creating Skills](/skills/creating-skills)
- **Understanding the architecture?** → [Skills System guide](/guide/skills-system)
- **Managing credentials for tool skills?** → [`sf tools` reference](/cli/sf-tools)
