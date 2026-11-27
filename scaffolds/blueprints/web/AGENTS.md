# {{PROJECT_NAME}} Web

React 19 application generated with **SaaSFoundryAI**: React Router v7, Vite 7, TailwindCSS 4 with ShadCN UI, React Query, React Hook Form with Zod 4, i18next (French and English), Playwright E2E.

## 🧭 Preconditions first

Before asking about scope, read `.saasfoundry.json` (workflow, SRS backend, installed modules) and run `sf status --agent-friendly --no-network`. Resolve any `fail` precondition first: its remediation names the `sf` command. Ask only what the manifest does not declare.

## 🎯 Skills

Prefer the `sf-*` skill over a same-named global one (`sf-git-commit` over `git-commit`). Claude Code reads `.claude/skills/`; other agents read `.agents/skills/`.

- `sf-integration-rules`: read it before adding a page, API hook, form, ShadCN composition, RBAC wiring or i18n key.
- `sf-git-commit`, `sf-git-fix-pr-comments`, `sf-utils-fix-errors`, `sf-utils-fix-grammar`: commits, PR feedback, lint and type errors, prose.
- `sf-tool-*`: the tools you selected at setup.

## Layout

Pages live in `src/pages/private/` (authentication required) and `src/pages/public/`. API hooks live in `src/hooks/api/`, UI hooks in `src/hooks/ui/`. Routes are in `src/router/routes.tsx`, lazy-loaded through `src/router/lazy-pages.tsx`, and protected by `src/router/guard.tsx`. Translations are YAML in `src/locales/{en,fr}/`.

## Code Conventions

- Components are PascalCase function components. Fetch data with React Query hooks. Build forms with React Hook Form and a Zod resolver, and call `useFormLanguageSync(form)` so displayed errors follow the current language.
- Path aliases: `@/*` → `src/*`, `@shared-types/*` and `@shared-validation/*` for the shared types and Zod schemas.
- Styling: Tailwind utilities and ShadCN primitives (`Button`, `Dialog`, `Form`), Radix only through ShadCN, mobile first. Theme tokens (colours, radii, animations, dark mode) live in `theme.css`, imported once from `src/index.css`.
- Authenticated pages go under the protected layout route in `src/router/routes.tsx`; public pages (login, register) go outside it.
- Strings: translate with `useTranslation('<namespace>')`; never hard-code them. Keep the keys of `en` and `fr` identical.
- Auth is cookie-based, with automatic refresh.

## Shared Layers

`src/shared-types/` and `src/shared-validation/` are vendored copies that the web bundle compiles against.

- **Monorepo**: they mirror `<root>/packages/shared-{types,validation}/src/`. Edit a hand-written file in all three places; the CLI's drift guard blocks divergence. ShadCN primitives come from `@<root-package-name>/ui-primitives/<name>`, the theme from `@import "@<root-package-name>/ui-primitives/theme.css"` in `src/index.css`. Typed hooks come from `@<root-package-name>/api-client/generated/api/<tag>/<tag>`. Module constants (such as `STORAGE_LOGO_MAX_BYTES`) come from the workspace: never redeclare them.
- **Multirepo**: the vendored copies are the only ones. ShadCN primitives live in `src/components/ui/shadcn/`. There is no generated client: write the React Query hooks under `src/hooks/api/`. Module-shared values are inlined: keep them stable, the CLI's docker assertions enforce the inlined shape.

Run `sf status --agent-friendly --no-network` to confirm the topology before you change a shared shape.

## Development Commands

```bash
npm run dev                 # Vite dev server on port 5173
npm run test:e2e            # Playwright E2E, specs in tests/e2e/
npm run test:full           # format, lint, type-check, build and E2E
```

The API is at `VITE_API_URL` (`http://localhost:3500/api` in the template); the other variables are listed in `.env.example`.

## 🤖 AI-Assisted Development

- Long-running commands (over about 5 seconds): announce them in one sentence, stream their progress past a minute, and report the outcome with numbers.
- Do not skip the E2E tests, which validate the user flows; do not bypass the hooks (`--no-verify`); do not leave TypeScript errors.

## Git Workflow

- Main branch: `{{MAIN_BRANCH}}`. Commits follow `<type>(#<ticket>): <description>` with the ticket number and 100 characters at most; commitlint enforces it.
