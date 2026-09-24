# Your SaaS foundation in about 60 seconds

Start with a production-shaped monorepo instead of spending your first sprint connecting authentication, tenants, permissions, an API, a frontend and delivery tooling.

SaaSFoundry generates the foundation and records every choice in one project contract. You keep the code: extend it, replace parts of it and deploy it on your infrastructure.

::: tip What “60 seconds” means

In roughly one minute, you can choose the shape of the product and start generation. The CLI then installs dependencies and initializes the project; that final wait varies with your machine and
network.

:::

## Before you start

You need Node.js 24.19.0 or newer, npm 11, Git and Docker for the recommended local PostgreSQL setup. The [installation guide](/getting-started/installation) covers existing repositories, global
installation and supported agent profiles.

## 1. Run the creator

No global installation is required:

```bash
npx saasfoundryai-cli@beta new
```

Prefer an AI-guided conversation? The [CLI or assistant setup guide](/getting-started/setup-paths) explains both routes. They use the same configuration engine and produce the same managed contract.

## 2. Choose the shape

For a new product, choose these defaults in the interactive flow:

```text
Profile          Full — SaaS foundation + development harness
Structure        Monorepo (recommended)
Repository       Local
Database         PostgreSQL with Docker
Email            None for now
Storage          Manual for now
Analytics        No
```

`full` gives you both pillars of SaaSFoundry. Choose `stack` if you only want the technical foundation, or `harness` to add the delivery system to code you already keep.

::: info Optional means optional

MailerSend email, S3 storage, Analytics, PWA, SRS centralization and external tool skills are selected capabilities. You can add compatible modules later with `sf update`; they are not silently
enabled in every project.

:::

## 3. Start the project

Enter the generated directory, start its local services, initialize the database and launch both applications:

```bash
cd my-saas
npm run services:up
npm run db:setup:dev
npm run dev
```

Open the two local surfaces:

- Web application: [http://localhost:5173](http://localhost:5173)
- API and generated documentation: [http://localhost:3500/api/docs](http://localhost:3500/api/docs)

The CLI selects the first available ports when the defaults are already occupied. Its completion summary and `.saasfoundry.json` remain authoritative.

## What you just got

Your new repository is already wired across the browser, API and database:

1. **Authentication and sessions** — signup, signin, signout, confirmation and password reset with JWT, Passport, refresh tokens and `httpOnly` cookies.
2. **A real tenant model** — platform, customer accounts, organizations and nested entities rather than a single-user demo schema.
3. **Scoped RBAC** — platform, account and entity roles with modules, visible sections and action permissions. [Explore RBAC](/features/rbac).
4. **Account operations** — members, invitations, custom roles, deactivation and reactivation flows already represented in the API and UI.
5. **A typed API chain** — NestJS and Zod contracts generate OpenAPI and, in monorepo mode, a reusable API client with React Query hooks.
6. **A modern React application** — React Router, Tailwind CSS, Radix/ShadCN-style primitives, React Query and React Hook Form already connected.
7. **English and French UI resources** — i18next and YAML namespaces seeded for the generated product surfaces.
8. **PostgreSQL from development to production** — Prisma with the PostgreSQL driver adapter, domain schemas, constraints, triggers and seed data.
9. **Quality and production defaults** — ESLint, Prettier, unit/E2E/browser tests, Git hooks, multi-stage Docker images, Nginx, health checks and structured logs.
10. **An AI delivery harness** — the `full` profile adds the manifest, project skills, integration grammar and guarded workflow that connects agents to your board and repository rules.

See the [complete capability inventory](/features/built-in) for code excerpts, optional modules and links to every deeper guide.

## Your next step

::: info Build and inspect the first real flow

Continue with [Your first SaaS project](/getting-started/first-project). It walks through the generated structure, local services, account creation, API documentation and your first cross-stack
feature.

:::

If you want the mental model first, read [Monorepo vs multirepo](/guide/monorepo-vs-multirepo) and [How the workflow operates](/guide/workflow-system).
