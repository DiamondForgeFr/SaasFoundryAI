# {{PROJECT_NAME}}

A production-ready SaaS monorepo — NestJS API, React web app, PostgreSQL, all wired together and running.

Generated with [SaaSFoundryAI](https://github.com/DiamondForgeFr/SaasFoundryAI).

## Start it

```bash
npm install
npm run services:up      # PostgreSQL (and MinIO, if this project uses storage)
npm run db:setup:dev     # schema, SQL functions, triggers, seed data
npm run dev              # API and web, together, via Turborepo
```

The ports this project runs on are recorded in `.saasfoundry.json` under `ports` — they are chosen at generation time and are not always the defaults, because a machine already running another project takes the obvious ones.

If any of the steps above was left unfinished when the project was created, **`sf resume`** completes it. It is safe to run on a healthy project, and it will never reset a database that already holds data.

## Where things are

```
{{PROJECT_NAME}}/
├── apps/
│   ├── api/            NestJS backend — modules, Prisma schema, e2e tests
│   └── web/            React 19 + Vite frontend — pages, hooks, i18n
├── packages/           Shared workspaces consumed by both apps
│   ├── shared-types/       TypeScript types
│   ├── shared-validation/  Zod schemas
│   ├── shared-config/      runtime constants
│   ├── api-client/         generated API client
│   └── ui-primitives/      shared UI
├── .claude/            AI harness — skills and conventions the agent follows
└── .saasfoundry.json   what this project is: modules, workflow, ports, language
```

Each app carries its own `README.md` with the detail that belongs to it, and its own `CLAUDE.md` describing it to an AI agent.

## Everyday commands

| | |
|---|---|
| `npm run dev` | API and web together |
| `npm run dev:api` · `npm run dev:web` | one at a time |
| `npm run build` | build everything through Turborepo |
| `npm run test:unit` · `npm run test:e2e` | the test suites |
| `npm run lint` · `npm run format` · `npm run type-check` | quality gates |
| `npm run services:up` · `services:down` · `services:reset` | Docker dev services |
| `npm run db:setup:dev` | **destructive** — rebuilds the dev schema from scratch |

## Reading further

- **`apps/api/docs/index.html`** — the API reference, offline; it works whether or not the API is running
- **`/api/docs`** on the running API — the same reference, live, with a request runner
- **`.claude/docs/`** — how the harness works: exit codes, manifest schema, labels
- **`sf docs`** — the full SaaSFoundryAI documentation, offline

## Conventions

Commits follow `<type>(#<ticket>): <description>` and are checked by commitlint; Husky runs the quality gates before each commit and push. The branch names, statuses and target branches this project uses all live in `.saasfoundry.json` — read them there rather than assuming.
