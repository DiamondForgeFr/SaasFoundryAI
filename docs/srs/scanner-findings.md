# Scanner Findings Reference

`srs-cli.sh draft --from codebase` runs five scanners against your source tree and emits a `ScannerFinding[]` envelope on stdout. This page documents the exact JSON shape of every finding kind —
useful when writing skill prompts, custom wrappers, or a new scanner.

The envelope is :

```jsonc
{
  "source": "codebase",
  "findings": [
    /* ScannerFinding[] — see below */
  ]
}
```

Every finding carries the shared `BaseScannerFinding` fields :

```ts
interface BaseScannerFinding {
  kind: 'endpoint' | 'ui-flow' | 'entity' | 'test' | 'doc-context'
  title: string
  excerpt?: string
  notes?: string
}
```

`kind` is the discriminator — branch on it to pick the right shape. `title` is always a human-readable label the skill can quote back to the user.

## `endpoint` — NestJS controllers

Emitted by `nestjs.scanner.ts`. One finding per `@<Method>(...)` decorator inside a class annotated with `@Controller(...)`.

```ts
interface EndpointFinding extends BaseScannerFinding {
  kind: 'endpoint'
  area: string // nearest `src/modules/<area>/` or filename stem
  file: string // repo-relative path of the controller
  method: string // GET | POST | PUT | PATCH | DELETE | HEAD | OPTIONS
  path: string // joined controller prefix + method path (e.g. "/auth/signin")
  hasTests: boolean // true when a *.spec.ts in the same area has a matching describe
}
```

Example :

```jsonc
{
  "kind": "endpoint",
  "title": "POST /auth/signin",
  "area": "auth",
  "file": "api/src/modules/auth/auth.controller.ts",
  "method": "POST",
  "path": "/auth/signin",
  "hasTests": true
}
```

`hasTests` is a soft signal based on filename + area heuristic — use it to flag coverage gaps, but always cross-reference with `test` findings in the same area before reporting a gap as authoritative.

## `ui-flow` — React pages

Emitted by `react.scanner.ts`. One finding per page file referenced from a `routes.tsx` / `routes.ts` manifest.

```ts
interface UiFlowFinding extends BaseScannerFinding {
  kind: 'ui-flow'
  area: string // two-segment: <visibility>/<PageName> (e.g. "public/SignInPage")
  file: string // repo-relative path of the page component
  route?: string // route path from the router (when discoverable)
  formFields: string[] // <input name="..."> / <Input name="..."> captured from JSX
  linkedEndpointGuess?: string // best-effort match against endpoint paths
}
```

Example :

```jsonc
{
  "kind": "ui-flow",
  "title": "SignInPage (public/SignInPage)",
  "area": "public/SignInPage",
  "file": "web/src/pages/public/SignInPage.tsx",
  "route": "/signin",
  "formFields": ["email", "password"],
  "linkedEndpointGuess": "signin"
}
```

`linkedEndpointGuess` is substring-matched against the endpoint paths — always validate the guess before trusting it. Pages with no matching route leave `route` undefined.

## `entity` — Prisma models

Emitted by `prisma.scanner.ts`. One finding per `model` block, across both multi-file (`prisma/schema/*.prisma`) and single-file (`prisma/schema.prisma`) layouts. Enum blocks are ignored.

```ts
interface EntityField {
  name: string
  type: string // "String", "Int", "User", "Session[]", etc.
  optional?: boolean // trailing "?"
  isId?: boolean // carries the @id attribute
}

interface EntityRelation {
  field: string // the field on THIS model pointing at another
  target: string // the target model name
}

interface EntityFinding extends BaseScannerFinding {
  kind: 'entity'
  area: string // model-name heuristic (User→users, Session→auth, File→storage, …)
  file: string // repo-relative path of the *.prisma file
  model: string // the Prisma model name (preserved case)
  fields: EntityField[]
  relations: EntityRelation[]
}
```

Example :

```jsonc
{
  "kind": "entity",
  "title": "Session",
  "area": "auth",
  "file": "api/prisma/schema/auth.prisma",
  "model": "Session",
  "fields": [
    { "name": "id", "type": "String", "isId": true },
    { "name": "userId", "type": "String" },
    { "name": "user", "type": "User" },
    { "name": "expiresAt", "type": "DateTime" }
  ],
  "relations": [{ "field": "user", "target": "User" }]
}
```

