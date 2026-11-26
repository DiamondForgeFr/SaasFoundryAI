---
name: sf-srs
description: "SRS host of the project: draft and write SRS pages (features, versions, functional requirements), audit a codebase for an SRS, evaluate SRS freshness and spawn tickets from it, through the configured SRS backend. Triggers on \"create SRS\", \"draft SRS\", \"draft FR\", \"audit codebase for SRS\", \"SRS status\", \"evaluate SRS\", \"spawn tickets from SRS\", \"new epic\", a Notion SRS root URL, or an srs:drafting label event."
---

## Execution capabilities

Use the current agent's native tools for reading, editing, shell commands and delegation.
When delegation is available and authorized, assign independent work to agents; otherwise
execute the same steps sequentially. A sequential self-review is not an independent review:
report that limitation and retain any required human review. Tool names in legacy examples
describe capabilities, not required APIs. Use the user's current request as skill arguments.
Do not assume Claude Code hooks, tool permissions or credentials transfer.
Run preconditions explicitly, and stop to report a missing capability when no equivalent exists.
When a workflow step names a task kind, resolve its tier with
`sf agents route --task <kind> --provider <current-agent>` and delegate the step to the
`sf-<tier>` agent it names: that agent carries its own model and effort, so never name a
model or an effort yourself. The one exception is a route that prints `alias <name>` (Kimi Code
binds no model in an agent file): pass that alias, copied from the route and never composed, as
the `model` of the delegation call. When the route fails or the agent cannot delegate, run the
step in the session: a refused or failed route is never worked around by starting another coding
agent's CLI (`claude`, `codex`, or any other) or a background session of another host, and a host
with no worktree support delegates sub-tasks only, through its own native sub-agent tool.
Never bypass CLI guards, required approvals, tests or workflow status exit conditions.
An escape hatch is the developer's to apply: when a guard refuses, report it and ask; a hook
refuses an agent call that sets one.
The project manifest and workflow rules take precedence over generic skill examples,
including branch names, commit formats, staging, pushing and approval requirements.
Legacy /task examples name roles: use native delegation if available and authorized,
or perform the role's work sequentially with the review limitation stated above.

Who builds a ticket, and the consent behind it, follow "Session orchestration and delegated ticket delivery" in the project instructions (`AGENTS.md`); read the `delegation:` line of `sf status --agent-friendly --no-network`.

## Parallel implementation and Git worktrees

Every ticket is built in a worktree of its own, whoever builds it, a trivial change included.
Several run at once (the recorded delegation `allowed`, or the developer asking for parallel
work) only for independent writing streams that can be delivered concurrently.
Read-only exploration and review may use parallel agents without separate worktrees. Work with
sequential dependencies, overlapping file ownership or unclear boundaries must use one feature
worktree and sequential execution.

Before opening a worktree, read `.saasfoundry.json` and use
`workflow.workingBranch`; never hardcode a branch name. A host with native worktrees opens it
for its delegate; any other runs `git fetch origin`, then
`git worktree add <path> -b <branch> origin/<workingBranch>`, and hands the delegate its path.

The primary checkout is shared: agents of several hosts and the developer may work in one folder.
Never change its branch, which stays on the working branch, and never stash, restore or discard
uncommitted changes there that are not yours. Where the harness installs its guard hook, it
refuses `git checkout <branch>`, `git switch` and `git stash` there and names the worktree
command to use instead.

For each independent writing stream, define one ticket, branch and worktree path, plus its owned
files and dependency boundary. Start from a synchronized configured working branch. Each worker
must stay inside its assigned worktree and ownership boundary, preserve other agents' changes
and never revert unrelated work. The recorded delegation authorizes ticket delivery only: for
any other parallel writing stream, and for tickets when it is not `allowed` or the current
request says otherwise, propose this execution shape and wait for the answer. If clean
separation, Git support or a synchronized base is unavailable, explain the constraint and use
one worktree or sequential execution.

After each stream is complete, commit and push through the configured workflow. After its merge,
return to the primary checkout, check out and synchronize the configured working branch, verify
the merge, then remove the completed worktree and local branch only when they are merged and no
longer in use. Never remove or overwrite user-owned worktrees, branches, uncommitted changes,
stashes or credentials implicitly.

# SRS host

