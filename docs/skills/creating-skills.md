# Creating Skills

SaaSFoundry ships a curated catalogue (see [Core Skills](/skills/core-skills), [Tool Skills](/skills/tool-skills)), but your project will have conventions unique to it — domain language, a custom
release script, a deployment checklist that only makes sense for your infrastructure. Write a **custom skill** to teach Claude those conventions so every contributor (human or AI) follows them
identically.

This page walks through building a skill **inside your project**. For contributing a skill back to SaaSFoundry itself, see [Contributing](/contributing/development).

## What is a skill, in 20 seconds

A skill is a directory under `.claude/skills/` containing at minimum a `SKILL.md` file. The `SKILL.md` is:

- A markdown reference Claude reads in full before acting
- Plus a YAML front-matter declaring the skill's metadata (name, description, allowed tools, auto-trigger keywords)

When you say something that matches a skill's trigger keywords, Claude loads the full `SKILL.md` into its context before taking action. When you say `/skill-name`, the same happens explicitly.

## Minimal example: `deploy-preview`

Let's build a skill that encapsulates your team's "deploy a preview environment" ritual.

### 1. Create the directory

For a multirepo project, place it under the app that owns the behaviour (`apps/api/` if it's API-specific, `apps/web/` for frontend). For a monorepo, use the root:

```bash
mkdir -p .claude/skills/sf-deploy-preview
```

Note the `sf-` prefix — keep it consistent with SaaSFoundry's convention to avoid collisions with globally installed skills.

### 2. Write `SKILL.md`

```markdown
---
name: deploy-preview
description: Deploy a preview environment for the current feature branch. Auto-triggers on "deploy preview", "spin up preview", "ephemeral env". Use after Human testing, before opening the PR.
model: haiku
allowed-tools: Bash(gh :*), Bash(fly :*), Bash(git :*)
---

# Deploy preview

Spin up a short-lived preview environment on Fly.io for the current feature branch, comment the URL back on the ticket, and (if the Human testing status wants it) post a screenshot.

## Preconditions

- Clean working tree (`git status` empty)
- Pushed branch (`git log origin/$BRANCH..HEAD` empty)
- Ticket is in Human testing (checked via `$CLI status <N>`)

## Workflow

1. Resolve the ticket number from the current branch name (`feature/N-*`)
2. Build the preview Docker image: `docker build -t myapp-preview:$BRANCH`
3. Deploy to Fly.io: `fly deploy --app myapp-preview-$BRANCH`
4. Wait for the health check: poll `https://myapp-preview-$BRANCH.fly.dev/api/health` until 200
5. Post the URL as a comment on the GitHub ticket: `gh issue comment <N> --body "Preview: https://..."`
6. Post in Slack #engineering if the repo contains a .saasfoundry-slack webhook

## Rollback

If step 3 fails, run `fly apps destroy myapp-preview-$BRANCH` before exiting.

## Rules

- Never deploy to production from this skill
- Never skip the health check wait — the URL posted must actually respond
- The preview name includes the branch, so concurrent previews don't collide
```

That's it. No TypeScript, no JSON config — just markdown Claude reads. The `allowed-tools` front-matter restricts what the skill can actually invoke (in this case, `gh`, `fly`, `git` — nothing else).

### 3. Optional: add a CLI script

For skills that wrap complex CLI interactions, keep the command logic in a shell script alongside `SKILL.md` and reference it from the workflow:

```
.claude/skills/sf-deploy-preview/
├── SKILL.md
├── deploy-preview.sh    # The actual deploy script
└── README.md            # Human-readable docs
```

Then the `## Workflow` section of `SKILL.md` points at the script:

```markdown
1. Run `bash .claude/skills/sf-deploy-preview/deploy-preview.sh $BRANCH`
```

This is the pattern used by `sf-tool-github-projects`, `sf-tool-atlassian`, and all SaaSFoundry-shipped tool skills.

### 4. Test by invocation

Open Claude Code in the project and try both invocation paths:

```
> /sf-deploy-preview
```

should load the skill and execute the workflow. Say naturally:

```
> spin up a preview environment for this branch
```

should hit the auto-trigger keywords and load the skill without the explicit `/` prefix.

### 5. Commit

```bash
git add .claude/skills/sf-deploy-preview/
git commit -m "feat(#N): add sf-deploy-preview skill"
```

The skill is now part of the project. Anyone who clones the repo — human or AI — picks it up automatically.

## Writing a good `SKILL.md`

A few patterns from the SaaSFoundry-shipped skills that make them work reliably:

### Front-matter: be specific in `description`

The `description` field is what the AI reads to decide whether to load the skill. Vague descriptions mean wrong loads (or worse, missed loads):

**Not great**:
```yaml
description: Helps with deployments
```

**Better**:
```yaml
description: Deploy a preview environment for the current feature branch. Auto-triggers on "deploy preview", "spin up preview", "ephemeral env". Use after Human testing, before opening the PR.
```

Include auto-trigger keywords inline so Claude has them in one place.

### Body: lead with preconditions

State what must be true before the skill runs. This lets Claude bail out cleanly when the world isn't in the right state instead of producing a half-done result:

```markdown
## Preconditions

- Clean working tree (`git status` empty)
- Pushed branch
- Ticket is in Human testing
```

The SaaSFoundry 7-status workflow is enforced exactly this way.

### Body: explicit `## Workflow` steps

Numbered steps, not prose. Each step should be one CLI invocation or one decision. If a step has substeps, extract it into its own section. This makes the skill debuggable — when something goes
wrong, you know which step broke.

### Body: `## Rules` or `## Gotchas` at the end

A few bullets on the surprising bits:

```markdown
## Rules

- Never deploy to production from this skill
- The preview name includes the branch name, so concurrent previews don't collide
- Credentials are in `~/.claude/credentials/fly/` — never display or log
```

This is where tribal knowledge that would otherwise live in Slack DMs gets captured.

### `allowed-tools`: minimise

Every tool you grant is a surface area. If a skill only needs `git` and `gh`, don't allow the full `Bash` tool:

```yaml
allowed-tools: Bash(git :*), Bash(gh :*)
```

When a skill needs to call an external process you don't want to globally whitelist, use a specific bash pattern.

## Sharing a skill across the team

Your custom skill is a normal file in the repo. That means:

- **Git tracks it.** Anyone who pulls the branch gets the skill.
- **Code review catches it.** Teammates can comment on a skill like any other file.
- **`sf update` preserves it.** It's outside the scaffold's file-hash map, so SaaSFoundry never proposes to overwrite it.

For a monorepo, you can share one skill across both `apps/api` and `apps/web` by placing it in the root `.claude/skills/` — both apps pick it up.

For a multirepo, duplicate it across `apps/api/.claude/skills/` and `apps/web/.claude/skills/` if it applies to both. Consider a single source of truth inside one repo and a symlink in the other if
you want to DRY it up, at the cost of multi-repo coordination.

## Hooking a skill into the workflow

Custom skills can be invoked from inside `sf-workflow` transitions. For instance, you could teach `sf-workflow` to run `sf-deploy-preview` when transitioning to Human testing.

To do that, **do not edit `sf-workflow` directly** — `sf update` will overwrite your changes on the next upgrade. Instead:

1. Create a **pre-transition hook** file next to the workflow skill: `.claude/skills/sf-workflow/hooks/pre-human-testing.sh`
2. The hook receives the ticket number as `$1`
3. From the hook, invoke your custom skill or script

This keeps your customisations isolated from the scaffold code that `sf update` manages. Look at the shipped `hooks/` directory — it contains a commented example.

## Graduating a custom skill into SaaSFoundry

If a custom skill ends up useful across multiple projects you own, consider opening a PR to promote it into the SaaSFoundry catalogue. That way it ships with every new project, not just the one you
built it in.

See [Contributing](/contributing/development) for the PR checklist (duplicate into `scaffolds/blueprints/api/.claude/skills/`, `scaffolds/blueprints/web/.claude/skills/`,
`scaffolds/overlays/monorepo/root/.claude/skills/`, plus tests and doc updates).

## Next steps

- Read a few shipped `SKILL.md` files (`cat .claude/skills/sf-git-commit/SKILL.md`) — they are the best reference for what works
- [`sf skill` reference](/cli/sf-skill) — CLI for listing/describing skills
- [Skills System guide](/guide/skills-system) — conceptual overview
