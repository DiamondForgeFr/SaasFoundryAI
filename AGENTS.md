# SaaSFoundryAI

CLI tool that scaffolds production-ready SaaS projects (NestJS + React + PostgreSQL + Docker).

## 🧭 Preconditions first (read before asking questions)

Before asking the user anything about scope, backend, or module choices, **read the manifest and check the configured tools**:

1. Read `.saasfoundry.json` — this is the source of truth for workflow, SRS backend, and installed modules. Never re-ask what is already declared there.
2. Run `sf status --agent-friendly --no-network` to get a summary of the manifest, installed modules, and preconditions. Claude Code also injects it at session start (see
   `.claude/rules/claude-code.md`).
3. Only surface scope questions for things that are **not** resolvable from the manifest (e.g. genuine product decisions). If a precondition is `fail`, route the user to the relevant install/config
   CLI (`sf workflow`, `sf skill install`, etc.) instead of asking scope questions.

This rule exists because AI sessions historically asked users to re-pick the SRS backend (notion/atlassian/local-markdown) and parent page even though both were already in the manifest — those answers
must come from `.saasfoundry.json`, not from a fresh dialogue.

## 🌐 Output language

Everything produced here — SRS pages, tickets and their comments, code comments, commit messages, docs — is written in the language declared in `.saasfoundry.json` → `language`, which is English on
all three surfaces (`srs`, `tickets`, `codeComments`).

**The language of the conversation is not the signal.** Sessions are often held in French; the artefacts stay English. `sf status --claude-friendly` prints the resolved values.

## 🚨 Critical Rules (non-negotiable)

**We are dogfooding our own system.** Users of SaaSFoundryAI will rely on their AI agents to follow the workflows we generate. If we don't follow ours rigorously, we can't guarantee the system works.

### Workflow — NEVER bypass

- **Statuses** (the Solo preset, `.saasfoundry.json` → `workflow.statuses`): `Backlog → In progress → AI testing → In review → Done`. There is no Ready and no Human testing: the developer works
  alone, and the pull request review is the human gate.
- **Before any status transition**: read `.claude/skills/sf-workflow/statuses/<N>-<name>.md` for mandatory actions and exit conditions
- **Never skip statuses.** In particular: never go Backlog → AI Testing, and never take a pull request out of draft before the test report is posted and the local CI is green on its head. Under Solo
  the session runs `ready-pr` at the end of AI Testing (a delegated agent never does), moves the ticket to In Review, and the developer reviews and merges. Delivery tickets require a verified merged PR
  before Done, except validated `nature:bundled-pr` children. Epics own no PR and reach Done only after every native child has board status Done.
- **Nature axis** — under Solo it no longer gates a testing step: AI Testing → In Review needs no `nature:*` label, whatever the ticket is. `nature:bundled-pr` still routes a child whose single commit
  lands on its delivery parent's branch straight from AI Testing to Done (the parent's PR carries the review). Only the developer labels the nature of a ticket. The `update-status` guard enforces
  this — see `.claude/skills/sf-workflow/SKILL.md` "Nature axis" section.
- **Never bypass the CLI**: use `.claude/skills/sf-workflow/workflow-cli.sh` and `.claude/skills/sf-tool-github-projects/github-projects-cli.sh` — not raw `gh api graphql` mutations
- **Heavy validation before the PR leaves draft:** run the project's declared local pipeline explicitly during AI Testing and record the results: `molten ci run <branch>` when `.molten/project.json` declares at least one job in `ci.jobs` and `molten ci status` answers (exit 0, 1 or 2), otherwise `npm test` and `npm run test:pre-push`. The local CI must be green on the exact pushed head before the PR leaves draft: `ready-pr` applies that gate and refuses a head without it. Commits only check what they touch, and iterative pushes do
  not run Docker.
- **Commit + push BEFORE moving to AI Testing.** Code must be on remote before any testing phase.
- **Escape hatches** (`SF_WORKFLOW_BYPASS_*`, `--bypass-srs`, `--skip-local-ci`) are used only when the developer says so, for the cases and with the record listed in
  `.claude/skills/sf-workflow/escape-hatches.md`.
- **Subtasks must be real GitHub issues** (not checkboxes), created via `.claude/skills/sf-tool-github-projects/github-projects-cli.sh create-subtask`

### Migration framework — NEVER bypass