Non-scalar PascalCase field types are treated as relation candidates (so `locale Locale` becomes a `{ field: "locale", target: "Locale" }` relation even if there's no explicit `@relation` attribute).

## `test` — Jest specs

Emitted by `tests.scanner.ts`. One finding per `*.spec.{ts,tsx}` or `*.e2e.ts` file that contains at least one `describe` + `it/test` pair.

```ts
interface TestFinding extends BaseScannerFinding {
  kind: 'test'
  area: string // `src/modules/<area>/` or `src/pages/<area>/<page>` or filename stem
  file: string // repo-relative path of the spec
  describe: string // first describe title in the file
  cases: string[] // every it() / test() title, in source order
}
```

Example :

```jsonc
{
  "kind": "test",
  "title": "AuthService",
  "area": "auth",
  "file": "api/src/modules/auth/tests/unit/auth.service.spec.ts",
  "describe": "AuthService",
  "cases": ["hashes passwords with bcrypt", "rejects expired refresh tokens"]
}
```

The scanner emits **one finding per file**, not one per case — `cases[]` is the payload. Files that declare no case (e.g. pure setup modules) are skipped.

## `doc-context` — Markdown docs

Emitted by `docs.scanner.ts`. One finding per H1/H2/H3 heading found in `README.md`, `CLAUDE.md` (root + `api/` + `web/`), and `docs/**/*.md`. YAML frontmatter is stripped; H4+ headings are ignored.

```ts
interface DocContextFinding extends BaseScannerFinding {
  kind: 'doc-context'
  area: string // slug derived from parent folder
  file: string // repo-relative path of the markdown file
  heading: string // raw heading text
  headingLevel: 1 | 2 | 3
  excerpt: string // first non-blank paragraph under the heading, capped at 280 chars
}
```

Example :

```jsonc
{
  "kind": "doc-context",
  "title": "Authentication",
  "area": "docs",
  "file": "docs/auth.md",
  "heading": "Authentication",
  "headingLevel": 1,
  "excerpt": "Email + password sign-in with refresh tokens."
}
```

`excerpt` is capped to keep payloads small and to prime the skill with a summary, not the full document. Load the file directly when you need more than the excerpt.

## Five-category section seeding (#247)

Scanner findings are the raw material for the five SRS categories (UR + FR + DS + TC + NFR). The mapping below tells the skill which finding kind feeds which section when the drafter builds an Epic
cluster:

| Section | Primary source                                                                                         | Seeding rule (summary)                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UR**  | `doc-context` excerpts + inferred from FR titles                                                       | One UR per coherent user goal in the area — narrative comes from the richest `doc-context`, else written by the agent from FR groupings.                    |
| **FR**  | `endpoint`, `ui-flow`                                                                                  | One FR per endpoint (or tight endpoint cluster). `ui-flow` routes become acceptance criteria.                                                               |
| **DS**  | `entity`, `endpoint` (non-trivial DTO), `ui-flow` (forms)                                              | `Data model — <Entity>`, `API contract — <METHOD> <path>`, `UI form — <Page>`. Deduplicate by title prefix.                                                 |
| **TC**  | `test.cases[]`, plus **TODO** items for `endpoint.hasTests=false`                                      | One TC per `test.cases[i].title`; untested endpoints emit a TODO TC (`expectedResult: "to write"`) so the gap is auditable.                                 |
| **NFR** | stack signals (auth / i18n / prisma / docker-compose / playwright / swagger) + standard SaaS catalogue | Always **proposed** with `priority: 'P3'` and `target: '<proposed — needs human validation>'`. Reviewer lifts priority and refines target before accepting. |

The full seeding rules (including the catalogue of stack signals → NFRs and the pre-accept coverage table) live in `.claude/skills/sf-srs/SKILL.md` → "Seeding DS / TC / NFR (five-category
completeness)". Keep the two documents consistent — the skill is the source of truth for the agent's behaviour, this file is the source of truth for the finding shapes it consumes. The canonical
example `example-epic.md` shipped with the skill demonstrates all five categories on the built-in auth module.

## Stability guarantees

The scanner pipeline respects `.gitignore` and hard-excludes `node_modules`, `dist`, `coverage`, `.git`, and `.vitepress/cache`. The order of findings is :

1. Every scanner emits its batch sequentially (nestjs → react → prisma → tests → docs), in the order defined in `src/srs/bin/draft-from-codebase.ts`.
2. Within a scanner, file discovery is deterministic (`readdirSync` sorted), so identical inputs produce identical outputs — safe to snapshot-test.

Exit codes mirror every `srs-cli.sh bin` entrypoint : `0` success, `2` bad input, `3` missing backend, `4` unknown backend, `5` scanner runtime error.

## See also

- [SRS walkthrough → Drafting from an existing codebase](/srs/walkthrough#drafting-from-an-existing-codebase)
- [SRS lifecycle → ai-draft phase](/srs/lifecycle)
- [`sf-srs` SKILL.md → Drafting from codebase](https://github.com/DiamondForgeFr/SaaSFoundryAI/blob/develop/.claude/skills/sf-srs/SKILL.md) — review-loop prompts and clustering heuristics
- [`src/srs/scanners/types.ts`](https://github.com/DiamondForgeFr/SaaSFoundryAI/blob/develop/src/srs/scanners/types.ts) — the source-of-truth TypeScript definitions
