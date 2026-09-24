# What SaaSFoundry gives you

SaaSFoundry is two systems delivered through one project:

1. a **prebuilt SaaS foundation** with authentication, tenant-aware RBAC, a typed API, a React application and production runtime;
2. a **development harness** that connects coding agents to your specifications, ticket board, repository rules and validation workflow.

You can generate either system independently or combine them. Optional capabilities remain explicit: an inventory is useful only if it distinguishes what is always present from what you chose to
install.

```text
full    = SaaS foundation + development harness
stack   = SaaS foundation only
harness = development harness added to an existing codebase
```

[Compare the three setup paths](/getting-started/setup-paths) or inspect the [generated topologies](/guide/monorepo-vs-multirepo).

## At a glance

| Capability                                    |    `full`     |    `stack`    |   `harness`   | Optional |
| --------------------------------------------- | :-----------: | :-----------: | :-----------: | :------: |
| Authentication, tenant model and scoped RBAC  |       ✓       |       ✓       |       —       |    —     |
| NestJS API, PostgreSQL and Prisma             |       ✓       |       ✓       |       —       |    —     |
| React application and bilingual UI foundation |       ✓       |       ✓       |       —       |    —     |
| Workflow, core skills and integration rules   |       ✓       |       —       |       ✓       |    —     |
| Manifest and update lifecycle                 |       ✓       |       ✓       |       ✓       |    —     |
| MailerSend, S3, Analytics and PWA             | When selected | When selected |       —       |    ✓     |
| SRS centralization and external tool skills   | When selected |       —       | When selected |    ✓     |

The exact selection is recorded in `.saasfoundry.json`, so the CLI and coding agents read the same project contract.

```json
{
  "profile": "full",
  "structure": "monorepo",
  "modules": {
    "harness": { "version": "1.0.0-beta" },
    "email": { "version": "1.0.0-beta" }
  }
}
```

Learn how that contract evolves in [Updating projects](/guide/updating-projects).

## SaaS foundation

### Authentication and session lifecycle

The generated API includes signup, signin, signout, current-user, account confirmation and password-reset flows. NestJS Passport strategies validate short-lived access tokens and refresh tokens; the
browser receives both through `httpOnly` cookies instead of exposing tokens to application JavaScript.

```ts
async signIn(dto: SignInDto, response: Response) {
  const { accessToken, refreshToken, userId } = await authService.signIn(dto)
  authService.setAuthCookies(response, accessToken, refreshToken)
  return { userId }
}
```

Passwords are hashed with bcrypt, authenticated routes use `JwtAuthGuard`, and refresh-token state can be invalidated on signout. The web application includes the corresponding signin, signup,
confirmation and reset screens.

Continue with [RBAC and tenancy](/features/rbac) to see how identity becomes authorization.

### Tenant, account and entity model

The data model represents a platform, customer accounts, organizations and nested entities instead of leaving multi-tenancy as an exercise for the first product team. Account status, membership,
invitations and reactivation requests are part of the generated lifecycle.

```text
Platform
 └─ Account
     ├─ Users and role assignments
     ├─ Organization profile
     └─ Entities (including parent/child hierarchy)
```

The generated UI includes platform administration, account settings, users, roles, entities, invitations, profile and reactivation views. Read [RBAC and tenancy](/features/rbac) for the enforcement
model.

### Scoped RBAC

Authorization is evaluated at `PLATFORM`, `ACCOUNT` or `ENTITY` scope. Roles combine modules, visible sub-modules and action permissions, while database constraints reject incoherent assignments.

```ts
@RequireAccess({
  module: 'ACCOUNT_ADMINISTRATION',
  subModule: 'USERS'
})
findUsers() {}

@RequirePermissions(['ACCOUNT_USER_MANAGEMENT'], 'ACCOUNT_ADMINISTRATION')
updateUser() {}
```

The frontend hides unavailable routes and actions for clarity, but the NestJS guard remains authoritative. See the complete [RBAC and tenancy guide](/features/rbac).

### Invitations and account reactivation

