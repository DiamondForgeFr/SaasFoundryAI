# Monorepo or multirepo

SaaSFoundryAI generates the same NestJS API and React web application in two repository topologies. The product capabilities stay equivalent; ownership, shared code, CI, and release boundaries change.

**Choose monorepo by default.** Choose multirepo when API and web genuinely need separate owners, permissions, or release schedules.

## Decision table

| Concern              | Monorepo                                                                | Multirepo                                                                           |
| -------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Repository ownership | One repository for API, web, packages, and harness.                     | Independent API and web checkouts under a root coordinator.                         |
| Team shape           | One product or full-stack team.                                         | Separate frontend/backend teams or access boundaries.                               |
| Release cadence      | One PR can change API and web atomically.                               | Each app versions, reviews, and deploys independently.                              |
| CI                   | One Turbo task graph with workspace-aware caching and ordering.         | Each app owns its scripts, lockfile, hooks, and CI.                                 |
| Shared contracts     | Canonical workspace packages plus generated-app mirrors where required. | Byte-identical type and validation copies in each app; no shared workspace package. |
| API client           | OpenAPI snapshot → Orval-generated React Query client.                  | Hand-written web hooks against the API contract.                                    |
| UI primitives        | Shared `ui-primitives` workspace package.                               | Components vendored into the web app.                                               |
| Operational cost     | Simpler cross-stack changes; broader checkout and CI scope.             | Stronger autonomy; more coordination to keep contracts aligned.                     |

Topology is not a quality level. Multirepo is not “more scalable,” and monorepo is not “only for small projects.” Pick the boundary that matches how the team actually owns and releases the two
applications.

## Monorepo — one coordinated product workspace

```text
my-saas/
├── apps/
│   ├── api/                         NestJS
│   └── web/                         React
├── packages/
│   ├── shared-types/
│   ├── shared-validation/
│   ├── shared-config/
│   ├── api-client/
│   └── ui-primitives/
├── .saasfoundry.json
├── package.json                     npm workspaces
└── turbo.json                       task graph
```

The root `package.json` declares `apps/*` and `packages/*` as npm workspaces. Turbo schedules `build`, `lint`, `type-check`, unit, end-to-end, and code-generation tasks across them. A task can depend
on the builds of its workspace dependencies through `dependsOn: ["^build"]`.

This provides two practical guarantees:

- a single lockfile and root command describe the whole product;
- a change to an API contract, generated client, and consuming page can land in one atomic PR.

### The five workspace packages

| Package             | Purpose                                                                           | Editing rule                                                                     |
| ------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `shared-types`      | Domain interfaces shared by API and web.                                          | Canonical under `packages/shared-types/src/`; keep the app mirrors aligned.      |
| `shared-validation` | Zod schema factories and inferred payload types.                                  | Canonical under `packages/shared-validation/src/`; keep the app mirrors aligned. |
| `shared-config`     | Runtime constants that both applications consume.                                 | Import the workspace package directly; modules may deposit files here.           |
| `api-client`        | Orval-generated models and React Query functions from the API's OpenAPI snapshot. | Regenerate; never hand-edit generated files.                                     |
| `ui-primitives`     | Shared shadcn primitives, utilities, and theme tokens.                            | Put reusable primitives here; keep product-specific compositions in the web app. |

The generated package names are scoped to the project, for example `@acme-portal/shared-validation`. The builder replaces the project placeholder before the scaffold is delivered.

### Why types and validation also have app mirrors

The generated applications keep `apps/api/src/shared-*` and `apps/web/src/shared-*` mirrors even in the monorepo. The stable `@shared-types/*` and `@shared-validation/*` aliases therefore work in both
topologies, and either app can build independently.

The canonical authoring source remains `packages/<name>/src/`. Integration tests enforce byte identity between it and both application mirrors. When adding a domain contract:

1. edit the canonical package file;
2. copy the same change to API and web mirrors;
3. export the new file from all three `index.ts` files;
4. run the tests so the drift guard proves parity.

This is controlled duplication, not three independent definitions.

### Generated API client

The API publishes `apps/api/docs/openapi.json` when it boots. Orval reads that snapshot and regenerates `packages/api-client/src/generated/api/`:

```bash
npm run dev:api     # refresh the OpenAPI snapshot
npm run codegen     # regenerate models and React Query functions
```

Commit the OpenAPI snapshot and generated client together. The drift-check script regenerates from the snapshot and fails when the committed client differs.

Code generation must run after a new route, method, DTO field, request/response schema, or API tag. A service-body refactor that does not change the HTTP surface does not require it.

## Multirepo — two independently owned applications

```text
my-saas/                              root coordinator
├── .saasfoundry.json                canonical scaffold manifest
└── apps/
    ├── my-saas-api/                 independent Git checkout
    │   ├── .saasfoundry.json        API projection
    │   ├── package.json
    │   └── src/
    └── my-saas-web/                 independent Git checkout
        ├── .saasfoundry.json        web projection
        ├── package.json
        └── src/
```

