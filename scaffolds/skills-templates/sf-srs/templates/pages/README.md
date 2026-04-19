# sf-srs — page templates

Agnostic page rendering for SRS documents. Each template consumes a typed spec (`EpicSpec`, `FrSpec`) and emits a backend-agnostic `PageContent`. The per-backend adapter (e.g. `NotionSrsAdapter`) maps
`PageContent` to its native block model.

## Runtime location

The TypeScript source lives in the CLI repository:

- `src/builders/srs/templates/pages/epic.tpl.ts` — exports `renderEpicPage(spec: EpicSpec): PageContent`
- `src/builders/srs/templates/pages/fr.tpl.ts` — exports `renderFrPage(spec: FrSpec): PageContent`

The skill bundle ships this README as reference; `srs-cli.sh draft` loads the compiled module from `dist/` (or the TS source via `tsx` in dogfood mode).

## `PageContent` contract

```ts
interface PageContent {
  title?: string
  blocks: PageBlock[]
}

type PageBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bulleted_list'; items: string[] }
  | { kind: 'numbered_list'; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'code'; language?: string; text: string }
  | { kind: 'divider' }
```

## Epic page sections

Produced by `renderEpicPage(spec)` in this order:

1. `Overview` (H1) + business value paragraph
2. `Scope` (H2) + scope paragraph (omitted when absent)
3. Divider
4. `Requirement Types` (H2) + table `[UR, FR, DS, TC]` with counts
5. `Traceability` (H2) + table `[FR, UR refs, DS refs, TC refs]`
6. Divider
7. `User Requirements (UR)` (H2) + bulleted list
8. Divider
9. `Functional Requirements (FR)` (H2) + per-FR detail blocks (H3 + description + acceptance criteria list + refs paragraph)

## FR page sections

Produced by `renderFrPage(spec)` in this order:

1. `{FR-id} — {title}` (H1) + description paragraph
2. `User Requirements` (H2) + bulleted list (placeholder when empty)
3. `Acceptance Criteria` (H2) + bulleted list (placeholder when empty)
4. `Design (DS)` (H2) + bulleted list (placeholder when empty)
5. `Test Cases (TC)` (H2) + bulleted list (placeholder when empty)

## Adding a new backend

Backends add a `renderPageContentTo{Backend}Blocks(content: PageContent)` mapper and register via `registerSrsBackend` from `src/srs/registry.ts`. No template changes needed — the agnostic surface is
stable.
