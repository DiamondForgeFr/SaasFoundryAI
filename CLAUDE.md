# SaaSFoundry

CLI tool that scaffolds production-ready SaaS projects (NestJS + React + PostgreSQL + Docker).

## 🚨 Critical Rules (non-negotiable)

**We are dogfooding our own system.** Users of SaaSFoundry will rely on their AI agents to follow the workflows we generate. If we don't follow ours rigorously, we can't guarantee the system works.

### Workflow — NEVER bypass

- **Statuses**: `Backlog → Ready → In progress → AI testing → Human testing → In review → Done`
- **Before any status transition**: read `.claude/skills/sf-workflow/statuses/<N>-<name>.md` for mandatory actions and exit conditions
- **Never skip statuses.** In particular: never go Backlog → AI Testing, never create a PR before Human Testing validation, never mark Done before the PR is merged
- **Never bypass the CLI**: use `.claude/skills/sf-workflow/workflow-cli.sh` and `.claude/skills/sf-tool-github-projects/github-projects-cli.sh` — not raw `gh api graphql` mutations
- **Commit + push BEFORE moving to AI Testing.** Code must be on remote before any testing phase.
- **Subtasks must be real GitHub issues** (not checkboxes), created via `.claude/skills/sf-tool-github-projects/github-projects-cli.sh create-subtask`

### Reading before acting

- Workflow: `.claude/skills/sf-workflow/SKILL.md` and the `statuses/` files
- Module architecture (adding/modifying modules): `.claude/docs/architecture-modules.md`
- Skills architecture (adding/modifying skills): `.claude/docs/architecture-skills.md`
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
└── docker/           # Docker-based real build tests (18 scenarios)
bin/                  # CLI entrypoint (sf.js)
scripts/              # Version management (tag-manager.sh)
```

## CLI Commands

- `sf new` — Create a new SaaSFoundry project (src/commands/new.ts)
- `sf update` — Add modules to an existing project (src/commands/update.ts)
- `sf workflow` — Manage workflow configuration and AI rules (src/commands/workflow.ts)

### Dev Commands

- `npm run build` — Compile CLI
- `npm run dev` — Watch mode for CLI development
- `npm run format` — Prettier
- `npm run lint` — ESLint
- `npm run test:full` — Format + Lint + Type-check + Tests + top 2 Docker scenarios (runs on pre-commit)
- `npm run test:docker` — All 18 Docker scenarios (~65 min)
- `npm run test:docker -- --count N` — Top N priority scenarios
- `npm run test:docker -- --scenario <name>` — Single scenario
- `npm run test:docker:list` — Show all scenarios

## Git Workflow

- Main branch: `master` (see `.saasfoundry.json` → `workflow.workingBranch`)
- **ALWAYS** use conventional commits: `<type>(#<ticket>): <description>`
- Types: feat, fix, docs, style, refactor, perf, test, chore, ci, build, revert
- Scope (ticket number) is required by commitlint
- Max header length: 100 characters
- Husky enforces commit format and pre-push checks
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

- Dev database: `docker-compose.db.yml` (port 5435, in-memory tmpfs)
- External network: `docker network create saasfoundry-network`
- API health check: `GET /api/health`
- Build tests: `Dockerfile.test` + `tests/docker/` — generates real projects and runs `npm install` + `tsc` + `nest build` + `vite build`

## Important Context

- This is a **scaffold/generator** CLI — the code in `scaffolds/` is template code, not application code
- **NEVER** modify scaffold templates without considering the impact on generated projects
- Current version: 1.0.0-beta (npm package `saasfoundry-cli`)
- Node.js >= 20.19.0 required (Prisma 7 + Vite 7)
