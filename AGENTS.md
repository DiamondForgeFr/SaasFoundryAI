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

- **Statuses**: `Backlog → Ready → In progress → AI testing → Human testing → In review → Done`
- **Before any status transition**: read `.claude/skills/sf-workflow/statuses/<N>-<name>.md` for mandatory actions and exit conditions
- **Never skip statuses.** In particular: never go Backlog → AI Testing, open a draft PR for Human Testing and never mark it ready before human validation (unless ticket carries `nature:internal`).
  Delivery tickets require a verified merged PR before Done, except validated `nature:bundled-pr` children. Epics own no PR and reach Done only after every native child has board status Done.
- **Nature axis (Human Testing optionality)** — `nature:internal` tickets (refactor / scaffolding / non-terminal stories of an Epic) may transition AI Testing → In Review directly. Default (no label
  or `nature:user-facing`) requires Human Testing. The `update-status` guard enforces this — see `.claude/skills/sf-workflow/SKILL.md` "Nature axis" section.
- **Never bypass the CLI**: use `.claude/skills/sf-workflow/workflow-cli.sh` and `.claude/skills/sf-tool-github-projects/github-projects-cli.sh` — not raw `gh api graphql` mutations
- **Heavy validation before Human Testing:** run `npm test` and `npm run test:pre-push` explicitly during AI Testing and record the results. Commits only check what they touch, and iterative pushes do
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

### Harness evolutions — mirrored in SaaSFoundry itself

We dogfood the harness we ship, so every harness evolution reaches this repository in the **same ticket** as the generated projects: a rule only generated projects follow is a rule nobody here has
tried. Whatever the ticket changes among these, its commits also carry the repository's own copy:

- the generated instructions → the regenerated `AGENTS.md` region and `.agents/`;
- a workflow or tool skill → the dogfood `.claude/skills/sf-*` copy next to the template under `scaffolds/skills-templates/`;
- the tier agents or the routing → `.claude/agents/` and `.codex/agents/`;
- a `modules.harness` field → this repository's `.saasfoundry.json` (recorded with its own CLI command, never by hand).

Regenerate with `npm run build && node bin/sf.js agents refresh --scope shared && npx prettier --write .saasfoundry.json`, and commit the result with the change. A ticket that leaves this repository behind
the harness it ships is not done.

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
- `npm run test:pre-push` — the exact three-check normal lifecycle lane (run explicitly during AI Testing before Human Testing)
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
- Current version: 1.0.0-beta (npm package `saasfoundryai-cli`)
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
project root. Hosts that support it pre-approve the harness's read-only commands
(`workflow-cli.sh status|next|help`, `sf status`, `sf agents list`); commands that change a
ticket, a board or a pull request still ask.

## Managed project capabilities

Treat the capability block from `sf status --agent-friendly --no-network` as authoritative.
When an eligible managed `harness` or `stack` project should become `full`, preview the
additive transition with `sf update --target-profile full --dry-run --json`. Do not run
`sf new --profile full` inside an existing repository. A retained external product stays on
the harness path; a throwaway POC uses the documented POC-preservation and clean-project flow.

## Coding-agent identity and onboarding

At session initialization, use the coding-agent identity explicitly supplied by the current
host or session. Never infer an identity from a model or provider name, executable names,
instruction files, repository contents or PATH. If the host identity is absent or ambiguous,
ask the user to select one registered coding-agent profile and do not change the project.

Run `sf agents list --json` and compare that explicit identity with the effective shared and
local inventories. When a supported current agent is undeclared, report both inventories and
ask the user to choose exactly one action: add the current agent, replace the declaration with
an explicitly named non-empty set, or leave the project unchanged. A no-change decision runs
no mutating command.

Only after the user accepts add or replace, ask whether the declaration should be local to the
current machine/worktree or shared through the repository. Use `sf agents enable <agent>` for
an additive local change, `sf agents enable <agent> --scope shared` for an additive shared
change, and `sf agents replace <agents...> --scope <local|shared>` for an exact declaration.
Local onboarding must leave tracked files unchanged. Shared onboarding must produce reviewable
repository changes. Replacing a declaration never authorizes deleting existing instructions,
skills, hooks or settings.