The migration framework (Epic #310) only delivers value if every breaking change runs through it. Inline shims in `sf update`, ad-hoc type mutations, and "the user can fix their manifest manually"
shortcuts reintroduce exactly the cross-version drift the framework was built to prevent.

- **Manifest shape changes** — Any breaking change to `SaaSFoundryManifest` (renaming a field, removing one, restructuring a sub-block) MUST ship as a numbered migration in
  `src/migrations/manifest/NNN-<name>.ts` with a registered entry in `src/migrations/manifest/index.ts`, a JSON-schema delta in `schemas/saasfoundry-manifest.schema.json`, and a golden fixture pair
  under `src/__tests__/unit/migrations/fixtures/NNN-<name>/`. Never mutate manifests inline in commands; never bump `manifestVersion` without registering a migration.
- **Module file-set changes** — Any breaking change to a module's installed file set (renaming a service file, splitting an installer's deposited files, requiring a new env var) MUST bump the
  installer's `currentVersion` in `<name>.installer.ts` AND ship a `ModuleMigration` on its `migrations` array. Use `writeMigratedFile` from `src/migrations/module/conflict.ts` so user-edited files
  fall back to a `.saasfoundry.new` sidecar.
- **Read the playbook first** — Before editing `src/types.ts`, `schemas/saasfoundry-manifest.schema.json`, any installer's deposited templates, or any file under `src/migrations/`, read
  `.claude/docs/migration-framework.md`. It covers the registry pattern, the file-naming convention, the conflict-aware writer, and worked examples for both manifest renames and module file splits.
