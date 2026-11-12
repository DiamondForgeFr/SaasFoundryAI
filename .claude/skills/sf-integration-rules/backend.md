# Backend integration grammar (apps/api)

How to extend the NestJS API of a SaaSFoundryAI-generated project. **The canonical reference module is `apps/api/src/modules/organizations/`** — when in doubt, mirror its file layout, imports, and
decorator order. The `accounts/` module is a useful second reference (it adds `imports: [CommonModule]` to its module declaration and uses class-validator for some DTOs).

> Topology note. This guide describes patterns that are identical on monorepo and multirepo. Where shared code lives (canonical workspace vs vendored mirror) is covered by `topology.md`. Always run
> `sf status --claude-friendly --no-network` to confirm topology before touching files in `src/shared-{types,validation}/`.

## Module structure (anchor)

A new module under `apps/api/src/modules/<name>/` ships:

```
<name>/
├── <name>.module.ts              # NestJS module declaration
├── controllers/<name>.controller.ts
├── services/<name>.service.ts
├── dto/
│   ├── requests/create-<name>.dto.ts
│   ├── requests/update-<name>.dto.ts
│   └── responses/fetch_<name>.response.dto.ts
└── tests/
    ├── unit/<name>.service.spec.ts
    └── e2e/<name>.e2e-spec.ts
```

Module declaration shape (mirrors `organizations.module.ts`):

```ts
@Module({
  controllers: [OrganizationController],
  providers: [OrganizationService]
})
export class OrganizationsModule {}
```

If the module needs shared services (logger, prisma, etc.), add `imports: [CommonModule]` like `accounts.module.ts`.

**Register the module in `src/app.module.ts`** — add the import and append to the `imports: [...]` array. Do not register modules anywhere else.

## Controllers (anchor)

Class decorators sit in this order — copy from `organization.controller.ts`:

```ts
@ApiTags('Organizations')
@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}
}
```

Per-route decorators stack in this order: HTTP verb → RBAC → guard → OpenAPI → handler.

```ts
@Post()
@RequirePermissions(['ORGANIZATION_CREATION'], 'ORGANIZATION_ADMINISTRATION')
@UseGuards(PermissionsGuard)
@ApiOperation({ summary: 'Create organization', description: 'Create a new organization for an account.' })
async createOrganization(
  @Req() req: AuthenticatedRequest,
  @Body() dto: CreateOrganizationDto
): Promise<FetchOrganizationResponseDto> {
  return this.organizationService.createOrganization(req.user.id, dto)
}
```

A route that takes an account or entity id also declares it, right after the RBAC decorator: `@ScopeFrom('id', 'ACCOUNT')` (see "Scopes (RBAC v2)").

Routes that don't need a specific permission but still need module access use `@RequirePermissions([], '<MODULE_NAME>')`. Public routes are not guarded (omit `@UseGuards(JwtAuthGuard)` at the class
level only if **all** routes are public; otherwise prefer keeping the class-level guard and exposing public endpoints via a different controller).

## DTOs (anchor)

**Requests use Zod** via `nestjs-zod`'s `createZodDto`. The Zod factory schema lives in `src/shared-validation/<domain>.ts` so the frontend can reuse it with i18n messages.

```ts
// src/modules/organizations/dto/requests/create-organization.dto.ts
import { createZodDto } from 'nestjs-zod'
import { buildCreateOrganizationPayloadSchema } from '@shared-validation/organization'

export class CreateOrganizationDto extends createZodDto(buildCreateOrganizationPayloadSchema()) {}
```

```ts
// src/shared-validation/organization.ts
export const buildCreateOrganizationPayloadSchema = (messages: CreateOrganizationPayloadMessages = {}) =>
  z
    .object({
      name: z
        .string()
        .min(1, { message: messages.nameRequired ?? 'Name is required' })
        .max(100),
      type: z.enum(ORGANIZATION_TYPE_VALUES),
      accountId: z.string().min(1)
    })
    .strict()
```

**Responses use class-validator + `@ApiProperty`** so Swagger emits accurate OpenAPI types. The class implements the canonical TS type from `@shared-types/index`.

