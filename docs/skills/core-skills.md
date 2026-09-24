# Core Skills

**Core skills** ship in every generated project. They have no external dependencies, need no credentials, and cover the day-to-day developer loop: commits, pull requests, merges, error fixing, and the
workflow that ties them together.

There are seven of them.

## The catalogue

| Skill                                               | Auto-trigger keywords                                             | What it does                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [`sf-git-commit`](#sf-git-commit)                   | "commit", "save changes"                                          | Generates a conventional commit message and pushes                      |
| [`sf-git-create-pr`](#sf-git-create-pr)             | "open a PR", "create a pull request"                              | Opens a PR targeting your release branch with an auto-written body      |
| [`sf-git-fix-pr-comments`](#sf-git-fix-pr-comments) | "implement the review comments", "address the PR feedback"        | Fetches PR comments, applies each change, commits                       |
| [`sf-git-merge`](#sf-git-merge)                     | "merge the branches", "resolve conflicts"                         | Context-aware conflict resolution                                       |
| [`sf-utils-fix-errors`](#sf-utils-fix-errors)       | "fix errors", "fix typescript", "fix eslint"                      | Fans out across the codebase to resolve ESLint + TS errors              |
| [`sf-utils-fix-grammar`](#sf-utils-fix-grammar)     | "fix grammar", "spellcheck the docs"                              | Grammar / spelling pass on markdown and comments (preserves formatting) |
| [`sf-workflow`](#sf-workflow)                       | "workflow status", "next step", "complexity", "detect complexity" | Runs the configured lifecycle and its transition guards                 |

## `sf-git-commit`

**Philosophy**: speed over perfection. It analyses the working tree, generates one good conventional-commit message, commits, and pushes — no questions asked.

**Typical invocation**:

```
User: "commit these changes"
AI: [auto-stages if nothing is staged]
    [writes `feat(#42): add /api/version endpoint`]
    [git commit && git push]
```

**Commit format** follows `.saasfoundry.json → workflow.commitFormat.pattern`:

```
<type>(#<ticket>): <description>
```

Types: `feat`, `fix`, `update`, `docs`, `chore`, `refactor`, `test`, `perf`, `revert`. The pre-commit hook (Prettier + ESLint + tsc + Jest) runs before the push — if anything fails, the commit is
blocked. The skill respects that, never uses `--no-verify`.

**When to override**: if you want to write the message yourself, just commit manually. `sf-git-commit` never fights you.

## `sf-git-create-pr`

Opens a pull request from the current feature branch to `.saasfoundry.json → workflow.prTargetBranch` (usually `develop`).

**What the generated PR includes**:

- Title in the same conventional-commit format: `feat(#42): add /api/version endpoint`
- Body with a summary, the commit list, and a test-plan checklist
- A back-link to the workflow ticket
- The appropriate CI trigger for a draft or review-ready PR

**Preconditions it enforces**:

- Working tree is clean (no uncommitted changes)
- Current branch has been pushed
- Base branch exists on remote
- The ticket has completed AI testing before the Team workflow opens its draft PR for functional validation

If any precondition fails, the skill explains what's missing and stops. It does not bypass the workflow. In the Team preset, the same draft PR is marked ready after functional validation and before
the ticket enters code review. In the Solo preset, PR review is the human gate.

## `sf-git-fix-pr-comments`

When reviewers leave comments on your PR, this skill fetches them, groups them by file, and works through each one — making the code change, committing, and pushing. One commit per comment cluster.

**Typical invocation**: `"implement the review comments"` — or explicitly `/sf-git-fix-pr-comments`.

Under the hood it calls `gh api repos/:owner/:repo/pulls/:number/comments` and walks each thread. It ignores threads marked as resolved; it posts a brief reply on each thread it addresses ("Fixed in
abc1234").

## `sf-git-merge`

A slim, context-aware conflict resolver for the rare cases where `git merge` bails out. It reads the conflict hunks, consults `.saasfoundry.json` for branch semantics (working vs release), and
proposes resolutions — the user approves before anything is written.

Not intended as a magic merge button. Most merges in a SaaSFoundryAI project never produce conflicts because the team rebases rather than merges day-to-day. Reach for this skill when rebasing a
long-lived feature branch onto a fast-moving `develop`.

## `sf-utils-fix-errors`

Runs `npm run lint`, `npm run type-check`, and parses the output. For each diagnostic, it edits the offending file to resolve it — respecting project conventions (no `any`, no unused imports, no
bypass comments).

**What it will do**:

- Add missing imports
- Fix wrong generic parameters
- Rename variables to match conventions
- Fix obvious ESLint warnings

**What it will not do**:

- Suppress an error with `// @ts-expect-error` or `// eslint-disable-next-line`
- Change public API signatures
- Rewrite a function's logic

If the only way to fix an error is to rewrite logic, the skill flags it and hands back to you with a one-line summary.

## `sf-utils-fix-grammar`

Grammar, spelling and clarity pass on markdown, JSDoc blocks, and string literals in your translations. Preserves formatting (code fences, tables, front-matter) and never rewrites technical terms.

**Typical use**: after a round of feature work, run `"grammar pass on docs/"` to tidy before PR.

## `sf-workflow`

The most important core skill — and the one you will invoke least often explicitly, because the others call it implicitly.

**What it does**:

- Reads the ticket's complexity label (`bug` / `low` / `medium` / `complex`) and adjusts ceremony
- Reads the configured preset: Team uses seven statuses, Solo uses five, and Custom uses the route saved by the project
- Knows the mandatory actions and exit conditions of every configured status
- Enforces the configured route — an agent cannot invent an unapproved shortcut
- Invokes the relevant **workflow tool skill** (`sf-tool-github-projects`, `sf-tool-jira`, etc.) to actually move the ticket on your board

**Explicit usage**:

```bash
/sf-workflow status 42                # What status is ticket 42 in? What's next?
/sf-workflow detect-complexity 42     # Suggest a complexity tag based on the description
/sf-workflow validate 42              # Can this ticket move forward?
/sf-workflow next 42                  # What's the exact next action?
```

**Configuration is in `.saasfoundry.json`** — branch names, PR target, status names, commit format. `sf-workflow` never hardcodes any of them. If you change the workflow (e.g. renaming "Human testing"
to "QA"), edit `.saasfoundry.json` and re-run `sf update` — the skill picks up the new names automatically.

The Team preset separates **Human testing**, the functional validation of a draft PR, from **In review**, the code review of a ready PR. Solo removes the separate Human testing status and uses PR
review as its human gate.

See [Workflow System](/workflow/introduction) for all three workflow choices and [Team 7-Status System](/workflow/7-status-system) for the complete preset.

## Checking a skill's source

Every core skill is human-readable:

```bash
cat .claude/skills/sf-git-commit/SKILL.md        # Multirepo: apps/api/.claude/…
```

The front-matter at the top of each `SKILL.md` declares:

- `name` — the identifier used for `/name` invocation
- `description` — what the skill does + auto-trigger keywords
- optional host-specific metadata, such as a preferred model
- `allowed-tools`, when the host supports it — what the skill may invoke (`Bash(git :*)`, `Bash(npm :*)`, …)

These files are the source of truth. Reading them is the fastest way to understand what a skill will actually do before you run it. Discovery depends on the coding-agent host: Claude Code uses
`CLAUDE.md` and `.claude/skills`, while Codex uses `AGENTS.md` and `.agents/skills`.

## Next steps

- [Tool Skills](/skills/tool-skills) — the opt-in skills for external services
- [Creating Skills](/skills/creating-skills) — write your own
- [`sf skill` reference](/cli/sf-skill) — CLI for skill management