Each child manifest has `structure: "cli"` and a `projection` pointing back to the root project and app kind. This lets `sf status` and agent lifecycle commands work inside either checkout, while
stack-wide profile transitions remain owned by the root coordinator.

There is no root `packages/` workspace in the generated multirepo topology. Each application must build and test without the other checkout.

### How shared concerns map

| Monorepo concern              | Multirepo equivalent                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `packages/shared-types/`      | Matching files under `api/src/shared-types/` and `web/src/shared-types/`.                                         |
| `packages/shared-validation/` | Matching files under `api/src/shared-validation/` and `web/src/shared-validation/`.                               |
| `packages/shared-config/`     | Constants live in the owning consumer; there is no cross-repo package.                                            |
| `packages/api-client/`        | Web hooks are implemented under `web/src/hooks/api/<feature>/`.                                                   |
| `packages/ui-primitives/`     | Reusable components are vendored under `web/src/components/ui/shadcn/`; theme tokens live in `web/src/index.css`. |

The type and validation copies are intentionally byte-identical. SaaSFoundryAI tests compare the generated blueprints, but a day-to-day multirepo change still requires coordinated edits and compatible
releases across the two repositories.

## Concrete contract example — create an invitation

Both topologies start from the same Zod schema factory:

```ts
import { z } from 'zod'

export const buildCreateInvitationPayloadSchema = () =>
  z
    .object({
      email: z
        .string()
        .min(1)
        .max(100)
        .email()
        .transform((value) => value.toLowerCase()),
      roleIds: z.array(z.number()).optional(),
      accountIds: z.array(z.string()).optional(),
      entityIds: z.array(z.string()).optional()
    })
    .strict()

export type CreateInvitationPayload = z.infer<ReturnType<typeof buildCreateInvitationPayloadSchema>>
```

The API turns it into a NestJS DTO:

```ts
import { createZodDto } from 'nestjs-zod'
import { buildCreateInvitationPayloadSchema } from '@shared-validation/invitation'

export class CreateInvitationDto extends createZodDto(buildCreateInvitationPayloadSchema()) {}
```

The web mutation parses the form with the same schema before sending it. Email normalization, strict-field rejection, optional scopes, and the inferred payload type therefore agree on both sides.

### Files in a monorepo

```text
packages/shared-validation/src/invitation.ts       canonical
apps/api/src/shared-validation/invitation.ts       mirror
apps/web/src/shared-validation/invitation.ts       mirror
```

The API and web import through the stable alias; the CLI repository tests prove that the three files remain equivalent. The OpenAPI snapshot then drives the generated API client used by the web app.

### Files in a multirepo

```text
apps/my-saas-api/src/shared-validation/invitation.ts
apps/my-saas-web/src/shared-validation/invitation.ts
```

There is no third canonical workspace file and no Orval package. Teams update both copies in the same coordinated change and maintain the web request hook manually. Independent deployment is the
benefit; cross-repository synchronization is the cost.

## Skills and agent instructions

The monorepo installs shared harness skills and agent entrypoints at the root. The multirepo installs them in each application checkout so an agent entering only the API or web repository still
receives the right instructions.

Optional tool skills follow the same ownership rule: one root copy for monorepo, one copy per application for multirepo. Selecting an agent profile records instruction surfaces; it does not install or
authenticate the agent runtime itself.

## Choose during `sf new`

Interactive setup asks for the topology. A scripted setup makes it explicit:

```bash
sf new --non-interactive \
  --profile full \
  --project-name my-saas \
  --structure monorepo \
  --setup-repo local \
  --db-setup docker \
  --db-type postgresql \
  --email-service none \
  --s3-setup manual \
  --no-analytics
```

For multirepo, replace `--structure monorepo` with `--structure multirepo`. When connecting existing remotes, monorepo accepts one URL; multirepo accepts separate backend and frontend URLs.

See [`sf new`](/cli/sf-new) for the complete option matrix and [CLI or assistant setup](/getting-started/setup-paths) for both onboarding paths.

## Topology is preserved after generation

A harness-only managed project has no technical topology yet. `sf update --target-profile full` asks for monorepo or multirepo when it adds the stack; preview the candidate first:

```bash
sf update --target-profile full --dry-run --json
```

Once a technical stack exists, updates preserve its structure. `stack → full` adds the managed harness, while `full → full` is a no-op. `sf update` does not convert monorepo to multirepo or the
reverse.

Changing topology is a deliberate repository migration: split or combine Git history, ownership, CI, secrets, package publishing, deployment, and contract synchronization. Plan and review it as an
architecture change rather than a generator toggle.

## Recommendation

Start with monorepo unless one of these is already true:

- API and web are owned by different teams;
- they release on independent schedules;
- repository access must be different;
- either application must build without access to the other checkout.

If none applies, a monorepo gives you atomic full-stack changes, generated clients, shared UI primitives, and one validation graph with less coordination overhead.