```ts
// src/modules/organizations/dto/responses/fetch_organization.response.dto.ts
import { ApiProperty } from '@nestjs/swagger'
import type { Organization } from '@shared-types/index'

export class FetchOrganizationResponseDto implements Organization {
  @ApiProperty({ description: 'Organization unique identifier', example: '...' })
  id: string

  @ApiProperty({ description: 'Organization name', example: 'Acme Corporation' })
  name: string
}
```

## Services (anchor)

Inject `PrismaService` + `Logger` + any cross-module services via the constructor. Throw HTTP exceptions (`NotFoundException`, `ForbiddenException`, …) — they are caught by the global filter and
turned into proper responses.

```ts
@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: Logger,
    private readonly accountAccessService: AccountAccessService
  ) {}

  async fetchOrganization(userId: string, id: string): Promise<FetchOrganizationResponseDto> {
    this.logger.debug(`Getting organization ${id}`, 'fetchOrganization')
    const organization = await this.prisma.organization.findUnique({
      where: { id },
      include: { accountsLinked: { select: { accountId: true } } }
    })
    if (!organization) throw new NotFoundException('Organization not found')
    return organization
  }
}
```

**Soft delete is opt-in.** The blueprint's core models (Organization, Account, Entity) do **not** carry `deletedAt`. Add it only when the domain needs it; otherwise hard-delete via
`prisma.<model>.delete()`. **Do not** invent a `deletedAt` filter in queries unless the schema actually has the column.

## RBAC (anchor)

Permissions are **runtime strings** stored in the database (the `module_permissions` table). There is **no TypeScript enum** for them — controllers reference string literals. The decorator signature
lives in `src/common/decorators/require-permissions.decorator.ts`:

```ts
RequirePermissions(permissions: string[], module: string, options?: { requireAll?: boolean })
```

To add a new permission key:

1. Add an `INSERT` to `prisma/sql/datasets/default_user_modules_roles.sql` under the relevant `INSERT INTO public.modules` block, e.g.:

   ```sql
   INSERT INTO public.module_permissions (module_id, name, description, updated_at)
   VALUES
     ((SELECT id FROM public.modules WHERE name = 'INVOICE_ADMINISTRATION'), 'INVOICE_CREATION', 'Create an invoice', NOW());
   ```

2. If the module itself is new, also `INSERT INTO public.modules` with the matching `module_types` FK.
3. Re-run `npm run db:setup:dev` so the seed re-applies (migration-free: db push --force-reset + re-seed).
4. Reference the new key from the controller: `@RequirePermissions(['INVOICE_CREATION'], 'INVOICE_ADMINISTRATION')`.

**`PermissionsGuard` is wired per-route** (via `@UseGuards(PermissionsGuard)`), not globally. Route-level opt-in keeps purely-authenticated endpoints (e.g. `/me`) cheap. There is no
`@SkipPermissions()` decorator in the blueprint — endpoints that don't need RBAC simply omit the guard.

**Read vs write.** A read endpoint uses `@RequireAccess({ module, subModule? })` (same file): it requires the module and, when given, the sub-module (the section a role can see), and no action
permission — a read-only role granted the section can read. A write keeps `@RequirePermissions`. `FULL_ACCESS` (`'$_FULL_ACCESS'`) is the permission that satisfies any requirement of its module.

### Scopes (RBAC v2)

A user holds **role assignments**, not roles: `UserRoleAssignment` (`prisma/schema/users.prisma`) links a user to a `Role` whose `scope` is `PLATFORM`, `ACCOUNT` or `ENTITY`, with the matching
`accountId` / `entityId`. A database trigger (`check_role_assignment_scope.sql`) rejects an assignment whose ids do not match its scope. The authenticated user carries them as
`request.user.roleAssignments` (`src/common/types/authenticated-request.type.ts`).

`PermissionsGuard` only counts the assignments that apply to the account or entity the request acts on. **A route that takes an account or entity id declares it with `@ScopeFrom`**
(`src/common/decorators/require-permissions.decorator.ts`):