Every action is `sf srs <action> [args]`; `sf srs help` lists the actions, their flags and the shared exit codes. Branch on the exit code rather than on the text of stderr.

## Before any action

1. **Read `.saasfoundry.json`.** `tools.srs` holds the backend and the root page. When it is absent the user is asking to install the module, not to draft: route them to `sf update --add-modules srs`
   and stop here (the word "bootstrap" is used for both, #244).
2. **Write pages in `language.srs`** (`jq -r '.language.srs // "en"' .saasfoundry.json`), never in the language of the conversation: a French chat still produces an English SRS unless the project
   opted that surface out.
3. **Go through the adapter.** `sf srs` calls `createSrsAdapter()`, which reads `tools.srs.backend`. Never hardcode backend branches (`if backend === 'notion'`), import a concrete adapter, or call a
   backend's SDK, `gh` or CLI for SRS pages.
4. **Run `sf srs <action>`**, which resolves the same way in a checkout, a generated project and CI. `.claude/skills/sf-srs/scripts/srs-cli.sh <action>` takes the same actions for a session where `sf`
   is not on the `PATH` (#525: its resolver once looked only for paths of the CLI's own checkout, and every command failed in generated projects).

Done when `tools.srs.backend` is read and the first `sf srs` call answers.

## Write pages

Trigger: the user approved the spec of a feature, a version or FRs.

An SRS page is a **feature**, a **version** of a feature, or an **FR** of a version (Epic = feature + version). The level comes from position, never from the title: `MVP`, `V1` and `v2 — Titre` are
all versions when they sit under a feature.

1. Take the ids from the SRS, not from your last reading. `sf srs next-ids --feature <page-url-or-id>` right before you write the spec gives the next version number and the free UR / FR / DS / TC /
   NFR ids. `write` re-reads the feature and refuses a batch that repeats one (exit 2, nothing written): two sessions extending one feature a minute apart once wrote the same `v3` and the same ids
   (#919).
2. Write the spec as a `DraftCandidate[]` file, shaped like `templates/examples/example-three-levels.spec.json`.
   - `epic.parentId` is the logical id of the feature a page sits under, resolved within the batch; its presence is what makes the page a version. `epic.version.changes` lists what the version adds or
     changes. A page references only a logical id declared **earlier** in the batch.
   - An FR candidate names its version in `parentEpicId`. An FR attached to a feature is refused.
   - An `epic` candidate alone writes one page and no FR page: each FR needs its own `kind: 'fr'` candidate, which is what `spawn` enumerates. `templates/examples/example-epic.spec.json` is a bare
     `EpicSpec` kept as a page-shape reference, not a `--spec` payload.
   - A version of a feature written earlier (the normal path after the first version): set `epic.parentId` to that feature page's URL or id. An FR added to a version written earlier: set the
     candidate's `parentEpicPageId` to that version page.
   - An FR title reads `FR-AREA-NN — Title`: an em dash (U+2014) between spaces, shared by the page renderer and the parser as `FR_TITLE_SEPARATOR` (#246). Give `fr.id` and `fr.title` as fields; a
     title typed by hand with an ASCII hyphen breaks the byte-level match.
3. Run `sf srs write --spec <file>`. Done when it exits 0 and lists the pages it created. Exit 2 wrote nothing: fix what the message names. Exit 6 is a partial write: show the user the report's
   `rollbackHint` (the pages already created; the backend has no rollback) and let them choose between archiving them by hand and retrying from where it stopped.

A write is refused, or a page joins one written earlier: read `reference/writing.md`.

## Ingest existing notes

Trigger: `tools.srs.pendingIngestion` is in the manifest, because the user chose `sf new --srs-enable --srs-ingest-enable`: they asked to ingest the notes under `sourceParent`.

1. `sf srs browse --parent <sourceParent.id>` lists the direct children. Pick with the user the ones worth ingesting (reject table-of-contents and index pages; drill into sub-pages with repeated
   `browse`).
2. `sf srs draft --from notion-pages --ids id1,id2,...` fetches the pages as `RawContent`. Draft the `DraftCandidate` entries (Epic or FR specs) with the user: the CLI calls no LLM, that step is
   yours.
3. After the user approves, write the candidates to a temporary JSON file and run `sf srs write --spec <file>` as above. Done when `write` exits 0 and `pendingIngestion` is cleared from the manifest
   (exit 7 means the pages were created but clearing it failed).

## Draft from the codebase

Trigger: the module is installed and the user wants SRS content from the code ("draft an SRS from my codebase", "audit the repo for SRS material"), reports drift between code and docs, asks what the
code holds that the SRS does not, or opens a mature repository whose SRS root is empty or sparse (propose it). Skip it when existing SRS pages or notes are the source (use `draft --from notion-pages`)
or when the feature does not exist in code yet (use the conversational hook below).

1. Run `sf srs draft --from codebase [--path <dir>]` (the working directory by default). The CLI honours `.gitignore`, calls no LLM and prints `ScannerFinding[]`. On a CLI, library or template project
   pass `--path src`: a whole-repository scan drowns the findings in fixture code and `scaffolds/` (#238). `.srsignore` (gitignore syntax, at the scan root) and `tools.srs.scan.exclude` in the
   manifest narrow the scan further.
2. Read [`data/clustering-rules.json`](data/clustering-rules.json) once per session: it is the source of truth for clustering, the UR + FR + DS + TC + NFR seeding and the review loop. Cluster Epic by
   Epic, then FR by FR, with the user.
3. Put one Epic to the user per prompt (`accept / edit / reject / skip-area`) and write only what they confirmed.

Done when every accepted Epic is written with `sf srs write`.

The findings come back sparse or empty: read `reference/codebase-drafting.md`. The scanner parses only NestJS controllers, React pages, Prisma models and Jest or Vitest tests, so an empty result on
another stack is not evidence of an empty surface.

## Spawn tickets from a version

Trigger: a version is approved and its FRs need Stories, or an FR was added to a version that was already spawned.

1. Run `sf srs spawn --epic <feature-url> --version <title-id-or-url> [--milestone <release>] --dry-run` and read the plan to the user: one line per FR, `new`, `exists #N, skipped` or `blocked`.
2. Run the same command without `--dry-run`. Done when the summary names, for every FR, the Story created or reused and the status it holds on the board (a new ticket joins the board in Backlog; one
   already there keeps its status).

- **One version per batch.** The Epic is `<feature> - <version>`; spawn creates it, or adopts the one an earlier run created, unless `--ticket <n>` attaches to an Epic that exists (never the drafting
  ticket: `transition-drafting <N> spawning` passes it as `--drafting-ticket`). Aiming `--epic` at a versioned feature is an error that lists its versions: pick one and pass `--version`. A feature
  that holds its FRs directly still spawns from `--epic` alone; `sf srs normalize` moves it onto the model.
- **`--milestone <release>` declares the release, in the run that creates the tickets.** The name is the release (`v1.0.0`), not the version page (`v1 — MVP`): a release may carry several features'
  versions, so the CLI never derives it. Ask the user for it, since a version number is a decision (an Epic that already exists keeps its milestone, #1119). Without the flag spawn says
  `release: none — pass --milestone <name> to declare what these tickets ship in` (#542). Never assign the tickets to the milestone one by one afterwards (#562).
- **Existing tickets are reused, with or without a plan (#1037).** `spawn` reads the board before it writes. Each FR is matched on its canonical page link among the open and closed tickets that are
  native children of the Epic or have no parent: a match is reused (a closed one stays closed), a ticket closed as **not planned** is ignored, an FR with no match gets a new Story. Re-running after an
  FR is added is the everyday case: spawn the same version again and only the new FR's Story is created. Two matches for one page, a title that names the FR id without owning its page, or a match
  under another parent stop the run with exit 10 before anything is touched; nothing is reparented implicitly. Create no Story by hand.
- **Every Story needs a `complexity:` label before it leaves Backlog.** An FR candidate may carry `"complexity": "bug" | "low" | "medium" | "complex"`, and spawn labels the Story with it;
  `--complexity <level>` labels the Stories whose FR page states none. The summary names any Story left without one: tag it with `workflow-cli.sh retag <ticket> <level>`.

A duplicate Story exists, an approved version may overlap delivered work (`--reconciliation-plan`), or a run exits 9 or 10: read `reference/spawning.md`.

## Answer a conformance finding

Trigger: `sf srs eval` reports a structural finding. It comes from the tree, not from what the user says, so read it from the report.

| Finding                         | Do                                                                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feature-without-version`       | The feature holds its FRs directly. Run `sf srs normalize --feature <page-url>`, read the dry run to the user, and rerun with `--apply` on their approval |
| `feature-without-frs`           | Ask whether it is a placeholder or a gap. Never normalize it: an empty version page is a level with nothing under it                                      |
| `version-without-frs`           | Show it to the user: the walk cannot tell an empty version from a page that is not a version, because the level is read from position                     |
| `unexpected-page-under-version` | Rename it to the FR convention or move it out; it is excluded from every score until then                                                                 |
| `fr-at-root-level`              | Move it under a feature; `spawn` cannot reach it                                                                                                          |
| `nesting-too-deep`              | Flatten it: the FRs it hides are invisible to every score                                                                                                 |

`normalize` writes nothing without `--apply`. Normalize one feature at a time (`--feature`), not a 196-page sweep, so a failure is small and legible. Pages are moved, not recreated: ids, URLs, bodies
and comments survive, so every link into the SRS keeps working. Done when a new `sf srs eval` no longer reports the finding.

## Evaluate freshness

Trigger: the user asks whether the SRS still matches the code, or wants drift scored.

Run `sf srs eval` (`--path <dir>`, `--root-page <id>`, `--threshold <pct>`, `--json`). Exit 0: the overall score is at or above the threshold (80 by default), or there is no FR to evaluate. Exit 1:
below it, which is drift. Done when you have reported the overall score and each drift finding to the user.

Interpreting the findings, the matcher layers or a `--review-packet`: read `reference/freshness-eval.md`.

## Conversational eval hook

Trigger: `tools.srs.enabled` is true and a turn reads like a new requirement (UR, FR, DS, TC, NFR) or a revision of an existing FR. A `UserPromptSubmit` hook may remind you of this section; it acts on
nothing.

1. Load the rules once per session with `scripts/detect-eval-signals.sh --rules`: the detection rules and the patch shape, as JSON. `--classify "<text>"` (or stdin) is a cheap prefilter that returns
   `{signal, confidence, target}`; the call stays yours.
2. Propose once per conversation turn at most: show the diff in plain text and wait for `accept / edit / reject`.
3. On accept, pipe the patch through `sf srs apply-update`. A UR / DS / TC / NFR is added; an FR is added or changed in place. An `add-*` patch lands where `write` puts it: in the feature's tables,
   with the version of the target page, and an FR also in the version's FR table and change list. Only a page outside the SRS, or a missing table, falls back to an "Added …" heading at the end of the
   page; the result's `placed` and `notPlaced` say which.
4. A revision of an FR (its description reworded, a criterion added or dropped, its priority moved) is an `update-fr` patch, applied where the FR is listed and never appended as a design item:

   ```json
   {
     "kind": "update-fr",
     "frId": "FR-AEX-014",
     "changes": { "description": "Routes by the cost of delivering a ticket, duration included." },
     "change": "Amends FR-AEX-014 — cost per delivered ticket"
   }
   ```

   Run `sf srs apply-update --dry-run` first, with the patch from `--patch <path>` or stdin: it prints the old → new plan and writes nothing. Show it to the user and apply only on accept.

Done when `apply-update` exits 0 and `placed` says where the change landed.

An `update-fr` patch is refused or stops midway, or the user wants the reminders silenced: read `reference/conversational-hook.md`.

## Templates

- Before authoring an Epic, Story, Task or Issue body, skim the matching file under [`templates/tickets/examples/`](templates/tickets/examples/) (`epic.md`, `story.md`, `task.md`, `issue.md`). Each
  opens with a `<!-- Why this example -->` preamble that names its pattern and the anti-patterns to avoid. Import the pattern (tone, section density, title convention), not the fictional content.
- You need the sections of a written page or a spawned ticket body: read [`templates/pages/README.md`](templates/pages/README.md) or [`templates/tickets/README.md`](templates/tickets/README.md).

## Where this sits in the zero-to-project flow

This skill carries phase 4, _write the SRS_, of the flow a user walks when they arrive with a POC and no project. `tool-saasfoundry` holds the map under "The zero-to-project flow". Phase 4 starts from
a manifest that declares the backend and from the intake record of the challenge phase, and ends when pages exist under the SRS root page. It never runs before phase 3, which creates the manifest.

On a resumed session, run `tool-saasfoundry`'s `scripts/recap.sh` before assuming anything: it reads the phase from the manifest and the board, never from chat history.