## Execution capabilities

Use the current agent's native tools for reading, editing, shell commands and delegation.
When delegation is available and authorized, assign independent work to agents; otherwise
execute the same steps sequentially. A sequential self-review is not an independent review:
report that limitation and retain any required human review. Tool names in legacy examples
describe capabilities, not required APIs. Use the user's current request as skill arguments.
Do not assume Claude Code hooks, tool permissions or credentials transfer.
Run preconditions explicitly, and stop to report a missing capability when no equivalent exists.
When a workflow step names a task kind, resolve its tier with
`sf agents route --task <kind> --provider <current-agent>` and delegate the step to the
`sf-<tier>` agent it names: that agent carries its own model and effort, so never name a
model or an effort yourself. When the route fails or the agent cannot delegate, run the step
in the session.
Never bypass CLI guards, required approvals, tests or workflow status exit conditions.
The project manifest and workflow rules take precedence over generic skill examples,
including branch names, commit formats, staging, pushing and approval requirements.
Legacy /task examples name roles: use native delegation if available and authorized,
or perform the role's work sequentially with the review limitation stated above.

## Session orchestration and delegated ticket delivery

The conversational session is the developer's interlocutor: it drafts the SRS, creates and
triages tickets, plans, coordinates the work in flight, answers questions and reviews the result
(on a complex ticket, the Examine phase). While delegation is allowed it does not build a
ticket itself.

Read `sf agents delegation status` before the first ticket of a session:

- `not-asked`: ask the developer once whether tickets may be built by background agents, one
  worktree each, then record the answer with `sf agents delegation allow` or
  `sf agents delegation decline`. Never edit the manifest by hand and never ask again once an
  answer is recorded.
- `allowed`: each ticket, from In progress to the end of AI Testing (test plan, tests, report
  and draft pull request), runs in a background agent in its own worktree, on the tier
  `sf agents route` names for the task kind of the work (the workflow skill names the kind per
  complexity). The session keeps talking with the developer and never switches to coding a
  ticket mid-delivery. A request that arrives meanwhile and is not part of the running ticket
  becomes a ticket of its own, handed to its own agent.
- `declined`, or the current agent cannot delegate or run in the background: deliver the tickets
  in the session, one after the other, and say so explicitly.

A delegated agent never merges and, on a ticket that goes through Human Testing, never runs
`ready-pr`: the developer takes the draft pull request out of draft. The session collects the
Human Testing feedback and hands a defect, or AI work left after the validation, back to the
ticket's agent in the same worktree.

## Parallel implementation and Git worktrees

Open parallel worktrees when the recorded delegation is `allowed` or the developer asks for
them, and only for independent writing streams that can be delivered concurrently.
Read-only exploration and review may use parallel agents without separate worktrees. Work with
sequential dependencies, overlapping file ownership or unclear boundaries must use one feature
worktree and sequential execution.

Before opening a worktree, read `.saasfoundry.json` and use
`workflow.workingBranch`; never hardcode a branch name. Keep the primary checkout on that
configured working branch. Do not let feature workers write in the primary checkout while
parallel worktrees are active.

For each independent writing stream, define one ticket, branch and worktree path, plus its owned
files and dependency boundary. Start from a synchronized configured working branch. Each worker
must stay inside its assigned worktree and ownership boundary, preserve other agents' changes
and never revert unrelated work. The recorded delegation is the developer's authorization:
without it, or when the current request says otherwise, propose this execution shape and wait
for the answer. If clean separation, Git support or a synchronized base is unavailable, explain
the constraint and use one worktree or sequential execution.

After each stream is complete, commit and push through the configured workflow. After its merge,
return to the primary checkout, check out and synchronize the configured working branch, verify
the merge, then remove the completed worktree and local branch only when they are merged and no
longer in use. Never remove or overwrite user-owned worktrees, branches, uncommitted changes,
stashes or credentials implicitly.
<!-- saasfoundry:generated:end -->