```ts
@Patch(':id/status')
@RequirePermissions(['ACCOUNT_UPDATE'], 'ACCOUNT_ADMINISTRATION')
@ScopeFrom('id', 'ACCOUNT') // `:id` is an account id; use 'ENTITY' when it is an entity id
@UseGuards(PermissionsGuard)
```

What counts for each target (`filterAssignmentsForTarget`, `src/common/services/account-access/scope-filter.ts` — the guard and the services share it):

| Target                                                           | Assignments that count                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account A: `@ScopeFrom('id', 'ACCOUNT')` or a `:accountId` param | `PLATFORM`; `ACCOUNT` assignments on A. `ENTITY` assignments on an entity of A count only with `@ScopeFrom('id', 'ACCOUNT', { includeEntityAssignments: true })`. An `ACCOUNT` role held on another account never counts. |
| Entity E: `@ScopeFrom('id', 'ENTITY')` or an `:entityId` param   | `PLATFORM`; `ACCOUNT` assignments on E's account; `ENTITY` assignments on E or one of its ancestors — never a descendant, a sibling or another account.                                                                   |

Turn `includeEntityAssignments` on only for the routes an entity administrator legitimately reaches (reading the account, allocating roles in its entity), and let the service narrow the action to that
entity's subtree. Resolution order: the declared `@ScopeFrom`, then the legacy `:accountId` / `:entityId` params, then the `X-Scope-Account-Id` / `X-Scope-Entity-Id` headers — the headers are read
only when the route declares no scope, so they can never redirect a check away from the account or entity in the URL (the web app does not send them). Routes of the `PLATFORM_ADMINISTRATION` module
count `PLATFORM` assignments only, whatever the target. A URL that names an account or entity that does not exist answers 404 and an account the user does not belong to answers 401 (the membership
answers of `validateUserAccountAccess`, kept); a target the user belongs to but holds no applicable role on answers 403.

**A route with no `@ScopeFrom` and no scope param falls back to the union of every assignment the user holds**, which keeps unscoped endpoints (`/me`, `/auth/*`) working — and is exactly what lets a
role held in one account or entity act on another. Never leave an account or entity id unannotated. When the scope is not in the URL (the account or entity comes from the body, or the route only
carries a role id, as `POST /invitations`, `POST /entities` and `PATCH roles/:roleId` do), **the guard cannot scope it: the service must check the permission in the scope of each target** with
`hasPermissionInScope` / `assertPermissionInScope` below (403 when missing).

The guard answers "may this user call this route in this scope"; **which rows they may see is the service's job**. Do not filter by hand: use `AccountAccessService`
(`src/common/services/account-access/account-access.service.ts`):

| Need                                                 | Method                                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Reject a user with no access to an account           | `validateUserAccountAccess(userId, accountId, methodName)`                                           |
| Reject a user with no access to an entity            | `validateUserEntityAccess(userId, entityId, methodName)`                                             |
| Platform administrator / account administrator check | `isPlatformAdmin(userId)` / `isAccountAdminOn(userId, accountId)`                                    |
| A permission held in one scope                       | `hasPermissionInScope(userId, permission, scope)` / `assertPermissionInScope(...)` (throws 403)      |
| Several checks in one request                        | `getPermissionChecker(userId, entityIds)`, then `checker.has(...)` / `checker.assert(...)` (403)     |
| Platform authority / a section held in one scope     | `checker.hasOnPlatform(permission)` / `checker.hasSubModule(id, scope)` (`{ withSubModules: true }`) |
| Everything a user holds in one scope                 | `getScopedGrants(userId, scope)` — modules, sections and permissions of the assignments that apply   |
| An entity's account and ancestor chain               | `resolveEntityTarget(entityId)` / `resolveEntityTargets(entityIds)` (bulk) / `getAncestorEntityIds`  |
| Entities a user may see in an account                | `resolveVisibleEntityIdsForAccount(userId, accountId)` — `null` means unrestricted                   |
| An entity and everything below it                    | `getSubtreeEntityIds(rootEntityIds)`                                                                 |

