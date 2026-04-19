# Development

Setup, conventions and workflow for contributing to SaaSFoundry itself. If you are **using** SaaSFoundry-generated projects, look at [Getting Started](/getting-started/installation) instead.

## Prerequisites

- **Node.js** ≥ 20.19.0 (Prisma 7 + Vite 7 baseline)
- **npm** ≥ 10 (bundled with Node 20.19)
- **Docker** + Docker Compose (required for the pre-push and `test:docker` layers)
- **Git** — conventional commits enforced by commitlint + Husky
- **`gh` CLI** authenticated to GitHub (for workflow-aware commands)

Optional but strongly recommended:

- [OrbStack](https://orbstack.dev/) instead of Docker Desktop on macOS (lighter, faster, same API)
- `jq` — the GitHub Projects CLI scripts pipe through it for JSON handling

## Cloning and bootstrapping

```bash
git clone git@github.com:DiamondForgeFr/SaaSFoundry.git
cd SaaSFoundry
npm install
npm run build
npm link
```

After `npm link`, the `sf` binary on your PATH points at your working copy. A local edit + `npm run build` is immediately reflected in `sf new` / `sf update`.

To revert: `npm run uninstall` (unlinks the global binary and clears the shell hash).

## Repository layout

```text
src/
├── commands/         # CLI entry points (new.ts, update.ts, workflow.ts, skill.ts, tools.ts, ...)
├── prompts/          # Inquirer prompt definitions
├── builders/         # Scaffolding builders (api, web, monorepo, db, s3, dev-services)
├── installers/       # Optional-module installers (email, storage, analytics, skills)
├── runners/          # Post-setup runners (database, s3, server, terminal)
├── feedback/         # `sf feedback` implementation (bug / request / vote / list)
├── skill/            # Skill lifecycle (install, update, manifest, paths)
├── catalogue/        # Module catalogue definitions
├── types.ts          # All public types
├── utils.ts          # Utility helpers
└── index.ts          # Commander bootstrap

scaffolds/
├── blueprints/       # Base templates: api/, web/, db/, s3/
├── overlays/
│   ├── monorepo/     # Topology overrides — root/, api/, web/
│   ├── multirepo/    # Topology overrides — api/, web/
│   └── modules/      # Optional modules — email/, storage/, analytics/
└── skills-templates/
    ├── core/         # Always-installed .claude/skills/
    ├── optional/     # sf-tool-* skills you opt into
    ├── tools/        # Workflow tool skills (github-projects today)
    └── workflow/     # The sf-workflow orchestration skill

tests/docker/         # 18-scenario real-build test suite
bin/sf.js             # CLI entry point
scripts/              # tag-manager.sh (RC branch version management)
docs/                 # VitePress source for saasfoundry.dev
```

See [Project Structure](/guide/project-structure) for the same layout from a **user's** perspective — and [Types](/api/types), [Builders](/api/builders), [Installers](/api/installers),
[Runners](/api/runners) for the API-level references.

## Daily development commands

```bash
npm run build          # tsc — compile src/ → dist/
npm run dev            # tsc -w — watch mode
npm run format         # prettier --write on .{js,jsx,ts,tsx,json,css,md}
npm run lint           # eslint --config eslint.config.mjs

npm run test:pre-commit  # format + lint + build + jest (~15s — runs on every commit)
npm run test:pre-push    # top-2 Docker scenarios (~2-3 min — runs on every push)
npm run test:full        # pre-commit + pre-push — the full local signal
npm run test:docker      # all 22 Docker scenarios (~65 min — nightly / on demand)

npm run docs:dev         # VitePress dev server for docs/
npm run docs:build       # VitePress production build
npm run docs:generate    # Regenerate CLI pages from Commander sources
```

See [Testing](/guide/testing) for the full test strategy.

## The dogfooded workflow

**SaaSFoundry uses its own generated workflow to ship itself.** The `.claude/skills/sf-workflow/`, `.claude/skills/sf-tool-github-projects/` and `.saasfoundry.json` files in this repo are the same
files that land in every project created via `sf new`.

That means every change here goes through the 7-status lifecycle:

```text
Backlog → Ready → In progress → AI testing → Human testing → In review → Done
```

Non-negotiable rules (encoded in `.claude/skills/sf-workflow/SKILL.md`):

- Never skip statuses. No Backlog → AI testing jumps, no PR before Human testing.
- Use the CLI scripts, not raw `gh api` calls — `.claude/skills/sf-workflow/workflow-cli.sh` and `.claude/skills/sf-tool-github-projects/github-projects-cli.sh` are the interfaces.
- Push the branch before transitioning to AI testing. Code must exist on remote before any automated testing phase.
- Subtasks are real GitHub issues, created via `create-subtask`. No Markdown checkboxes posing as subtasks.
- Before transitioning a parent, `gh issue list --state open --search "parent #N"` must return empty.

See [Workflow Introduction](/workflow/introduction) for the conceptual model and [AI Rules](/workflow/ai-rules) for the full rule list.

## Commit conventions

Commits follow the conventional-commits pattern enforced by commitlint:

```text
<type>(#<ticket>): <description>
```

- **type** — one of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`, `revert`
- **ticket** — the GitHub issue number, required (no `#` in the ticket, just the number)
- **description** — imperative mood, lower-case first letter, no trailing period
- **header max** — 100 characters
- **body lines max** — 100 characters each

Example:

```text
feat(#54): add sf-tool-clickup workflow adapter

Wires ClickUp's REST API into the sf-workflow abstraction. Mirrors the
sf-tool-github-projects shape — status, create-subtask, set-complexity,
update-status — so the sf-workflow skill needs no adapter-specific code.
```

Husky's `commit-msg` hook blocks anything that fails commitlint. To bypass in a real emergency: `git commit --no-verify` — reach for this only when the alternative is worse than the risk.

The generated scaffolds allow an additional `update` type that SaaSFoundry itself does not — that is intentional, not a bug. Keep to the enum above for commits in the CLI repo.

## Adding a module

Modules (email, storage, analytics, …) have a consistent shape. To add a new one, say `search`:

1. **Overlay** — drop the source into `scaffolds/overlays/modules/search/`, mirroring the target structure (`services/`, `config/`, etc.).
2. **Blueprint markers** — add `// TODO search-active:` markers in the scaffold code that should stay dormant until the module is installed. See
   `scaffolds/blueprints/api/src/modules/email/services/email.service.ts` for a reference of the marker pattern.
3. **Installer** — create `src/installers/search.installer.ts`. Follow the shape of `email.installer.ts`:
   - Copy the overlay into the target
   - Uncomment the `TODO search-active:` markers
   - Patch `.env`, `.env.test`, and `.github/workflows/deployment.yml`
   - Register any providers in the relevant `*.module.ts`
4. **Prompt** — add a question to `src/prompts/project.prompts.ts` and a branch to `src/prompts/update.prompts.ts` so the module appears in both `sf new` and `sf update --add-modules`.
5. **Wire it into `new.ts`** — call the installer conditionally after the API builder runs. See the existing email / storage wiring.
6. **Tests**:
   - Unit spec in `src/__tests__/integration/installers/search.installer.spec.ts` (follow `email.installer.spec.ts`)
   - Docker scenario entry in `tests/docker/scenarios.ts` for a minimal + full-modules combo
7. **Docs** — create `docs/modules/search.md` following the shape of the other module pages.

See [Module System](/guide/module-system) for the conceptual model and `.claude/docs/architecture-modules.md` for the architecture deep-dive (this file lives in the repo, not the public docs).

## Adding a skill

Skills (`.claude/skills/sf-*/`) shipped by the generator live under `scaffolds/skills-templates/`. To add one:

1. Create the directory under `scaffolds/skills-templates/core/`, `optional/`, `tools/`, or `workflow/` depending on the skill category.
2. Write `SKILL.md` with YAML front-matter (`name`, `description`, `model`, `allowed-tools`). See [Creating Skills](/skills/creating-skills) for the template.
3. For tool skills requiring credentials, add the credential prompt to `src/prompts/project.prompts.ts`.
4. If it is a workflow-tool skill, add a case to `src/installers/tool-skill.installer.ts` and teach `sf-workflow/workflow-cli.sh` about it.
5. Smoke-test: `sf new` → pick the new skill → verify it lands in `.claude/skills/` and that auto-trigger keywords fire in Claude Code.

The architecture doc at `.claude/docs/architecture-skills.md` has the full decision tree for "which kind of skill is this?" and "where do its files go?".

## Adding a Docker test scenario

The Docker scenarios cover the combinations `sf new` can produce. To add a new one:

1. Edit `tests/docker/scenarios.ts` — see [Testing](/guide/testing#writing-a-new-scenario) for the three scenario types (generation, update, ai).
2. Place it at the right priority: earlier = runs sooner under `test:docker --count N`, and the top 2 run on every push.
3. Iterate: `npm run test:docker -- --scenario my-scenario`.
4. When green, commit. CI will pick it up on every PR via `test:full`.

## Working on the CLI with a generated project

When you change the CLI and want to see the effect in a real generated project, the loop is:

```bash
npm run build                     # rebuild dist/
cd ~/tmp
rm -rf my-test-project            # blow away the previous run
sf new my-test-project            # regenerate from your local source
cd my-test-project
npm install
npm run dev
```

Because `npm link` makes `sf` point at your source, you do not need to re-link after each rebuild. Just `npm run build && sf new`. For faster inner loops on a module installer, use the matching
integration spec — they run in ~5 seconds and give you the same assertions minus `npm install`.

## Documentation

Docs are VitePress under `docs/`. Two categories:

- **CLI reference pages** (`docs/cli/*.md`) — autogenerated from Commander definitions. Run `npm run docs:generate` after changing a command's flags; **do not edit these files by hand**.
- **Everything else** — hand-written. Each public-facing change should land with a docs update in the same PR.

Pages live in:

- `docs/getting-started/` — installation → first project → first ticket
- `docs/guide/` — conceptual guides (workflow, skills, modules, testing, project structure)
- `docs/skills/` — skill catalogue + "creating skills"
- `docs/modules/` — one page per optional module
- `docs/workflow/` — workflow deep dive
- `docs/api/` — API reference (types, builders, installers, runners)
- `docs/contributing/` — this page
- `docs/cli/` — autogenerated

The sidebar is configured in `docs/.vitepress/config.mts`. New pages need an entry there or they will 404 even though the file exists.

## Releases

SaaSFoundry publishes to npm from branches prefixed `rc-*`. The flow:

1. Branch off `master`: `git checkout -b rc-feature`.
2. When you push, `scripts/tag-manager.sh` auto-increments the version in `package.json` based on the branch suffix.
3. When the PR merges, `npm publish --tag <beta|latest>` runs from CI.

Do not bump the version in `package.json` by hand on non-RC branches — the tag manager will undo the change on the next RC push.

## Getting help

- Open a [GitHub discussion](https://github.com/DiamondForgeFr/SaaSFoundry/discussions) for questions about contributing
- File a [GitHub issue](https://github.com/DiamondForgeFr/SaaSFoundry/issues) for bugs, feature requests, or doc gaps
- In a generated project: `sf feedback bug` / `sf feedback request` / `sf feedback list` — the `sf-feedback` surface files issues upstream for you

## Next steps

- [Project Structure](/guide/project-structure) — what `sf new` actually produces
- [Testing](/guide/testing) — the four test layers in detail
- [API Reference](/api/types) — internal types the contribution guide references
- [Workflow Introduction](/workflow/introduction) — the 7-status model you will ship against
