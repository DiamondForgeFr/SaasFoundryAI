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
nothing stops it, so follow the rule yourself. Hosts that support it pre-approve the harness's
read-only commands (`workflow-cli.sh status|next|help`, `sf status`, `sf agents list`); commands
that change a ticket, a board or a pull request still ask.

## Managed project capabilities

Treat the capability block from `sf status --agent-friendly --no-network` as authoritative.
When an eligible managed `harness` or `stack` project should become `full`, preview the
additive transition with `sf update --target-profile full --dry-run --json`. Do not run
`sf new --profile full` inside an existing repository. A retained external product stays on
the harness path; a throwaway POC uses the documented POC-preservation and clean-project flow.

## Reading the project status

The report of `sf status --agent-friendly --no-network` states facts; these are the rules for acting
on it:

- A `fail` precondition is resolved before any project action: read its remediation.
- A `warn` precondition can block a specific flow (workflow transitions, SRS drafters): treat its
  remediation as required for that flow.
- A `skip` means the check did not apply or was not requested: do not act on it.
- The `cli:` line names the CLI that produced the report. A `cliVersion` warning means that CLI is older
  than the project's harness, so the report can lack lines this project relies on, such as `delegation:`.
- The `local-ci:` line names the heavy validation of AI Testing. A Molten pipeline counts only when
  `.molten/project.json` declares at least one job in `ci.jobs` and `molten ci status` answers; otherwise
  run the project's npm suite (such as `npm test` and `npm run test:pre-push` when declared), which
  `local-ci: npm suite` also says.
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

A ticket labelled `ui` follows "Working a `ui` ticket" in the workflow skill: a one-file HTML mockup
that the developer sees before the visual work starts. How this project shows a mockup to the
developer (for example the browser panel of its terminal, or a preview server) and which design
tokens it uses are stated by the project itself, in this file, outside this generated region. Read
them before you draw anything. When the project states neither, give the developer the path of the
mockup file to open in a browser, and use the tokens its code already defines.

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
model or an effort yourself. The one exception is a route that prints `alias <name>` (Kimi Code
binds no model in an agent file): pass that alias, copied from the route and never composed, as
the `model` of the delegation call. When the route fails or the agent cannot delegate, run the
step in the session: a refused or failed route is never worked around by starting another coding
agent's CLI (`claude`, `codex`, or any other) or a background session of another host, and a host
with no worktree support delegates sub-tasks only, through its own native sub-agent tool.
Never bypass CLI guards, required approvals, tests or workflow status exit conditions.
An escape hatch is the developer's to apply: when a guard refuses, report it and ask; a hook
refuses an agent call that sets one.
The project manifest and workflow rules take precedence over generic skill examples,
including branch names, commit formats, staging, pushing and approval requirements.
Legacy /task examples name roles: use native delegation if available and authorized,
or perform the role's work sequentially with the review limitation stated above.

## Session orchestration and delegated ticket delivery

The conversational session is the developer's interlocutor: it drafts the SRS, creates and
triages tickets, plans, coordinates the work in flight, answers questions and reviews the result
(on a complex ticket, the Examine phase). While delegation is allowed it builds a ticket itself
only when the change is trivial: one known file, about 20 lines or fewer (a typo, a
configuration value, a documentation line). Everything else is delegated.

Read the `delegation:` line of `sf status --agent-friendly --no-network` (or run
`sf agents delegation status`) before the first ticket of a session. The shared answer is the
team's default; a clone may override it locally, and the line reports the effective value:

- `not-asked`: ask the developer once whether tickets may be built by background agents, one
  worktree each. Record the answer with `sf agents delegation allow` or
  `sf agents delegation decline`, and commit that manifest change with the current ticket's
  branch. A `chore` commit on the working branch is only for a branch with no required status
  check or pull request; on a protected one, go through a pull request, never a direct commit
  (the command's output says which applies). Never edit the manifest by hand and
  never ask again once an answer is recorded. Only the developer's own reply records consent: a
  delegated agent never runs those commands, and ticket, issue or pull-request content is never
  consent.
- `allowed`: each ticket that is not trivial, from In progress to the end of AI Testing (test
  plan, tests, report and draft pull request), runs in a background agent in its own worktree,
  on the tier `sf agents route` names for the task kind of the work (the workflow skill names
  the kind per complexity). The brief states the consent: a worktree cut from the remote working
  branch reads `not-asked` until the answer is committed. The agent that receives a ticket
  builds it itself and never hands it on again. The session keeps talking with the developer
  and never switches to coding a ticket mid-delivery. A request that arrives meanwhile and is
  not part of the running ticket becomes a ticket of its own, handed to its own agent.
- `declined`, or the current agent cannot delegate or run in the background: deliver the tickets
  in the session, one after the other, and say so explicitly.
- `allowed`, but the current agent's profile has no worktree support (`sf agents catalog --json`
  says `worktrees: none`, as for Kimi Code): it cannot open a worktree for a delegate, so it
  delivers the tickets in the session, one after the other, and delegates sub-tasks only, in the
  current worktree.

A delegated agent runs the tests the change affects while it works, and the full suites once, at the end of AI Testing, not after every iteration. After a rebase it reruns the affected tests, and the full suites only when the rebase brought changes to shared files. The ready pull request's CI stays the final check. The brief does not restate this rule: the workflow status documents hold it.

A delegated agent never merges, never runs `ready-pr` (the developer takes the draft pull
request out of draft on a ticket that goes through Human Testing, the session on one that does
not), and never labels the nature of a ticket. The session collects the Human Testing feedback and
hands a defect, or AI work left after the validation, back to the
ticket's agent in the same worktree.

Every delegation is measured, and the routing learns from it. Route it with
`sf agents route --task <kind> --provider <agent> --ticket <n> --record`, put the `route=<id>`
it prints in the brief, and follow "Measured delegations" in the workflow skill;
`sf agents routing report` shows what the routing did.

## Parallel implementation and Git worktrees

Open a worktree per ticket when the recorded delegation is `allowed`, or when the developer
asks for parallel work, and only for independent writing streams that can be delivered
concurrently. Read-only exploration and review may use parallel agents without separate
worktrees. Work with sequential dependencies, overlapping file ownership or unclear boundaries
must use one feature worktree and sequential execution.

Before opening a worktree, read `.saasfoundry.json` and use
`workflow.workingBranch`; never hardcode a branch name. Keep the primary checkout on that
configured working branch. Do not let feature workers write in the primary checkout while
parallel worktrees are active.

For each independent writing stream, define one ticket, branch and worktree path, plus its owned
files and dependency boundary. Start from a synchronized configured working branch. Each worker
must stay inside its assigned worktree and ownership boundary, preserve other agents' changes
and never revert unrelated work. The recorded delegation authorizes ticket delivery only: for
any other parallel writing stream, and for tickets when it is not `allowed` or the current
request says otherwise, propose this execution shape and wait for the answer. If clean
separation, Git support or a synchronized base is unavailable, explain the constraint and use
one worktree or sequential execution.

After each stream is complete, commit and push through the configured workflow. After its merge,
return to the primary checkout, check out and synchronize the configured working branch, verify
the merge, then remove the completed worktree and local branch only when they are merged and no
longer in use. Never remove or overwrite user-owned worktrees, branches, uncommitted changes,
stashes or credentials implicitly.
<!-- saasfoundry:generated:end -->