`scope` is `{ kind: 'ACCOUNT', accountId, includeEntityAssignments? }` or `{ kind: 'ENTITY', entityId }`, the same rule as the table above. Check a change only when it changes something (compare it
with the stored state), and check **each target on its own** — `PATCH :id/users/:userId` needs `ACCOUNT_USER_MANAGEMENT` at account scope for `isActive`, `USER_ROLE_ALLOCATION` at account scope for
the account roles and `USER_ROLE_ALLOCATION` in that entity's scope for each entity slice. Write only what changed: a slice sent back unchanged is neither checked nor rewritten, so a stale form cannot
restore a role someone has revoked.

Keep the cost flat when a request carries a list of ids. Bound the list in the zod schema (`.max(n)`), deduplicate it, and never call `assertPermissionInScope` once per id: build **one**
`getPermissionChecker(userId, entityIds)` (the user's assignments are read once, the entities resolved in bulk) and ask it as often as needed. When a carried-over id (a resend that inherits the
pending invitation's targets and roles) ends up in the record you create, authorize the merged set exactly as if the caller had submitted it.

A route that writes a role's grants follows `AccountService.assertRoleAuthority`: a system role or a global template needs the permission through a PLATFORM role (`hasOnPlatform`); an account-owned
role needs it wherever the role applies (its account, or every entity an ENTITY role is assigned in); each permission or section the request adds must be held there too (nobody grants what they do not
hold); and a `PLATFORM_ADMINISTRATION` section never goes on an ACCOUNT or ENTITY role.

Entities form a tree (`Entity.parentEntityId`, `prisma/schema/organizations.prisma`): an entity administrator sees the subtree under their entity, never its siblings. Pass the ids these methods return
into the Prisma `where` (`{ id: { in: visibleIds } }`) — see `AccountService` for the pattern.

The scope the web app starts in is elected by the server (`AuthService`: platform, then account, then entity) and returned as `currentScope` on `GET /me` (`src/shared-types/auth.ts`).

## Administration surfaces (anchor)

The blueprint ships the administration screens a SaaS needs; extend them rather than adding parallel ones. They live in `src/modules/accounts/controllers/account.controller.ts`:

| Surface                           | Routes (`/accounts/...`)                                                                                     | Gate (module `PLATFORM_ADMINISTRATION` or `ACCOUNT_ADMINISTRATION`)                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Platform administration           | `GET platform/{overview,users,modules,reactivation-requests}`, `PATCH platform/modules/...`                  | `@RequireAccess` per sub-module (`PLATFORM_ACCOUNTS`, `PLATFORM_USERS`, …); writes `MODULE_MANAGEMENT`       |
| Account overview, users, entities | `GET :id`, `GET :id/users`, `GET :id/entities`; `PATCH :id/users`, `PATCH :id/users/:userId`                 | `@RequireAccess` (`OVERVIEW`, `USERS`, `ENTITIES`); writes `ACCOUNT_USER_MANAGEMENT`, `USER_ROLE_ALLOCATION` |
| Roles                             | `GET :id/roles`, `GET system/roles`, `POST :id/roles`, `POST platform/roles`, `PATCH`/`DELETE roles/:roleId` | `@RequireAccess` (`ROLES`); writes `ROLE_CUSTOM_MANAGEMENT`                                                  |
| Account status and reactivation   | `PATCH :id/status`, `POST :id/reactivation-requests`, `GET :id/reactivation-requests/latest`                 | `ACCOUNT_UPDATE`                                                                                             |
| Reactivation review               | `POST platform/reactivation-requests/:requestId/{approve,reject}`                                            | `ACCOUNT_REACTIVATION_REVIEW`                                                                                |

The matching pages are `src/pages/private/account/` (one tabbed `account-management.tsx`, selected by `?tab=`) and `src/pages/private/platform/platform-modules.tsx`. A new administration screen is a
new tab there, gated with the same module / sub-module as its endpoint.

## Validation (anchor)

- Schemas live in `src/shared-validation/<domain>.ts`.
- Each schema is a **factory function** named `buildXxxSchema(messages?)` so the frontend can override the error strings with i18n while the API uses the defaults — see `src/shared-validation/auth.ts`
  for the canonical reference.
- `createZodDto(buildXxxSchema())` produces the NestJS DTO consumed by `@Body()` / `@Query()`.
- Use `.strict()` on object schemas — unknown keys are rejected with a 400 instead of silently dropped.

On monorepo, `src/shared-validation/` is a **vendored mirror** of `packages/shared-validation/src/`. **Edit both copies (and the canonical workspace) in lockstep** — see `topology.md`.

## Prisma (anchor)

Multi-file schemas live under `prisma/schema/`:

```
prisma/schema/
├── schema.prisma          # root include file (datasource, generator)
├── accounts.prisma
├── invitations.prisma
├── modules.prisma         # RBAC tables (modules, module_permissions, ...)
├── organizations.prisma
└── users.prisma
```

Every model carries `createdAt` (`@default(now())`) and `updatedAt` (`@updatedAt`) — both `@map("…")` to snake_case columns:

```prisma
model Organization {
  id        String   @id @default(cuid())
  name      String   @db.VarChar(100)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt      @map("updated_at")
  @@map("organizations")
}
```

After editing the schema or adding a new model:

```bash
npx prisma db push             # sync the schema into the dev DB (migration-free) + regenerate the client
```

If the model needs default rows, extend `prisma/sql/datasets/default_user_modules_roles.sql` (or add a new dataset file under `prisma/sql/datasets/` and reference it from the seed runner).

## Tests (anchor)

Each module ships **unit + e2e** tests. The unit suite mocks Prisma; the e2e suite hits a tmpfs PostgreSQL.

**Unit** (`tests/unit/<name>.service.spec.ts`) — extend `ServiceTestBase`, declare provider mocks, and per-method `prismaServiceAny.<model> = { create: jest.fn(), … }` in `customSetup()`:

```ts
class OrganizationServiceTest extends ServiceTestBase<OrganizationService> {
  protected getServiceClass() {
    return OrganizationService
  }
  protected getProviders(): Provider[] {
    return [
      { provide: PrismaService, useValue: mockPrismaService },
      { provide: Logger, useValue: mockLogger }
    ]
  }
  protected async customSetup(): Promise<void> {
    const p = mockPrismaService as any
    p.organization = { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() }
  }
}
```

**E2E** (`tests/e2e/<name>.e2e-spec.ts`) — `Test.createTestingModule()` + `supertest`:

```ts
const moduleRef = await Test.createTestingModule({
  imports: [OrganizationsModule, AuthModule, LoggerModule, EnvModule, PrismaModule, AccountAccessModule]
}).compile()
app = moduleRef.createNestApplication()
app.setGlobalPrefix(process.env.API_PREFIX ?? '/api')
app.use(cookieParser())
const agent = request.agent(app.getHttpServer())
await loginTestUser(agent, testUser.email, 'TestPassword123')
```

The test database is set up by `src/configs/test/e2e-environment.ts` (Jest `globalSetup`) which spins up `docker-compose.db-test.yml` (tmpfs-backed PostgreSQL) and runs the migrations + the seed
loader. Cleanup is done by `e2e-teardown.ts`.

Run tests:

```bash
npm run test:unit               # Jest, mocks only
npm run test:e2e                # Jest + supertest + tmpfs DB
npm run test:full               # format + lint + type-check + unit + e2e
```

## Path aliases (anchor)

Confirmed in `tsconfig.json`:

| Alias                  | Resolves to                |
| ---------------------- | -------------------------- |
| `@modules/*`           | `src/modules/*`            |
| `@common/*`            | `src/common/*`             |
| `@configs/*`           | `src/configs/*`            |
| `@shared-types/*`      | `src/shared-types/*`       |
| `@shared-validation/*` | `src/shared-validation/* ` |
| `@/*`                  | `src/*`                    |

Always import with the most specific alias. Avoid relative paths that cross `src/modules/<a>/` → `src/modules/<b>/`; route through the alias.

## Worked example — add an `Invoice` module

Goal: introduce a new `Invoice` aggregate with `create` and `fetch` endpoints, RBAC-gated under a new `INVOICE_ADMINISTRATION` module key.

1. **Schema** — add `prisma/schema/invoices.prisma`:

   ```prisma
   model Invoice {
     id          String   @id @default(cuid())
     accountId   String   @map("account_id")
     amountCents Int      @map("amount_cents")
     status      String   @db.VarChar(20)
     createdAt   DateTime @default(now()) @map("created_at")
     updatedAt   DateTime @updatedAt      @map("updated_at")

     account Account @relation(fields: [accountId], references: [id])
     @@map("invoices")
   }
   ```

2. **Apply** — `npx prisma db push` syncs the schema and regenerates `@prisma/client`.

3. **Validation** — `src/shared-validation/invoice.ts` (factory schema). Mirror `organization.ts`:

   ```ts
   export const buildCreateInvoicePayloadSchema = (messages: CreateInvoicePayloadMessages = {}) =>
     z
       .object({
         accountId: z.string().min(1),
         amountCents: z.number().int().positive(),
         status: z.enum(INVOICE_STATUS_VALUES)
       })
       .strict()
   ```

   On **monorepo**, also mirror this file into `packages/shared-validation/src/invoice.ts` and re-export from `packages/shared-validation/src/index.ts` (see `topology.md`).

4. **Type** — `src/shared-types/invoice.ts`:

   ```ts
   export interface Invoice {
     id: string
     accountId: string
     amountCents: number
     status: InvoiceStatus
     createdAt: string
     updatedAt: string
   }
   ```

   Re-export from `src/shared-types/index.ts`. On monorepo, mirror to `packages/shared-types/src/invoice.ts` and update its `index.ts`.

5. **DTOs** — `src/modules/invoices/dto/`:

   ```ts
   // requests/create-invoice.dto.ts
   export class CreateInvoiceDto extends createZodDto(buildCreateInvoicePayloadSchema()) {}

   // responses/fetch_invoice.response.dto.ts
   export class FetchInvoiceResponseDto implements Invoice {
     /* @ApiProperty fields */
   }
   ```

6. **Service** — `src/modules/invoices/services/invoice.service.ts` (constructor injects `PrismaService` + `Logger`, throws `NotFoundException` on 404, returns DTOs).

7. **Controller** — `src/modules/invoices/controllers/invoice.controller.ts`:

   ```ts
   @ApiTags('Invoices')
   @Controller('invoices')
   @UseGuards(JwtAuthGuard)
   export class InvoiceController {
     @Post()
     @RequirePermissions(['INVOICE_CREATION'], 'INVOICE_ADMINISTRATION')
     @UseGuards(PermissionsGuard)
     async createInvoice(@Req() req: AuthenticatedRequest, @Body() dto: CreateInvoiceDto): Promise<FetchInvoiceResponseDto> {
       return this.invoiceService.createInvoice(req.user.id, dto)
     }
   }
   ```

8. **Module** — `src/modules/invoices/invoices.module.ts` declares the controller + service. Register in `src/app.module.ts`.

9. **RBAC seed** — `prisma/sql/datasets/default_user_modules_roles.sql`: add an `INSERT` for the new module (`INVOICE_ADMINISTRATION`) and its permissions (`INVOICE_CREATION`, …). Re-run
   `npm run db:setup:dev`.

10. **Tests** — `tests/unit/invoice.service.spec.ts` (mocked Prisma) + `tests/e2e/invoice.e2e-spec.ts` (supertest, login a user with `INVOICE_CREATION` permission). Run `npm run test:full`.

11. **Monorepo only** — regenerate the typed API client so the web app picks up the new endpoint:

    ```bash
    npm run codegen
    ```

    The frontend will then import `useCreateInvoice` from `@<project>/api-client/generated/api/invoices/invoices`.

That's the full path — every step mirrors a real file in the canonical `organizations/` module. **Do not invent an alternative layout** — drift breaks tooling (codegen, drift-guards, OpenAPI tag
routing).
