---
name: tool-saasfoundry
description: >-
  Use when the user wants to scaffold a new SaaSFoundry project, add or remove
  modules in an existing SaaSFoundry project, check project state or installed
  modules, file a module request, report a CLI or scaffold bug, or vote on
  community proposals. Triggers on keywords and phrases like "saasfoundry",
  "sf new", "sf update", "scaffold a SaaS", "add a module", "update my
  SaaSFoundry project", ".saasfoundry.json", "file a SaaSFoundry bug", or
  "vote on SaaSFoundry modules". Always orchestrates the `sf` CLI in
  non-interactive mode — never runs the interactive Inquirer prompts itself.
---

# tool-saasfoundry

Help the user scaffold, evolve, and give feedback on SaaSFoundry projects by orchestrating the `sf` CLI. Never bypass the CLI with direct file generation — it is the source of truth for blueprints, overlays, modules, and workflow configuration.

## When to activate

Activate on explicit SaaSFoundry intent:

- "scaffold a SaaS / SaaS project / Node+React stack with postgres"
- "I want to start a new SaaSFoundry project"
- "add the email / storage / analytics module"
- "update my SaaSFoundry project"
- "what modules do I have?" / "am I up to date?" / "what's in `.saasfoundry.json`?"
- "file a module request" / "report a SaaSFoundry bug" / "vote on roadmap"

Do NOT activate on:

- Generic Node.js / React / NestJS questions unrelated to SaaSFoundry
- Unrelated scaffolding tools (`create-next-app`, `degit`, `nx`, …)
- Questions about someone else's generated project where no `.saasfoundry.json` can be found

## CLI contract

The skill invokes the `sf` CLI exclusively in **non-interactive mode**:

- Scaffolding: `sf new --non-interactive --name <name> --structure <mono|multi> --apps <all|backend|frontend> [flags…]`
- Module updates: `sf update --non-interactive --add <m1,m2> --remove <m3> [--dry-run]`
- Catalogue lookups: `sf modules list --json` / `sf modules info <slug> --json` / `sf modules match <query> --json`
- Skill lifecycle: `sf skill install [--project]` / `sf skill update` / `sf skill uninstall`
- Feedback loop: `sf feedback request <name>` / `sf feedback bug --source cli|scaffold` / `sf feedback list` / `sf feedback vote --list` / `sf feedback vote <n> up|down|comment`

Before mutating, always prefer `--dry-run` where available (notably `sf update --dry-run`) to preview the plan for the user.

## Available commands

| User intent | CLI command | Notes |
| --- | --- | --- |
| Start a new project | `sf new --non-interactive …` | Gather intent via conversation (Phase 2C) |
| Add / remove modules | `sf update --non-interactive --add … --remove …` | Consult `sf modules list --json` first (Phase 2D) |
| Inspect project state | Read `.saasfoundry.json` + `sf modules list --json` | Pure read, no mutation (Phase 2E) |
| File a module request | `sf feedback request "<slug>" --description "…"` | Checks dedup automatically |
| Report a bug | `sf feedback bug --source cli\|scaffold --title "…" --description "…" [--auto-repro]` | `--auto-repro` embeds `.saasfoundry.json` |
| List open feedback | `sf feedback list [--status open\|closed\|all] [--mine] [--json]` | 3-label fan-out: module-request, cli-bug, scaffold-bug |
| Rank module requests | `sf feedback vote --list [--limit N] [--stack-filter <term>]` | Ranked by 👍 |
| Cast a vote | `sf feedback vote <n> up\|down` | Recorded in `~/.saasfoundry/preferences.json` |
| Comment on a request | `sf feedback vote <n> comment --comment "<body>"` | No vote recorded, just a comment |

## Bootstrap

Before running user-facing SaaSFoundry commands, the skill verifies the environment using bundled helper scripts under `~/.claude/skills/tool-saasfoundry/scripts/`:

| Script | When to invoke | Contract |
| --- | --- | --- |
| `detect-env.sh` | Once per session, or whenever the skill needs to choose between `sf` and `npx saasfoundry-cli` | Prints a JSON snapshot on stdout (`os`, `nodeVersion`, `ghInstalled`, `ghAuthed`, `sfGlobalInstalled`). Always exits 0. |
| `bootstrap-gh.sh` | Before any GitHub-dependent command (`sf feedback …`, voting, issue listing) | Exits 0 silently when `gh` is installed and authenticated. Exits 1 with guided install/login instructions on stderr otherwise. |
| `bootstrap-cli.sh` | Before any `sf` invocation | Prints the exact command token to use (`sf`, `saasfoundry-cli`, or `npx saasfoundry-cli`) on stdout. Always exits 0. |

Guidelines:

- **Run `detect-env.sh` first** when the conversation starts to cache environment facts (OS, node version, CLI presence) for the rest of the turn
- **Always gate `gh`-backed flows behind `bootstrap-gh.sh`** — on failure, surface its stderr verbatim to the user and stop rather than retrying blindly
- **Resolve the CLI invocation via `bootstrap-cli.sh`** — never hardcode `sf` in examples if the user might be running via `npx`