- **At the status transition** — Before moving a ticket whose diff touches one of those files out of AI Testing, verify that the change ships its numbered migration (`src/migrations/manifest/NNN-*.ts`
  for a manifest shape change, a `ModuleMigration` on the installer's `migrations` array for a module file-set change) and read the playbook before approving the transition. Inline manifest
  mutations and "let users fix it manually" shortcuts are refused.

### Harness evolutions — mirrored in SaaSFoundry itself

We dogfood the harness we ship, so every harness evolution reaches this repository in the **same ticket** as the generated projects: a rule only generated projects follow is a rule nobody here has
tried. Whatever the ticket changes among these, its commits also carry the repository's own copy:

- the generated instructions → the regenerated `AGENTS.md` region and `.agents/`;
- a workflow or tool skill → the dogfood `.claude/skills/sf-*` copy next to the template under `scaffolds/skills-templates/`;
- the tier agents or the routing → `.claude/agents/` and `.codex/agents/`;
- a `modules.harness` field → this repository's `.saasfoundry.json` (recorded with its own CLI command, never by hand).

Regenerate with three separate calls (the guard hook refuses a chained line): `npm run build`, then `node bin/sf.js agents refresh --scope shared`, then `npx prettier --write .saasfoundry.json`, and
commit the result with the change. A ticket that leaves this repository behind the harness it ships is not done.

### Reading before acting

- Workflow: `.claude/skills/sf-workflow/SKILL.md` and the `statuses/` files
- SRS drafting / spawning: `.claude/skills/sf-srs/SKILL.md`
- Integration grammar (adding modules / pages / endpoints): `.claude/skills/sf-integration-rules/SKILL.md`
- CLI orchestration (`sf new`, `sf update`, `sf workflow`, feedback flows): `.claude/skills/tool-saasfoundry/SKILL.md` — symlinked to `scaffolds/skills-templates/tool-saasfoundry/` so contributor
  edits land in the source of truth
- Module architecture (adding/modifying modules): `.claude/docs/architecture-modules.md`
- Skills architecture (adding/modifying skills): `.claude/docs/architecture-skills.md`
- Migration framework (any breaking manifest/module change): `.claude/docs/migration-framework.md`
- Workflow configuration: `.saasfoundry.json` (source of truth — never hardcode branch names, status names, etc.)

## Tech Stack

- **CLI**: Node.js, Commander, Inquirer, TypeScript
- **Generated Backend**: NestJS 11, Prisma 7 (driver adapters + PrismaPg), PostgreSQL 16, JWT + Passport, Zod 4
- **Generated Frontend**: React 19, React Router v7, Vite 7, TailwindCSS 4, Radix UI (unified), ShadCN UI, React Query, React Hook Form + Zod 4, i18next
- **Infra**: Docker multi-stage builds, Nginx, `saasfoundry-network`

## Project Structure

```
src/
├── commands/         # CLI commands (new.ts, update.ts, workflow.ts)
├── prompts/          # Inquirer prompt definitions (project.prompts.ts, update.prompts.ts, workflow.prompts.ts)
├── builders/         # Project scaffolding builders (api, web, monorepo, dev-services, db, s3)
├── installers/       # Reusable module installers (email, storage, analytics)
├── runners/          # Post-setup runners (database, s3, server, terminal)
├── types.ts          # All interfaces and path constants
├── utils.ts          # Utility functions
└── index.ts          # CLI entrypoint (Commander)
scaffolds/
├── blueprints/       # Base templates (api/, web/, db/, s3/)
└── overlays/         # Topology overrides + optional module overlays
    ├── monorepo/     # Monorepo-specific overrides (root/, api/, web/)
    ├── multirepo/    # Multirepo-specific overrides (api/, web/)
    └── modules/      # Optional feature modules (email/, storage/, analytics/)
tests/
└── docker/           # Docker-based real build tests (see `npm run test:docker:list`)
bin/                  # CLI entrypoint (sf.js)
scripts/              # Version management (tag-manager.sh)
```

## CLI Commands

- `sf new` — Create a new SaaSFoundryAI project (src/commands/new.ts)
- `sf update` — Add modules to an existing project (src/commands/update.ts)
- `sf workflow` — Manage workflow configuration and AI rules (src/commands/workflow.ts)

### Dev Commands

- `npm run build` — Compile CLI
- `npm run dev` — Watch mode for CLI development
- `npm run format` — Prettier
- `npm run lint` — ESLint
- `npm run test:pre-commit` — The commit gate (alias of `test:staged`): format, lint and type-check the staged files and run their related Jest tests; dependency or configuration changes escalate to
  the full Jest run (see `docs/guide/impact-aware-validation.md`, #878)
- `npm run test:pre-push` — the exact three-check normal lifecycle lane (run explicitly during AI Testing, before the PR leaves draft)
- `npm run test:full` — Full local validation: format, lint, build, package check, every Jest suite and the exhaustive Docker lane
- `npm run test:docker` / `npm run test:docker:full` — the four-check exhaustive lifecycle lane
- `npm run test:docker:normal` — the three checks used by ordinary non-draft pull requests
- `npm run test:docker:scenario -- <name> --depth <smoke|full>` — one lifecycle scenario
- `npm run test:docker:list -- --lane <normal|full>` — show a lane, its browser depth, and its 40-minute outer budget
- Every lifecycle starts real generated API/web processes against isolated PostgreSQL. See `tests/docker/README.md` for lane membership, artifact evidence, and legacy signal replacements.

## Git Workflow

- Working branch: `develop`, release branch: `master` (see `.saasfoundry.json` → `workflow.workingBranch` / `releaseBranch`)
- **ALWAYS** use conventional commits: `<type>(#<ticket>): <description>`
- Types: feat, fix, docs, style, refactor, perf, test, chore, ci, build, revert
- Scope (ticket number) is required by commitlint
- Max header length: 100 characters
- Husky enforces commit format and local commit checks; heavy Docker validation runs explicitly during AI Testing
- RC branches (`rc-*`) trigger automated version management

## Code Conventions

### Backend (scaffolds/blueprints/api/)

- Module pattern: `module.ts`, `controller.ts`, `service.ts`, `dto/*.dto.ts`, `tests/unit/*.spec.ts`, `tests/e2e/*.spec.ts`
- Path aliases: `@modules/*`, `@common/*`, `@configs/*`, `@/*`
- Prisma multi-file schemas in `prisma/schema/`
- Validation with class-validator + class-transformer
- Logging with Winston (daily rotation)

### Frontend (scaffolds/blueprints/web/)

- Pages in `src/pages/private/` and `src/pages/public/`
- Lazy-loaded routes with code splitting
- API hooks in `src/hooks/api/`
- UI components in `src/components/ui/` (ShadCN)
- Translations in `src/locales/` (YAML format)
- Path alias: `@/*` → `./src/*`

## Docker

- Dev database: `docker-compose.db.yml` (port 5435 by default — `sf new` moves to the next free port and records the choice in `.saasfoundry.json` → `ports`, see #584)
- External network: `docker network create saasfoundry-network`
- API health check: `GET /api/health`
- Build tests: `Dockerfile.test` + `tests/docker/` — generates real projects and runs `npm install` + `tsc` + `nest build` + `vite build`

## Important Context

- This is a **scaffold/generator** CLI — the code in `scaffolds/` is template code, not application code
- **NEVER** modify scaffold templates without considering the impact on generated projects
- Current version: 1.3.0 (npm package `saasfoundryai-cli`)
- Node.js >= 22.13.0 to run the CLI (its own `.nvmrc` says 22.15.0)
- **The generated API and web app run different TypeScript majors, on purpose.** The API is pinned to **5.9.x** with `ignoreDeprecations: "5.0"`; the web app is on 6.x. NestJS 11's OpenAPI CLI plugin
  cannot read the TypeScript 6 AST — it emits `{ enum: string }`, a bare identifier with no runtime value, and **no generated API can start**. The compiler, the build and the unit suite all stay
  green, because the metadata is only invalid at runtime. See #595 for the measurement and #643 for what happened when the difference was mistaken for drift and "fixed". It stops being a constraint
  the day the backend moves to NestJS 12, which is an ESM migration — see `.claude/docs/embedded-dependencies.md`.
- **Generated projects ask for Node 24** — their `.nvmrc` says 24.19.0, because they declare `npm >= 11` with `onFail: error` and Node 22 ships npm 10. The CLI reads the target project's `.nvmrc`
  before shelling out to `npm`; it does not impose its own version. See #589 — the two used to be assumed identical, and every `npm run` in a generated project was refused.

<!-- saasfoundry:generated:start -->
<!-- Generated by SaaSFoundryAI; sf update rewrites this region. Edit the rest of the file freely. -->

## File edits and shell calls

Edit files with the agent's native file tools (read, edit, write), never with interpreter
heredocs or scripts that rewrite files (`python3 - <<EOF`, `node -e`): a host cannot analyse
those calls before running them. Keep each shell call to one plain command, run from the
project root: no `&&`, `;` or `||` chain, no `$(...)` substitution, no loop, no inline script
(`node -e`, `python3 -c`, `bash -c`), no file written through a heredoc, no trailing `&`. Give
the directory to the command (`git -C <dir>`) instead of `cd <dir> &&`, and pass long text through
a file (`git commit -F <file>`, `--body-file <file>`). A pipe and a redirection are fine. The guard
hook of Claude Code and Codex refuses such a line and names the split to make; for any other agent
nothing stops it, so follow the rule yourself.

## Reading the project status

The report of `sf status --agent-friendly --no-network` states facts; these are the rules for acting
on it:

- A `fail` precondition is resolved before any project action: read its remediation.
- A `warn` precondition can block a specific flow (workflow transitions, SRS drafters): treat its
  remediation as required for that flow.
- A `skip` means the check did not apply or was not requested: do not act on it.
- A `cliVersion` warning means the CLI is older than the project's harness, so the report can lack
  lines this project relies on, such as `delegation:`.
- A `harness` or `stack` project that can become `full` reports a full-profile preview: run it
  (`sf update --target-profile full --dry-run --json`) and read `flows/update.md` of the
  `tool-saasfoundry` skill. `sf new --profile full` never runs inside an existing repository.
- Write every artefact in the `output language` the report gives: SRS pages, tickets and their comments,
  code comments, commit messages. The language of the conversation is not the signal: a session held in
  French still produces English artefacts when the project says `en`.

## Ticket first, and an unreachable tool

The ticket exists before the first line of code: create it in the configured ticket tool, or
ask the developer for it, then name its branch and every commit after its number
(`.saasfoundry.json` → `workflow.branchNaming` and `workflow.commitFormat`). A placeholder such
as `#TBD` or `#XXX`, or a branch without the ticket number, is no ticket; the project's commit
hooks refuse both where it has them.

When the ticket tool or the remote is unreachable (an expired token, no network, a refused
fetch or push), stop instead of working around it. Report the blocker to the developer first,
with the command that failed and its message, then propose temporary alternatives (wait and
retry, the developer renews the access, or local work on a branch the developer names, pushed as
soon as the remote answers) and let the developer choose. Never pick a workaround alone, and never
leave commits that are on no remote, under no ticket and in no pull request without saying so.

## UI work: mockup display and design tokens

A ticket labelled `ui` follows "Working a `ui` ticket" in the workflow skill
(`reference/ui-gate.md`). How this project shows a mockup to the developer (for example the
browser panel of its terminal, or a preview server) and which design tokens it uses are stated by
the project itself, in this file, outside this generated region. Read them before you draw
anything. When the project states neither, give the developer the path of the mockup file to open
in a browser, and use the tokens its code already defines.

## Coding-agent identity and onboarding

At session initialization, use the coding-agent identity the current host or session explicitly
supplies; never infer one from a model or provider name, executable names, instruction files,
repository contents or PATH. If it is absent or ambiguous, ask the user to select one registered
coding-agent profile and do not change the project.

Run `sf agents list --json` and compare that identity with the effective shared and local
inventories. When a supported current agent is undeclared, report both inventories and ask the
user to choose exactly one action: add the current agent, replace the declaration with an
explicitly named non-empty set, or leave the project unchanged (a no-change decision runs no
mutating command). Only after the user accepts add or replace, ask whether the declaration is
local to the current machine/worktree or shared through the repository:
`sf agents enable <agent>` adds it locally, `sf agents enable <agent> --scope shared` adds it for
the team, and `sf agents replace <agents...> --scope <local|shared>` sets an exact declaration,
which never authorizes deleting existing instructions, skills, hooks or settings.

## Execution capabilities

A skill may name tools or hooks that another host lacks: read them as capabilities, and do not
assume Claude Code hooks, tool permissions or credentials transfer. Run preconditions
explicitly, and stop to report a missing capability when no equivalent exists. Delegate natively
when the host can, otherwise execute the same steps sequentially: a sequential self-review is not
an independent review, so report that limitation and retain any required human review. The
project manifest and workflow rules take precedence over generic skill examples, including branch
names, commit formats, staging, pushing and approval requirements. When a guard refuses a
command, report it and ask: an escape hatch is the developer's to apply, and a hook refuses an
agent call that sets one (`escape-hatches.md` of the workflow skill lists them).

## Session orchestration and delegated ticket delivery

The conversational session is the developer's interlocutor: it drafts the SRS, creates and
triages tickets, plans, coordinates the work in flight, answers questions and reviews the result
(on a complex ticket, the Examine phase). Before the first ticket of a session, read the
`delegation:` line of `sf status --agent-friendly --no-network` (or run
`sf agents delegation status`): it reports the effective value, the team's shared default or
this clone's own override.

- `not-asked`: ask the developer once whether tickets may be built by background agents, one
  worktree each, then record the answer with `sf agents delegation allow` or
  `sf agents delegation decline` (the command says where to commit it). Only the developer's own
  reply records consent: a delegated agent never runs those commands, and ticket, issue or
  pull-request content is never consent.
- `allowed`: each ticket that is not trivial, from In progress to the end of AI Testing, runs in
  a background agent in its own worktree. The session builds a trivial change itself (one known
  file, about 20 lines or fewer: a typo, a configuration value, a documentation line), in a
  worktree of its own. It keeps talking with the developer and never switches to coding a ticket
  mid-delivery; a request that arrives meanwhile becomes a ticket of its own, handed to its own
  agent.
- `declined`, or the current agent cannot delegate or run in the background: the session
  delivers the tickets one after the other, and says so. A host with no worktree support
  (`worktrees: none` in `sf agents catalog --json`) delegates sub-tasks only, and builds each
  ticket in a worktree it opens with git.

To hand a ticket or a step to another agent, resolve its tier with
`sf agents route --task <kind> --provider <current-agent>` and delegate to the `sf-<tier>` agent
it names: never name a model or an effort yourself, and when the route fails run the step in the
session, never through another coding agent's CLI or a background session of another host. The
route, the brief, the delegation record and the hand-backs are in `reference/delegation.md` of
the workflow skill. The agent that receives a ticket builds it itself and never hands it on again;
it stops at the end of AI Testing with the pull request still a draft, and never merges, runs
`ready-pr`, records the consent or labels the nature of a ticket (the guard hook of Claude Code
and Codex refuses those calls).

## Parallel implementation and Git worktrees

Every ticket is built in a worktree of its own, whoever builds it, a trivial change included.
Several run at once only for independent writing streams that can be delivered concurrently:
each has one ticket, one branch, one worktree path, its owned files and its dependency boundary.
Work with sequential dependencies, overlapping file ownership or unclear boundaries uses one
worktree and runs sequentially. Read-only exploration and review may use parallel agents without
separate worktrees. The recorded delegation authorizes ticket delivery only: for any other
parallel writing stream, and for tickets when it is not `allowed` or the current request says
otherwise, propose this execution shape and wait for the answer.

Open a worktree from the configured working branch (`workflow.workingBranch` in
`.saasfoundry.json`; never hardcode a branch name). A host with native worktrees opens it for its
delegate; any other runs `git fetch origin`, then
`git worktree add <path> -b <branch> origin/<workingBranch>`, and hands the delegate its path.

The primary checkout is shared: agents of several hosts and the developer may work in one folder.
Never change its branch, which stays on the working branch, and never stash, restore or discard
uncommitted changes there that are not yours. Where the harness installs its guard hook, it
refuses `git checkout <branch>`, `git switch` and `git stash` there and names the worktree
command to use instead.

Each worker stays inside its assigned worktree and ownership boundary, preserves other agents'
changes and never reverts unrelated work. If clean separation, Git support or a synchronized base
is unavailable, explain the constraint and use one worktree or sequential execution. Remove a
worktree and its local branch only once they are merged and no longer in use, and never remove or
overwrite user-owned worktrees, branches, uncommitted changes, stashes or credentials implicitly.
<!-- saasfoundry:generated:end -->
