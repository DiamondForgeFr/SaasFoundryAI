# `@{{PROJECT_NAME}}/ui-primitives`

Headless ShadCN/Radix UI primitives + Tailwind v4 theme tokens shared by every frontend in the monorepo (`apps/web`, future `apps/admin`, future `apps/mobile-web`, …).

## Why this package exists

In a monorepo, multiple frontends share the same brand language: identical buttons, dialogs, theme tokens, dark-mode behavior. Vendoring those primitives once here removes drift, lets the design system evolve in one place, and keeps every consumer pixel-aligned.

## What goes here

- ShadCN/Radix headless primitives (`button`, `dialog`, `select`, …) — generic UI building blocks
- Cross-cutting hooks shared by primitives (`useIsMobile`)
- The `cn()` className utility (re-exported via `./lib/utils`)
- Tailwind v4 theme tokens (`./theme.css`) — colors, radii, animations, dark mode

## What does NOT go here

- App-specific compositions (logos, page-loaders, business widgets) — keep them in `apps/<app>/src/components/`
- Routing, data-fetching, or business logic — those belong in the consuming app
- Translations — primitives stay i18n-agnostic; consumers pass labels in

## Consumption pattern

### 1. Import the theme once at the app root

```css
/* apps/web/src/index.css */
@import '@{{PROJECT_NAME}}/ui-primitives/theme.css';
@source '../../../node_modules/@{{PROJECT_NAME}}/ui-primitives/src';
```

The `@source` directive tells Tailwind v4 to scan the package's primitives for utility classes so they end up in the final CSS bundle.

### 2. Cherry-pick primitives

```tsx
import { Button } from '@{{PROJECT_NAME}}/ui-primitives/button'
import { Dialog, DialogContent } from '@{{PROJECT_NAME}}/ui-primitives/dialog'
import { cn } from '@{{PROJECT_NAME}}/ui-primitives'
```

## How to add a new primitive

1. Add `src/<name>.tsx` (must follow the ShadCN convention — `forwardRef`, `displayName`, variants via `cva`).
2. Export it from `src/index.ts` if it's a top-level building block. Sub-paths (`./button`, `./dialog`) are auto-resolved by the `exports` field.
3. Mirror the file byte-for-byte (modulo the `cn` import path) into `scaffolds/blueprints/web/src/components/ui/shadcn/<name>.tsx` so the multirepo topology keeps working. The drift-guard test enforces parity.
4. Add new external deps to this package's `dependencies`, not `apps/web`.

## Package shape

- **Source-only** — like `api-client` and the `shared-*` packages, this package ships its `.ts/.tsx` directly via the `exports` field. No `dist/`, no build step. Vite + TypeScript pick up the source through workspace symlinks.
- **`peerDependencies`** for `react`, `react-dom`, `react-hook-form` — the consuming app owns the version.
- **`dependencies`** for Radix, `lucide-react`, `cva`, `cmdk`, `clsx`, `tailwind-merge` — these belong to the design system, not the app.

## Multirepo note

`scaffolds/blueprints/web/src/components/ui/shadcn/` keeps a vendored mirror of these primitives so the multirepo topology remains stand-alone (no monorepo-only imports leak into the blueprint). The drift-guard Jest test in `src/__tests__/integration/skill/ui-primitives-drift.spec.ts` enforces that the canonical source here and the vendored copy stay byte-equal (modulo the `cn` import line).
