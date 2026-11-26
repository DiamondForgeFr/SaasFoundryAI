---
name: tool-saasfoundry
description: >-
  Orchestrates the `sf` CLI in non-interactive mode for SaaSFoundryAI projects; never runs the interactive Inquirer prompts itself. Use it to scaffold a new project ("sf new", "scaffold a SaaS"), add
  or update modules ("sf update", "add a module", "update my SaaSFoundryAI project"), check project state or installed modules (".saasfoundry.json"), read a POC or prototype before starting properly,
  resume a flow ("where were we?"), frame a release or version, file a module request, report a CLI or scaffold bug ("file a SaaSFoundryAI bug"), or vote on community proposals ("vote on SaaSFoundryAI
  modules"). Also use it when a SaaSFoundryAI project is asked to add, build or implement a feature ("add file uploads", "track usage"): the module catalogue is checked before any custom code.
---

# tool-saasfoundry

Drive the `sf` CLI for the user. The CLI generates every file, so you plan, preview, ask and run; you write no blueprint, overlay or module by hand.

## Before any command

Run these from `scripts/`, next to this file.

| Script             | Run it                                                            | It ends on                                                                                                         |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `detect-env.sh`    | once per session                                                  | a JSON snapshot on stdout (`os`, `nodeVersion`, `ghInstalled`, `ghAuthed`, `sfGlobalInstalled`); always exit 0     |
| `bootstrap-cli.sh` | before the first `sf` command                                     | the command token on stdout (`sf`, `saasfoundryai-cli` or `npx saasfoundryai-cli`): write it in every `sf` command |
| `bootstrap-gh.sh`  | before a GitHub-backed command (`sf feedback …`, voting, listing) | exit 0 and no output; on exit 1, show its stderr verbatim and stop                                                 |

## Route the request

Each row gives the first move; the file it names holds the rest, and you read it when the row fires.

| The user…                                                                                                      | Do                                                                 |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| comes back to a flow in progress ("where were we?")                                                            | run `scripts/recap.sh` first; see "Resuming"                       |
| has code in the folder (a POC, a prototype, a project to keep), or the folder `sf new` will run in holds files | read `flows/intake.md`; it starts with `scripts/read-poc.sh <dir>` |
| wants a new project                                                                                            | read `flows/new.md`                                                |
| wants to add modules, or to take a `harness` or `stack` project to `full`                                      | read `flows/update.md`                                             |
| asks what the project has: profile, modules, version, "am I up to date?"                                       | run `scripts/read-project.sh`; see "Project Awareness"             |
| asks to add, build or implement a feature inside a project                                                     | see "Anti-Reinvention Guardrail" before any custom code            |
| talks about releasing, cutting, tagging or shipping a version                                                  | read `flows/milestone.md`                                          |
| wants a module the catalogue lacks                                                                             | read `flows/feedback-request.md`                                   |
| reports a crash, a failing build or a broken generated project                                                 | read `flows/feedback-bug.md`                                       |

## Commands

The skill runs the CLI in non-interactive mode only. `sf update --dry-run --json` previews an update; use `--help` of a command for the flags this file does not list.

- New project: `sf new --non-interactive --profile <full|harness|stack> --project-name <name> [--structure <monorepo|multirepo>] [flags…]`
- Update: `sf update --non-interactive [--target-profile full] [--add-modules <m1,m2>] [--dry-run --json]`
- Catalogue: `sf modules list --json`, `sf modules info <slug> --json`, `sf modules match <query> --json`
- Skill lifecycle: `sf skill install [--project|--user]`, `sf skill update`, `sf skill uninstall`. Inside a managed project the default scope is the project (`.claude/skills/`); Claude Code gives a
  personal `~/.claude/skills/` copy precedence over it, so pass `--user` only on purpose.
- Feedback: `sf feedback request <name> --description "…"`, `sf feedback bug --source cli|scaffold --title "…" --description "…" [--auto-repro]`, `sf feedback list`
- Voting: `sf feedback vote --list` ranks module requests; `sf feedback vote <n> up|down` records a vote in `~/.saasfoundry/preferences.json`; `sf feedback vote <n> comment --comment "<body>"` posts a
  comment and records no vote.

## Rules for every flow

- **Preview, confirm, run.** Show the command and a short summary of what it changes, run it after the user's explicit approval, and rebuild the plan with its `plan-*.sh` script when the user changes
  a field. Done when the user has seen the plan before the first mutation.
- **Names and flags come from the CLI.** Take module names from `sf modules list --json` and flags from `reference/*.json`; when a name or flag is in neither, tell the user it does not exist instead
  of passing it on.
- **Secrets stay out of the intent, the command and every summary.** A field marked `secret: true` reaches the CLI as an environment variable on its own process (`SF_UPDATE_MAILERSEND_API_KEY` and
  `SF_UPDATE_NOTION_API_TOKEN` for `sf update`, `NOTION_API_TOKEN` for `sf new`), and is redacted wherever you echo it. Ask the user to put it in their shell or secret manager, never to paste it into
  the chat.
- **Match the user's detail.** Little detail: ask one question at a time, recommend, and leave a way out. Enough signal ("scaffold a monorepo with mailersend and analytics"): infer the intent, echo it
  as a plan and ask one validation. A pasted `sf … --non-interactive` command: check its flag names against `reference/*.json` and pass it through verbatim.
- **Enumerated choices go through the host's structured question tool** when it has one.
- **`~/.saasfoundry/preferences.json` holds the user's opt-outs** (skill prompts, voting surveys): honour them across sessions.
- **Artefacts follow the manifest's language.** Readings, the intake record, filings and every page or ticket you write use `language` of `.saasfoundry.json` (English before a manifest exists). The
  language of the conversation is not the signal.

## The zero-to-project flow

A user dropped into a folder with the install line gets an experience only if the phases run in order. Each starts from what the previous one produced and ends on something checkable.

| #   | Phase                | Starts from                 | Ends on                                                                 | Carried by                                                                    |
| --- | -------------------- | --------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Read the code        | a folder holding code       | a reading the user confirmed; on `full` only, the POC filed into `POC/` | `read-poc.sh`, then on `full` `plan-poc-move.sh` then `move-poc.sh --confirm` |
| 2   | Challenge the intent | the confirmed reading       | `intake.json` holding answers traced to observations                    | `plan-challenge.sh` then `record-intake.sh`                                   |
| 3   | Decide the setup     | the intake record           | a project directory holding `.saasfoundry.json`                         | `plan-new.sh`, then the `sf new` command it prints                            |
| 4   | Write the SRS        | the manifest and the intake | pages under the SRS root page                                           | the **sf-srs** skill                                                          |
| 5   | Create the tickets   | an SRS carrying FRs         | the board carries tickets                                               | `srs-cli.sh spawn` against a version page                                     |
| 6   | Base setup           | tickets on the board        | the first ticket past Backlog                                           | the **sf-workflow** skill                                                     |
| 7   | Features             | a working base              | -                                                                       | the **sf-workflow** skill, one ticket at a time                               |

Phase 3 comes before phase 4: the SRS step needs a configured backend, and the manifest that declares it exists only once the setup has run. Run every phase: an SRS written without the intake record
specifies nothing in particular. Stop at a blocker: give the user the remediation it prints and wait; improvising around the error skips a phase.

### Resuming

Run `scripts/recap.sh [workspace] [--no-network]` first on a resumed session. It reads `POC/`, `intake.json` and the manifest from disk and takes the preconditions from `sf status --json`. Never
report a phase from memory: chat history is the one source that does not survive a session, and the one that lies most confidently. Done when you have told the user the `current` phase and the command
that carries it.

It prints `current` (the first phase not known to be done, with its command), a `state` per phase (`done`, `pending`, `unknown` or `not-applicable`) and the `blockers` (phases at or after the current
one whose precondition fails, each with its remediation). Read the states as they are:

- `unknown` is not `pending`: offline, the SRS and the board cannot be inspected, so they are reported as unverified and the walk stops there. Claiming to be past a phase nobody checked is how written
  work gets written twice.
- `not-applicable` is not `pending`: a project with a manifest and no `POC/` never had a POC, so phases 1 and 2 are not outstanding work. Do not send it back to read something that never existed.
- An occupied workspace with no manifest is `unknown`, not `pending`: code is there and nothing is decided, so whether it is a POC to file into `POC/` or a project the user keeps is the profile
  question, and `recap.sh` prints that question instead of the move command. Ask it. `move-poc.sh --confirm` on an existing repository relocates everything the user has, often with no remote and no
  history to restore from.
- A blocked phase routes: the remediation is the one `sf status` carries (`sf update --add-modules srs`, `sf workflow use <template>`, `sf new`). Hand it to the user.

### Ask, do not assume

Three decisions are the user's, asked at the phase that needs them; none has a safe default. When the manifest already answers one, read it and do not ask again.

| Decision      | Phase | Why it cannot be guessed                                                          |
| ------------- | ----- | --------------------------------------------------------------------------------- |
| `profile`     | 3     | a wrong answer scaffolds a full stack over an existing repository                 |
| SRS backend   | 4     | it decides where every specification page is written, in someone else's workspace |
| workflow tool | 5     | it decides where every ticket lands                                               |

## Project Awareness

Answer a question about the current state of the project from `scripts/read-project.sh` (it reads `.saasfoundry.json`, `sf status --json --no-network` and `sf modules list --json`, and changes
nothing). Cite the report field; when it holds none, say you do not know. Run it again when the user says something changed.

- Profile or capabilities: `report.project.capabilities`, giving `effectiveProfile` plus the independent stack and managed-harness states.
- "Can it become `full`?": for `harness` or `stack`, recommend `sf update --target-profile full --dry-run --json`; for `full`, a no-op; for `unknown` or `inconsistent`, relay the status remediation
  and guess nothing.
- Version, "am I up to date?": `report.project.cliVersion` and `report.upToDate`, the only field that cross-checks installed modules against the catalogue's `minCliVersion`. When it is `false`, list
  `report.modules.obsolete` with their `minCliVersion` and recommend `sf skill update`, then `sf update`.
- Installed modules: `report.modules.installed`, verbatim; one module's details come from `sf modules info <slug> --json`.
- New modules since the install: `report.modules.newlyAvailable`, each described by `sf modules info <name> --json`.
- What `sf update` would do now: the plan of `sf update --dry-run --json --non-interactive`, never the snapshot alone.
- Where and when it was generated: `report.project.generatedAt`, `structure` and `name`.

This surface changes nothing. A follow-up such as "add X" or "upgrade Z" is a new request: route it through `flows/update.md` once the user has said so.

## Anti-Reinvention Guardrail

Inside a project (a `.saasfoundry.json` exists), a request to add, build, implement, set up, integrate or plug in a feature gets a catalogue check before any custom code: an opinionated module ships
faster and stays maintained upstream. Nouns that map to modules: email, transactional mail, file upload, object storage, S3, analytics, usage tracking, telemetry, and every `sf-skill-*` integration.
The guardrail informs and never blocks.

1. Run `scripts/check-catalogue.sh "<user intent>"` (it wraps `sf modules match <intent> --json`) and read the `tier` of its result.
2. Act on the tier:
   - `HIGH` (score 6 or more): propose `sf update --add-modules <name>` before a line of custom code, with the trade-off: what the module ships (routes, adapters, docs, tests, CI) against what a
     hand-rolled version costs (maintenance, drift from the blueprint, no upstream updates).
   - `MEDIUM` (3 to 5): show the candidate, ask the user to confirm it matches the intent, then propose the update.
   - `LOW` (1 to 2) or `NONE`: read `flows/feedback-request.md`. A `LOW` match is a signal, so name it as the closest neighbour in the request.
3. When the user keeps custom code against a `HIGH` match, build it and write one line ("custom despite a HIGH match for module Y") so no later turn proposes it again.

Done when the user has chosen `sf update`, a module request or custom code in the open.
