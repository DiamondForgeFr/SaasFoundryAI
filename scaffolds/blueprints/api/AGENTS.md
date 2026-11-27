# {{PROJECT_NAME}} API

NestJS 11 API generated with **SaaSFoundryAI**: Prisma 7 on PostgreSQL 16, JWT with Passport, Zod 4 and class-validator, Winston logs, OpenAPI generated from the decorators.

## 🧭 Preconditions first

Before asking about scope, read `.saasfoundry.json` (workflow, SRS backend, installed modules) and run `sf status --agent-friendly --no-network`. Resolve any `fail` precondition first: its remediation names the `sf` command. Ask only what the manifest does not declare.

## 🎯 Skills

Prefer the `sf-*` skill over a same-named global one (`sf-git-commit` over `git-commit`). Claude Code reads `.claude/skills/`; other agents read `.agents/skills/`.

- `sf-integration-rules`: read it before adding a module, endpoint, Prisma model, RBAC permission, validation or test.
- `sf-git-commit`, `sf-git-fix-pr-comments`, `sf-utils-fix-errors`, `sf-utils-fix-grammar`: commits, PR feedback, lint and type errors, prose.
- `sf-tool-*`: the tools you selected at setup.

## Code Conventions

- A module folder holds `module.ts`, `controller.ts`, `service.ts`, `dto/` (`create-*`, `update-*`, `query-*`) and `tests/unit/*.spec.ts`, `tests/e2e/*.spec.ts`. Imports use the `@modules/*`, `@common/*`, `@configs/*`, `@shared-types/*`, `@shared-validation/*` and `@/*` aliases.
- DTOs are Zod schemas built with `createZodDto` (`nestjs-zod`), defined under `src/shared-validation/` and shared with the frontend. Add `@ApiProperty()` for the OpenAPI document, and `class-transformer` for type coercion.
- Prisma: multi-file schemas in `prisma/schema/`, soft deletes with `deletedAt`, `createdAt` and `updatedAt` on every entity, camelCase relations.

## Shared Layers

`src/shared-types/` and `src/shared-validation/` are vendored copies that the API compiles against.

- **Monorepo** (`packages/` at the root): the same hand-written files are canonical in `packages/shared-{types,validation}/src/`. Edit all three copies together; the CLI's drift guard blocks divergence. Module-deposited values (`EmailOptions`, `STORAGE_LOGO_*`) live only in the workspace: import them from `@<root-package-name>/shared-{types,config}`, never copy them into `src/shared-types/`.
- **Multirepo** (this app stands alone): the vendored copies are the only ones. Values that would sit in `shared-config` are inlined where they are consumed (`STORAGE_LOGO_MAX_BYTES` in `organization.controller.ts`, `EmailOptions` in `mailersend.service.ts`). Keep them stable: the CLI's docker assertions enforce the inlined shape.

Run `sf status --agent-friendly --no-network` to confirm the topology before you edit a shared shape.

## Development Commands

```bash
npm run dev                 # watch mode
npm run db:setup:dev        # rebuild the dev DB and re-seed (DESTRUCTIVE)
npx prisma db push          # sync a schema change without re-seeding
npm run test:unit           # unit tests
npm run test:e2e            # E2E tests, against the test database (docker-compose.db-test.yml, tmpfs)
npm run test:full           # format, lint, type-check and tests
npm run services:up         # DB and S3 (creates the project's Docker network first)
```

There is no migration history: edit `prisma/schema` and `prisma/sql/*`, then `npx prisma db push`, or `npm run db:setup:dev` to rebuild and re-seed.

## 🤖 AI-Assisted Development

- Long-running commands (over about 5 seconds): announce them in one sentence, stream their progress past a minute, and report the outcome with numbers.
- Do not skip tests, bypass the hooks (`--no-verify`) or leave TypeScript errors.

## API Documentation

- Interactive docs: `http://localhost:3500/api/docs`. OpenAPI document: `docs/openapi.json`, regenerated from the decorators.
- Environment variables are listed in `.env.example`; JWT secrets are generated at setup.

## Git Workflow

- Main branch: `{{MAIN_BRANCH}}`. Commits follow `<type>(#<ticket>): <description>` with the ticket number and 100 characters at most; commitlint enforces it.
