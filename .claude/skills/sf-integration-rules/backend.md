# Backend integration grammar (apps/api)

> **Status: stub.** Filled by Story #307 (S2 — backend grammar guides). Until that story lands, fall back to mirroring the structure of `apps/api/src/modules/organizations/` (the most complete
> reference module) and use the section anchors below as a checklist for what S2 will eventually expand.

## Module structure (anchor)

A new module under `apps/api/src/modules/<name>/` ships:

- `<name>.module.ts` — NestJS module declaration
- `controllers/<name>.controller.ts` — HTTP endpoints
- `services/<name>.service.ts` — business logic
- `dto/` — request/response DTOs (Zod-derived via `nestjs-zod`)
- `tests/unit/*.spec.ts` — Jest unit tests
- `tests/e2e/*.spec.ts` — Supertest E2E tests

## Prisma (anchor)

- Multi-file schema under `prisma/schema/` — one file per domain
- Soft delete via `deletedAt`
- `createdAt` / `updatedAt` on all entities
- After editing schema: `npm run db:update:dev`

## RBAC (anchor)

- `@RequirePermissions([], '<PERMISSION_KEY>')` on controller methods
- `PermissionsGuard` already wired globally — opt out with `@SkipPermissions()`
- New permission keys: declare in the centralized RBAC enum + seed migration

## Validation (anchor)

- Schemas live in `src/shared-validation/` (vendored mirror)
- Factory function pattern (`buildXxxSchema(messages?)`) — see `auth.ts` for reference
- `createZodDto(buildXxxSchema())` produces the NestJS DTO

## Tests (anchor)

- Unit: pure logic with mocked repos
- E2E: `Test.createTestingModule()` + `supertest` + tmpfs DB
- Run: `npm run test:unit`, `npm run test:e2e`, `npm run test:full`