Account administrators can invite users into a scoped role; invitees accept a signed, expiring token. Deactivated customers can submit reactivation requests for platform review instead of requiring an
improvised support-only flow.

```text
invite created → token issued → user accepts → scoped role assigned
account inactive → reactivation requested → platform review → account active
```

With the email provider disabled, rendered messages remain visible in development logs. Installing [Email](/modules/email) sends the same flows through MailerSend.

### Internationalization

The React application is wired with i18next, browser language detection and YAML resources. English and French namespaces are seeded for authentication, navigation, account administration, dashboard,
platform, profile and error pages.

```yaml
# apps/web/src/locales/fr/auth.yml
signIn:
  title: Connexion
  submit: Se connecter
```

New domains extend the same namespace in both locale directories. Locale-aware preferences are persisted on the user model.

### PostgreSQL and Prisma

The API uses Prisma 7 with the PostgreSQL driver adapter and a multi-file schema split by domain. SQL functions, triggers and seed data protect role-scope invariants and install the initial modules
and system roles.

```ts
export class PrismaService extends PrismaClient {
  constructor(env: EnvConfig) {
    super({
      adapter: new PrismaPg({ connectionString: env.get('DATABASE_URL') })
    })
  }
}
```

```text
prisma/schema/
├── schema.prisma
├── accounts.prisma
├── invitations.prisma
├── modules.prisma
├── organizations.prisma
└── users.prisma
```

The local development and test configurations use PostgreSQL too, reducing the gap between tests and production.

### Typed API contract

NestJS 11 controllers describe operations with Swagger decorators. Request contracts use Zod 4 through `nestjs-zod`; startup generates a cleaned OpenAPI document at `docs/openapi.json`.

```ts
export const createEntitySchema = z.object({
  name: z.string().trim().min(1),
  parentId: z.string().uuid().optional()
})

export class CreateEntityDto extends createZodDto(createEntitySchema) {}
```

In a monorepo, Orval turns that document into the shared `api-client`, including React Query hooks. Shared validation, types and configuration packages keep both applications on the same contract.

```text
Zod schema → NestJS DTO → OpenAPI → generated API client → React Query
```

See [Project structure](/guide/project-structure) and [Monorepo vs multirepo](/guide/monorepo-vs-multirepo).

### React application

The generated frontend uses React 19, React Router 7, Vite, Tailwind CSS 4, Radix primitives, ShadCN-style components, TanStack React Query and React Hook Form. Public and protected routes,
query/error providers, layouts, navigation and responsive primitives are already connected.

```tsx
const router = createBrowserRouter([...publicRoutes, ...privateRoutes])

root.render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>
)
```

In monorepo mode, reusable UI primitives live in `packages/ui-primitives`; multirepo projects vendor the same primitives into the web repository.

### Developer experience and quality gates

Each generated application includes TypeScript, flat ESLint configuration, Prettier, Jest or Vitest, API E2E tests and Playwright browser tests. Husky hooks validate commit messages, quick pre-commit
checks and the heavier pre-push gate.

```text
.husky/
├── prepare-commit-msg
├── commit-msg
├── pre-commit
└── pre-push
```

Docker starts the development database, and dedicated test Compose configuration isolates API database tests. Generated GitHub Actions are topology-aware and can limit jobs to the surfaces changed by
a pull request.

The [development tools guide](/getting-started/tools) explains the local loop.

### Production runtime

The API and web projects include multi-stage Dockerfiles. Nginx serves the compiled SPA and proxies API traffic, while health checks, environment validation and Winston rotating logs make failures
observable.

```dockerfile
FROM node:22-alpine AS builder
RUN npm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
HEALTHCHECK CMD wget --quiet --tries=1 --spider http://localhost:80/ || exit 1
```

The CLI validates the generated manifest before lifecycle operations. Numbered manifest migrations and ordered module migrations upgrade owned configuration without silently overwriting user-owned
code.

Read [Updating projects](/guide/updating-projects) for preview, three-way comparison, conflicts and recovery.

## Development harness

### One project contract

