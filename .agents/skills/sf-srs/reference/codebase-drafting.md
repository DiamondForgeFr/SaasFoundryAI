# Drafting from the codebase: details

Read from `SKILL.md`, "Draft from the codebase", when the scan comes back sparse or empty, or the scan is too noisy.

## The scanner is best-effort, you are the backstop

The deterministic scanner parses a subset of stacks: NestJS controllers, React pages, Prisma models and Jest or Vitest tests. On any other stack (Rust or Tauri, Go, Python or FastAPI, Rails, mobile,
raw SQL) it returns sparse or empty `endpoint` and `entity` findings. **That is not evidence the surface is empty.** When the findings look thin for a stack it does not parse, read the project's own
operation or model registry yourself (a Tauri `generate_handler!` list, a Go or Express router, a FastAPI app, SQL migrations, a gRPC service) and synthesise the findings before clustering.

The finding kinds are concepts, not frameworks. `endpoint` is any invocable operation (an HTTP route, an RPC or Tauri command, a CLI command, a queue handler), `entity` is any persistent record (any
ORM, raw DDL, a struct, a protobuf message), `ui-flow` is any user-facing view (web, native, TUI or CLI). The full stack-neutral mapping is in
[`data/clustering-rules.json`](../data/clustering-rules.json).

## Tuning the scan for noise-heavy repositories

CLI, library and template projects (monorepos shipping `scaffolds/`, heavily documented repositories with large `docs/` trees) can drown the signal under fixture code the scanners treat as production
source. Two layers opt it out, and they stack on top of `.gitignore`:

- **`.srsignore`**, a gitignore-style file at the scan root. It stays local to the developer, out of other projects generated from this repository.
- **`tools.srs.scan.exclude`** in `.saasfoundry.json`, a `string[]` of gitignore-style patterns for the defaults the whole team shares:

```jsonc
{ "tools": { "srs": { "scan": { "exclude": ["scaffolds/", "docs/", ".claude/"] } } } }
```

The scan never walks `node_modules`, `dist`, `coverage`, `.git` or `.vitepress/cache`.