## Discovery: `sf new`

When the user wants to start a new SaaSFoundry project, the skill replaces the CLI's Inquirer prompts with a conversational discovery flow. The goal is to produce a complete **intent** object that `plan-new.sh` can translate into a single `sf new --non-interactive …` command. The intent schema and flag mapping are documented in `reference/new-flags.json` — consult it before inventing field names.

### Three discovery modes

Pick the mode from the user's first message, not from a menu:

| Mode | When it fits | Flow |
| --- | --- | --- |
| **Guided** *(default)* | User says "I want a new SaaS project" with little detail, or explicitly asks for help choosing | Ask one question at a time, explain each choice briefly, recommend based on the table below, allow bail-out |
| **Express** | User gives enough signal upfront ("scaffold a monorepo with mailersend and analytics") | Infer the intent, echo it back as a plan, ask for single-shot validation |
| **Expert** | User pastes a full or partial `sf new --non-interactive …` command | Pass it through verbatim after sanity-checking flag names against the manifest |

### Discovery workflow

1. **Bootstrap** — run `bootstrap-cli.sh` to resolve the invocation token (`sf` / `npx saasfoundry-cli`). Cache for the rest of the turn.
2. **Gather intent** — build a JSON object matching the `fields` in `reference/new-flags.json`. Only include fields the user has either stated or confirmed via a recommendation.
3. **Materialize the plan** — pipe the intent JSON into `scripts/plan-new.sh`. It returns the full command on stdout or exits non-zero with a validation message on stderr.
4. **Present the plan** — show the command *and* a short human summary built from the intent (structure, database, modules, post-setup apps). Never run the command yet.
5. **Confirm and execute** — wait for explicit user approval before running. If the user tweaks a field, rebuild the intent and re-run `plan-new.sh` rather than editing the command string by hand.

### Intent schema (summary)

Full specification: `reference/new-flags.json`. Essentials:

- **Always required:** `projectName` (kebab-case), `structure` (`monorepo` | `multirepo`)
- **Recommended to set explicitly:** `mainBranch`, `dbSetup`, `emailService`, `analytics`
- **Only set when user opts in:** `advancedSkills` (CSV of `context7`, `atlassian`, `notion`, `figma`) and their credential fields
- **Secrets** (marked `"secret": true` in the manifest): never echo them back, never log them

### Recommendation rules

Use these defaults when the user has no strong opinion:

| Dimension | Default | Condition to override |
| --- | --- | --- |
| `structure` | `monorepo` | Recommend `multirepo` only when backend/frontend are owned by separate teams or deploy on separate schedules |
| `mainBranch` | `main` | Only `master` when the user's org standard says so |
| `dbSetup` | `docker` | Recommend `credentials` for staging/prod stacks, `manual` when DB is provisioned elsewhere |
| `emailService` | `none` | Recommend `mailersend` as soon as the product needs transactional email (password reset, invites, receipts) |
| `analytics` | `false` | Recommend `true` only when metrics are on the roadmap from day one — otherwise `sf update --add-modules analytics` later is a one-liner |
| `startApps` / `startServices` | `none` / `false` | Offer to start services when the user says they want to "try it immediately" |

The full rationale for each recommendation is in the `recommendations` block of `reference/new-flags.json` — lean on it when the user asks "why?".

### Never do these

- **Don't fabricate flags.** Every flag you pass must exist in the manifest's `fields` section.
- **Don't ask for every field in Guided mode.** Skip fields whose defaults are obvious for the user's context (e.g. don't ask about `mainBranch` for a hobby project).
- **Don't re-serialize the plan by hand.** Always round-trip through `plan-new.sh` so the command stays consistent with the manifest.
- **Don't stash secrets in the intent you echo back.** Collect them, pass them through to `plan-new.sh`, but redact in any user-facing summary.

## Interaction principles

1. **Never bypass the CLI.** If the user asks for a file or layout that the CLI can generate, generate it via `sf`. Do not hand-write blueprints.
2. **Always verify prerequisites first.** Run `bootstrap-gh.sh` before GitHub calls and `bootstrap-cli.sh` before any `sf` command. Project-scoped awareness (reading `.saasfoundry.json`) lands in Phase 2E.
3. **Use `AskUserQuestion` for multi-choice.** Do not emulate Inquirer with plain prose questions — use the structured tool when presenting enumerated options (fleshed out in Phase 2C/2D).
4. **Prefer `--dry-run` before mutations.** Especially for `sf update`, always show the user what would change before doing it.
5. **Respect user preferences.** `~/.saasfoundry/preferences.json` tracks opt-out choices (skill prompts, voting surveys) — honor them across sessions.

## Future capabilities

This SKILL.md is the foundation (Phase 2A, ticket #102). The following capabilities will be layered on in subsequent tickets:

- **Phase 2D — Discovery for `sf update`** (#105): same treatment for module add/remove, catalogue-aware.
- **Phase 2E — Project Awareness** (#106): read-only conversational queries over `.saasfoundry.json` and the module catalogue.

Phases 3+ (Anti-reinvention guardrail, Community voting polish, Event handling) are tracked under epic #18.
