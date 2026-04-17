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

## Interaction principles

1. **Never bypass the CLI.** If the user asks for a file or layout that the CLI can generate, generate it via `sf`. Do not hand-write blueprints.
2. **Always verify prerequisites first.** Run `bootstrap-gh.sh` before GitHub calls and `bootstrap-cli.sh` before any `sf` command. Project-scoped awareness (reading `.saasfoundry.json`) lands in Phase 2E.
3. **Use `AskUserQuestion` for multi-choice.** Do not emulate Inquirer with plain prose questions — use the structured tool when presenting enumerated options (fleshed out in Phase 2C/2D).
4. **Prefer `--dry-run` before mutations.** Especially for `sf update`, always show the user what would change before doing it.
5. **Respect user preferences.** `~/.saasfoundry/preferences.json` tracks opt-out choices (skill prompts, voting surveys) — honor them across sessions.

## Future capabilities

This SKILL.md is the foundation (Phase 2A, ticket #102). The following capabilities will be layered on in subsequent tickets:

- **Phase 2C — Discovery for `sf new`** (#104): replaces Inquirer with a Guided / Express / Expert conversational flow.
- **Phase 2D — Discovery for `sf update`** (#105): same treatment for module add/remove, catalogue-aware.
- **Phase 2E — Project Awareness** (#106): read-only conversational queries over `.saasfoundry.json` and the module catalogue.

Phases 3+ (Anti-reinvention guardrail, Community voting polish, Event handling) are tracked under epic #18.