`.saasfoundry.json` records topology, ports, branches, tools, modules, agent profiles and managed-file baselines. CLI commands and generated skills consume it instead of duplicating project facts in
prompts.

```bash
sf status --claude-friendly --no-network
```

That command gives a coding agent a deterministic, offline summary before it changes the project. See [Project structure](/guide/project-structure).

### Complexity-adaptive delivery workflow

The harness ships two guarded presets. The team workflow separates functional feature testing from code review; the Solo workflow combines its human gate with PR review. Interactive setup can also
define and save a custom status sequence.

```text
Backlog → Ready → In progress → AI testing
        → Human testing → In review → Done
```

```text
Solo: Backlog → In progress → AI testing → In review → Done
```

In the team preset, **Human testing means feature testing** and **In review means code review**. Complexity changes the depth of analysis, planning, testing and review inside the configured phases.

```text
bug      direct fix + regression proof
low      lightweight implementation
medium   structured analysis and approved plan
complex  deep analysis and adversarial review
```

Transitions are executed through the configured board adapter. GitHub Projects provides the complete v1 contract; Jira and Linear adapters are experimental. Notion is the complete v1 SRS backend, not
a full workflow tracker. Start with [Workflow system](/guide/workflow-system).

### Skills and integration grammar

Core `sf-*` skills teach agents how to inspect project state, respect ticket gates, wire backend and frontend layers, and use the selected board tool. They are project instructions, not a separate
application hidden outside the repository.

```text
.agents/skills/
├── sf-workflow/
├── sf-integration-rules/
├── sf-tool-github-projects/
└── sf-srs/                 # when selected
```

The integration rules cover Prisma model → NestJS service/controller → shared contract → React Query hook → route/form → RBAC permission, preventing a feature from being implemented in only one layer.

Read [Skills system](/guide/skills-system) and [Connect your tools](/features/your-tools).

### Specification-to-delivery traceability

When the SRS capability is selected, requirements stay in the configured source of truth and are reconciled with native board tickets. The harness proposes conversational additions, waits for explicit
approval, and preserves the Epic/FR/DS/TC relationship.

```text
requirement → approved SRS update → reconciled ticket
            → guarded implementation → test evidence → PR
```

V1 ships the Notion backend; other backends are adapter targets, not advertised as implemented. See [One SRS source of truth](/srs/centralization) and the [SRS module](/modules/srs).

## Optional capabilities

Optional means **supported and installable**, not enabled in every scaffold. Select them during `sf new` or add compatible modules later with `sf update`.

### Transactional email

The [Email module](/modules/email) activates MailerSend for account confirmation, password reset and invitations. Without it, the same templates and flows remain locally testable through development
logging.

```bash
sf update --add-modules email \
  --mailersend-api-key "$MAILERSEND_KEY" \
  --mailersend-sender-email noreply@example.com
```

### S3-compatible storage

The [Storage module](/modules/storage) adds uploads, pre-signed URLs, organization logo handling and either a local MinIO service or existing S3-compatible credentials.

```bash
sf update --add-modules storage --s3-setup docker
```

### Analytics and installability

[Analytics](/modules/analytics) adds production-only, privacy-friendly Umami loading. [PWA](/modules/pwa) adds the web manifest, branded icons and service-worker integration required for an
installable application.

```bash
sf update --add-modules analytics,pwa
```

### External tools

Optional tool skills connect the harness to services such as Notion, Jira/Confluence, Figma or live library documentation. A declared integration still depends on credentials and host capabilities;
SaaSFoundry reports unsupported combinations instead of pretending every connector is universally available.

```bash
sf modules list
sf modules info storage
sf update --dry-run
```

See [Connect your tools](/features/your-tools) for the support matrix and failure-safe behavior.

## What to read next

- [Create your first project](/getting-started/first-project)
- [Understand the two generated topologies](/guide/monorepo-vs-multirepo)
- [Explore RBAC and tenancy](/features/rbac)
- [Ship your first ticket](/getting-started/shipping-first-ticket)
- [Update without losing your changes](/guide/updating-projects)
