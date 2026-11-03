# Changelog

All notable changes to SaaSFoundryAI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security

#### Generated projects: role scope isolation

- A role held in one account, or on one entity, no longer authorises an action on another account or entity. `PermissionsGuard` used to check an account or entity route against the union of every role
  the user holds, so an entity role, or an admin role of another account the user is only a member of, could pass account-admin checks: a seeded `entity-admin` could promote itself to account admin or
  deactivate any user of its account, and an admin of account B could change the status, users and roles of account A. Routes now declare the account or entity they act on with `@ScopeFrom`, and the
  guard counts only the assignments that apply to it (a `PLATFORM` assignment always; `ACCOUNT` roles of that account; `ENTITY` roles of that entity or an ancestor, and on the account routes an
  entity-admin reaches, `ENTITY` roles of the account). The services check each change in the scope it acts on: `PATCH /accounts/:id/users/:userId`, the role routes, `POST /invitations` and
  `POST /entities`. A custom role that carries a platform section no longer gives platform reach: `PLATFORM_ADMINISTRATION` routes count `PLATFORM` assignments only
  ([#1072](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1072)).
- The scope headers `X-Scope-Account-Id` and `X-Scope-Entity-Id` can no longer redirect a check away from the account or entity named in the URL, and the web application does not send them
  ([#1072](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1072)).
- After a token refresh the authenticated user now carries the same relations as after a plain login, so a read route that checks a section no longer fails on the first call after a refresh
  ([#1072](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1072)).

**Updating an existing project.** The fix is in blueprint files that no installer owns, so `sf update` applies it with the three-way merge: a file you did not edit is updated in place, and a file you
edited gets a `.saasfoundry.new` sidecar to merge by hand (`permissions.guard.ts`, `account.controller.ts`, `account.service.ts`, `entity.controller.ts`, `entity.service.ts`, `invitation.service.ts`,
`account-access.service.ts`, `jwt.strategy.ts`, `jwt-auth.guard.ts`). Three things change for code you wrote: `PermissionsGuard` takes `AccountAccessService` as a constructor dependency (the module is
global; add `AccountAccessModule` to the testing modules of your own e2e specs), a route that takes an account or entity id must declare it with `@ScopeFrom` or it keeps the union of every role, and
an unknown account or entity id still answers 404 while an existing one the user holds no role on answers 403. New per-target checks answer 403; the existing 401 checks keep their status.

## [1.1.0] - 2026-11-01

A feature release. Delegated ticket delivery is now routed by task kind, the agent instructions move to `AGENTS.md`, and an existing functional requirement can be changed in place. It also fixes the
spawn, pull request and workflow problems that real runs hit.

### Added

#### CLI

- `sf agents route --task <kind>` names the tier agent for a task kind (exploration, prose, scoped edit, bug fix, review, multi-file feature, tests, planning, terminal CI). The allocation grid ships
  with its evidence, and `modules.harness.routing` in the manifest can override it ([#930](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/930),
  [#1006](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1006), [#1007](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1007),
  [#1008](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1008)).
- Each declared coding agent receives one tier agent per routing tier (`sf-light`, `sf-edit`, `sf-build`, `sf-fix`, `sf-plan`, `sf-terminal`), with its own model and effort
  ([#929](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/929), [#1012](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1012),
  [#1013](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1013)). Each tier agent also lists the task kinds it does not serve, and a routing override naming an effort the host cannot express is
  refused instead of silently running at another effort ([#1011](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1011)).
- `sf agents delegation status|allow|decline` records whether background agents may build tickets, one worktree each. A clone can override the shared answer locally, and `sf status` shows the
  effective value ([#1041](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1041), [#1026](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1026)).
- Routed delegations are measured. `sf agents outcome record` and `sf agents outcome mark <ticket> rework|human-defect` keep a ledger of cost and verdict, and
  `sf agents routing adjust|promote|report|reset` moves a task kind between tiers within declared bounds, shows what changed and undoes it
  ([#1035](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1035), [#1050](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1050),
  [#1051](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1051), [#1052](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1052),
  [#1053](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1053), [#1067](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1067)).
- `sf status` reports the grid version, the overrides, the tier agents, the delegation consent and the routing state ([#933](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/933),
  [#1053](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1053)).
- `sf srs apply-update` accepts `update-fr`, which changes an existing functional requirement in place where it is listed. `--dry-run` prints the old-to-new plan and writes nothing
  ([#945](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/945), [#1058](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1058),
  [#1059](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1059)). When a conversation revises an existing requirement, the SRS evaluation rules now propose an `update-fr` patch instead of
  appending a new design item ([#1061](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1061)).
- `unlink-subtask` is available in the GitHub Projects CLI and the workflow CLI ([#1039](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1039)).
- AI Testing runs the project's declared local pipeline: `molten ci run` when the project declares it, the npm suite otherwise. `sf status` shows a `local-ci:` line
  ([#943](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/943)).

#### Harness and agent instructions

- `AGENTS.md` is the authoritative instruction file. A project still driven by `CLAUDE.md` is migrated to it, and the harness diagnostics report instruction shadowing, the Claude Code version and the
  Codex instruction size limit ([#936](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/936), [#937](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/937),
  [#938](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/938), [#939](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/939)).
- Skills are projected where each host looks for them. The registry records each host's skill directories, shared skills are copied only for hosts that read `.agents/skills`, and the copies keep the
  skill's code byte for byte ([#940](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/940), [#999](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/999),
  [#1000](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1000), [#1001](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1001)).
- The generated instructions have the session orchestrate delegated delivery. The conversation stays with the developer and hands each ticket to a background agent in its own worktree, on the tier its
  task kind names ([#1022](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1022), [#1042](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1042),
  [#1043](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1043)).
- `sf-workflow` names the task kinds and the rule for splitting a ticket between agents ([#1023](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1023)).

#### Workflow

- The AI Testing report uses the `## Test plan` and `## Test report` headings ([#1017](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1017)).
- The workflow escape hatches are catalogued in one reference, and the complexity profile schema is documented ([#261](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/261),
  [#260](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/260)).

### Changed

- `sf update` brings the delegation capture hooks and permissions into `.claude/settings.json` and keeps them current on every update. Instruction bridges left by 1.0.0 and 1.0.1 are recognised
  ([#935](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/935)).
- The README and the documentation home page describe routed delegation, and a new "Routed delegation" guide page (EN and FR) explains the grid, the tier agents, the consent, the measurement and the
  adjustment ([#1086](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1086)).

### Fixed

#### CLI and workflow

- `create-pr` and `ready-pr` accept a ticket worked from a host-named worktree branch, such as a Claude Code agent worktree ([#1036](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1036)).
- `pr-review-sync` no longer fails red on branches that name no ticket, such as release sync-back and `rc-*` branches ([#1016](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1016)). An early
  "Ready for review" click is reported as a notice, not a failing check ([#1003](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1003)).
- `github-projects-cli.sh list` returns every item of a board over 200 items, and its status filter sees all of them ([#1082](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1082)).
- Workflow scripts read the complexity profiles block by block and trace every escape hatch they use ([#961](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/961)).

#### SRS: `sf srs spawn`

- Spawn no longer recreates Stories already spawned under the Epic, and its dry-run shows them ([#1037](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1037),
  [#1038](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1038)).
- Tickets closed as not planned are ignored when a functional requirement is matched to its ticket ([#1046](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1046)).
- `--version` accepts a Notion page id written without dashes ([#927](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/927)).
- The per-requirement searches are batched, and the run waits out GitHub's search rate limit instead of failing on large versions ([#952](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/952)).

#### Generated projects

- Generated projects pass the production audit again: zod 4.6.7 (GHSA-mrhx-c7xc-m3w5) and, in the multirepo api lockfile, body-parser 2.4.0 (GHSA-27r3-jxmh-p828), and multer 2.5.0
  (GHSA-q7qp-rjg7-q26m) ([#1084](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1084), [#1088](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1088)).

#### Tooling

- The local CI passes from a path containing a space, keeps `dist/` whole during a build and keeps the lifecycle database alive through its startup probes
  ([#1082](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1082)).
- Re-running failed CI jobs keeps the lifecycle image artifact, and the profile transition spec gets a time budget on a loaded machine
  ([#891](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/891), [#892](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/892)).

## [1.0.1] - 2026-10-09

A maintenance release. It fixes what real projects hit after 1.0.0: `sf update` on customized projects, non-interactive harness setup, the SRS writer and spawner, workflow guards, and generated
Docker, CI and deployment files.

### Added

#### CLI

- `sf new` and `sf workflow use` accept `--project-url <url>` to attach an existing GitHub Projects board and `--create-board` to create one under the owner of the repository remote, without a prompt.
  A workflow left without a board is reported with the exact command to fix it ([#821](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/821)).
- `sf new` accepts `--working-branch` and `--pr-target-branch` (default `develop`), `sf workflow` gains `set-pr-target-branch`, and the setup reports the working branch it created, or the next step
  when the branch does not exist yet ([#822](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/822)).
- The Notion token for non-interactive setup can come from the `NOTION_API_TOKEN` environment variable or a saved `sf tools` account, so the secret no longer has to appear on the command line
  ([#823](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/823)).
- `sf --version` and `sf update` say when `sf` runs from a development checkout, and `sf update --dry-run --json` reports its `cliChannel`, so two machines no longer plan different updates without any
  hint why ([#859](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/859)).

#### Workflow

- `workflow-cli.sh bootstrap <ticket>` takes an empty repository through its first ticket: it makes the root commit on the main branch, creates the working branch, records the exception on the ticket
  and moves it to Done, with no bypass variable ([#833](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/833)).
- `github-projects-cli.sh create-ticket <story|task|issue> <title>` creates a top-level ticket on the board in Backlog, with its type, complexity, nature and milestone
  ([#832](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/832)).
- Local CI gate: a project declares the commit statuses its local CI publishes in `workflow.localCi.requiredStatuses`. `create-pr` (without `--draft`) and `ready-pr` refuse a head commit on which one
  is missing or red, and `--skip-local-ci "<reason>"` is the recorded escape hatch ([#918](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/918)).
- `workflow-cli.sh ai-status <ticket> <step> <pending|success|failure> "<description>"` shows the progress of AI Testing on the ticket's pull request, as a commit status and a single progress comment
  ([#883](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/883)).
- The milestone engine proposes a release made of several Epics as one `epic-union` candidate, united only through links the board can verify, with the evidence kept per Epic
  ([#561](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/561)).

#### SRS

- `sf srs next-ids --feature <page-url-or-id>` prints the next version number and the free requirement ids of a feature ([#919](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/919)).
- `sf srs apply-update` supports `add-nfr` ([#917](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/917)).
- `sf srs validate --spec <file>` checks a spec offline, before any page is written ([#877](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/877)).
- A functional requirement may state its `complexity`, and `sf srs spawn --complexity <level>` labels the Stories whose requirement states none
  ([#901](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/901)).

#### Skills and harness

- `sf new` and `sf update` add a `permissions.allow` list for the harness's own read-only commands to `.claude/settings.json`, so workflow steps stop asking for permission. The generated instructions
  also tell agents to edit files with the native file tools rather than interpreter heredocs ([#947](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/947)).

### Fixed

#### CLI: `sf new` and board creation

- `sf new --workflow <unknown>` is refused before any question and lists the valid presets, instead of dropping the value silently ([#895](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/895)).
- `--no-workflow` and `--workflow none` now skip the workflow step of an interactive `sf new` ([#896](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/896)).
- An interactive `sf new` takes `--tracker`, `--docs` and `--design` as answers, `none` included, and no longer asks the question again
  ([#914](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/914)).
- A project name containing a quote no longer breaks GitHub Project creation ([#897](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/897)).
- A machine without `gh` is told to install it, not to run `gh auth login` ([#898](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/898)).
- Boards auto-created on a personal account now get their Board view instead of ending with "Could not add the Board view" ([#913](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/913)).
- The documentation summary of `sf new` no longer prints a bullet with an empty label ([#890](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/890)).
- `sf srs spawn --version` is handed to the spawner; before, the global `--version` flag swallowed it, printed the CLI version and exited 0 without spawning
  ([#834](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/834)).
- `sf status` names the branch of a repository without commits (`main (no commits yet)`) instead of "detached" or "Branch unknown" ([#825](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/825)).
- `sf workflow validate` runs the manifest check directly and names a remedy for each issue, instead of reporting a validator skill that no version ships
  ([#824](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/824)).
- The harness guides name the real prerequisites: Node 22 and npm 10 for the CLI, Node 24 and npm 11 for the generated stack ([#826](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/826)).

#### CLI: `sf update`

- An update that ends with conflicts now reaches the new version: merging or discarding the `.saasfoundry.new` sidecars is the whole resolution, and the next run reports nothing, instead of
  conflicting again on every kept local edit ([#856](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/856)).
- Customizations are no longer overwritten by the next update: baselines are recorded from what the CLI generated, not from a sweep of the project's own files, so project sources no longer become
  tracked templates ([#879](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/879)).
- Generated code (orval clients, `openapi.json`, generated Prisma models) is no longer tracked as a template, so it stops conflicting on every update and is no longer deleted
  ([#874](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/874)).
- `sf update` no longer deletes the `sf-srs` skill scripts of a full-stack project with SRS ([#857](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/857)).
- Template files the new CLI no longer generates are removed again when still unmodified, and are listed in the plan, the dry-run report and the summary; a modified file is never removed
  ([#865](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/865)). An obsolete file that is kept stays tracked, so enabling the module that generates it again no longer stops on it
  ([#882](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/882)).
- The manifest migration rewrites `feature/{name}` and `fix/{name}` branch patterns so they name the ticket, which fixes In Review and Done being refused on migrated projects; the guards now say when
  no configured pattern can identify a ticket ([#864](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/864)).
- The published npm package now ships the three `.gitignore` templates, so `sf new` no longer generates a project without a `.gitignore` and `sf update` no longer deletes one
  ([#875](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/875)).
- Regenerated `package.json` files keep their description and no longer point at the CLI's repository ([#858](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/858)).
- A monorepo no longer keeps a second `.claude/` in each app with a duplicate `SessionStart` hook; the harness migration removes the copy when it is unmodified and reports any file you edited
  ([#425](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/425)).

#### Workflow: guards, pull requests, milestones

- The complexity guard accepts an `srs:drafting`, `srs:update` or `srs:new` label, so SRS drafting tickets can enter In progress without an arbitrary complexity label
  ([#851](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/851)), and it no longer blocks status updates on Epics ([#839](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/839)).
- The Epic roll-up follows the statuses of the project's workflow, so a Solo Epic moves straight to In progress instead of failing on a Ready status it does not have
  ([#838](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/838)).
- Moving a ticket to Done closes its GitHub issue when the board's automation has not, and fails naming the issue if it stays open; this covers drafting tickets closed by `transition-drafting done`
  ([#920](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/920)).
- Workflow scripts pin `gh` to the `origin` repository, so an `upstream` remote in a fork no longer retargets ticket and pull request commands to the original project; `sf status` reports when a bare
  `gh` call would miss `origin` ([#840](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/840)).
- In the Solo workflow, merging a pull request into the working branch now moves its ticket to Done and closes the issue, as the In Review banner promises
  ([#845](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/845)).
- `pr-review-sync` also reacts to pull requests opened ready for review, so `create-pr` without `--draft` no longer leaves the ticket in AI Testing
  ([#876](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/876)), and a refused event now names the first condition it failed, such as a missing `Resolves #N` line
  ([#846](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/846)).
- `milestone assign` takes one issue number and prints success only for what GitHub confirms, instead of patching the first number of a list and reporting all of them
  ([#562](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/562)).
- `create-subtask` puts the child on its parent's milestone, or the one `--milestone` names, and says so ([#617](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/617)).
- The milestone engine sees a finished Epic and names every Epic it sets aside, so a release no longer disappears at the moment it is ready to cut
  ([#560](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/560)).

#### SRS: `sf srs write`, `spawn`, `apply-update`

- `sf srs write` and the other SRS actions refuse an unknown option with exit code 2 before anything is written; `--dry-run`, which does not exist, used to be ignored and created a full duplicate tree
  ([#877](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/877)).
- A feature's `businessValue` and `scope` are rendered on its page ([#843](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/843)).
- The feature page shows DS descriptions and lists the FRs related to each UR ([#850](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/850)).
- A new version can be written under a feature created in an earlier batch, by naming the feature page in `epic.parentId` ([#899](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/899)).
- The UR, DS, TC and NFR items carried by FR candidates and versions are listed in the feature's tables instead of being dropped silently
  ([#900](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/900)).
- An FR added to an existing version appears in the version's FR table and change list and in the feature's tables, and `apply-update` puts its additions in those tables rather than under "Added …"
  headings ([#917](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/917)).
- A version title or requirement id that already exists under the feature is refused before any write, so two sessions can no longer produce duplicate versions and ids
  ([#919](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/919)).
- An FR whose acceptance criteria exceed Notion's 2000-character limit in a table cell is written, split across several text objects
  ([#916](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/916)).
- `sf srs spawn` adds the Epic and Stories to the project board in Backlog ([#836](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/836)), fills their bodies from the FR and version pages: user
  requirements, acceptance criteria, business value, scope ([#837](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/837)), and labels the Stories with the complexity their FR states
  ([#901](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/901)).
- `spawn --reconciliation-plan` works when spawn creates the version Epic itself, and the Epic owns the Stories instead of the drafting ticket
  ([#855](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/855)).
- `transition-drafting <N> ai-draft` no longer fails in every project: it prints the drafting procedure, or writes a drafted spec with `--spec <file>`
  ([#849](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/849)).
- `srs-cli.sh` finds a globally installed CLI (`npm i -g saasfoundryai-cli`) ([#835](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/835)).

#### Skills and harness

- The `.agents` skill projection no longer corrupts inline code ending in `!` ([#903](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/903)).
- Codex receives the complete shared skills, including `sf-srs` and the workflow status documents ([#828](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/828)).
- `sf-srs`, `sf-workflow`, `sf-tool-github-projects` and the Jira, Linear and Notion tool skills declare a frontmatter description, so agents discover them by their trigger keywords
  ([#829](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/829)).
- A harness without SRS no longer registers the `UserPromptSubmit` hook that points to a missing script ([#827](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/827)), and no longer installs
  `sf-integration-rules`, which targets the generated NestJS/React stack ([#831](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/831)).
- `sf-git-commit` and `sf-git-fix-pr-comments` commit in the format the manifest declares (`workflow.commitFormat`) ([#830](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/830));
  `sf-git-create-pr` targets `workflow.prTargetBranch`, `sf-utils-fix-errors` no longer speaks pnpm, and `sf-git-merge` is limited to rebasing the ticket branch
  ([#430](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/430)).
- The `.claude/README.md` and `CLAUDE.md` templates list only skills that exist ([#425](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/425)).
- `sf-integration-rules` documents the RBAC v2 scopes, the administration routes and the direct-call-or-wrapper hook table ([#432](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/432)).
- The Figma tool skill no longer ships private team and project IDs, and the `sf-srs` installer warns when a script cannot be made executable
  ([#433](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/433)).
- `read-project.sh` of the `sf-tool-saasfoundry` skill works again with the catalogue returned by `sf modules list --json` ([#866](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/866)).

#### Generated application: Docker, CI, deployment, branding

- The generated production Dockerfiles and deployment run: Prisma generation with the multi-file schema, workspace packages copied, the right start path, working health checks, a writable log
  directory, an nginx that follows API redeploys, and deployment workflows that no longer target a Synology NAS ([#861](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/861)).
- Dockerfiles build on the Node version `.nvmrc` declares, so `npm ci` no longer fails on the npm 11 requirement inside `docker build`
  ([#860](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/860)).
- Deployment workflows wait for the tests of the pushed commit and deploy only when they pass ([#889](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/889)).
- A monorepo deployment now receives the MailerSend configuration in its server `.env` ([#888](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/888)).
- Generated applications name the project, not SaaSFoundryAI, in their emails, browser tab, header and logo placeholder, through `APP_NAME` and `VITE_APP_NAME`
  ([#886](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/886)), and in the OpenAPI title, description and contact, which no longer carry the CLI author's address
  ([#884](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/884)).
- `@prisma/adapter-pg` is aligned with `prisma` and `@prisma/client` ([#862](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/862)).
- With the storage module, the generated `organization.service.spec.ts` passes the project's own lint ([#863](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/863)).
- The generated required CI gate is exposed from the start of a run, so a draft run's success no longer satisfies a ruleset while the ready run is still validating
  ([#847](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/847)).
- Generated workflows use Node.js 24 action releases pinned by commit, ending the deprecation warnings ([#848](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/848)).
- The generated impact validation passes its own format check and no longer runs the end-to-end suite on almost every commit ([#867](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/867)).

#### Tooling

- Commit validation in the CLI repository checks only what a commit touches and keeps Docker out of the pre-commit hook ([#852](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/852),
  [#878](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/878)).
- The lifecycle test lane retries `npm ci` on a registry network reset instead of failing ([#908](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/908)).

## [1.0.0] - 2026-09-27

### Added

#### CLI commands

- **`sf modules`** ([#60](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/60)) — `list`, `info`, and `match` catalogued modules (email, storage, analytics) with weighted keyword scoring.
- **`sf skill`** ([#61](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/61)) — `install`, `update`, `uninstall` skill bundles; `sf uninstall --all` for full cleanup. Includes stale-version
  detection and per-bundle `.version` manifests.
- **`sf feedback`** ([#62](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/62)) — `request` new modules, `bug` to report issues, `list` community requests, `vote` with 👍 / 👎 / comment.
  Deduplication and preference tracking built in.
- **`sf tools`** — manage multi-account credentials for Atlassian, Notion, Figma, and other external services.

#### Non-interactive mode

- `sf new --non-interactive` with full flag surface for scripted scaffolding ([#58](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/58)).
- `sf update` flags: `--dry-run`, `--conflict-strategy theirs|ours|manual`, `--accept-template-updates` ([#59](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/59)).

#### Workflow system

- Two end-to-end guarded presets: Team with seven statuses and Solo with five; projects can also create, save, and reuse Custom status templates as an advanced extension point.
- 4 complexity levels (bug / low / medium / complex) with adaptive ceremony — analyze depth, plan approval gates, adversarial review for complex tickets.
- Complete GitHub Projects workflow adapter; experimental Jira and Linear adapters; complete Notion SRS backend without claiming it as a full workflow tracker.
- GitHub Projects CLI helper (`github-projects-cli.sh`) with sub-issue linking via GraphQL.
- Workflow enforcement: subtask closure as you go + parent-transition gating ([#79](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/79)).

#### Skills ecosystem

- **`sf-workflow`** — one complexity-adaptive workflow skill replaces the former split workflow variants.
- **`sf-tool-saasfoundry`** ([#18](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/18)) — catalogue-aware anti-reinvention guardrails, feedback orchestration, and discovery helpers for `sf new`
  / `sf update`.
- Module catalogue schema with enriched metadata ([#60](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/60)).
- Project awareness helper (`read-project.sh`) for skill consumers ([#106](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/106)).
- Anti-reinvention scoring that classifies user intent against the catalogue ([#123](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/123)).

#### Infrastructure

- Impact-aware local and GitHub validation for SaaSFoundryAI and generated monorepo/multirepo projects, with a conservative full fallback and one stable required gate
  ([#797](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/797)).
- Split pre-commit / pre-push checks for fast local feedback and explicit Docker validation during AI testing ([#33](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/33)).
- Codecov integration with coverage badge in README ([#33](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/33)).
- On-disk project schema cache with `cache-clear` escape hatch ([#137](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/137)).
- Scaffolded GitHub Projects CLI sync + drift guard ([#138](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/138)).

### Changed

- Workflow configuration consolidated in `.saasfoundry.json` (previously split with the deprecated `.saasfoundry-workflow.json`).
- `getAvailableModules` now routes through the module catalogue for enriched metadata ([#60](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/60)).

### Fixed

- Generalize non-interactive missing-values error message ([#59](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/59)).
- `_cache_fresh` now branches on `OSTYPE` so GNU `stat` returns the right field ([#135](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/135)).

## [1.0.0-beta]

Initial beta release. The generator scaffolds production-ready SaaS projects with:

- **Backend**: NestJS 11 + Prisma 7 (driver adapters) + PostgreSQL 16 + JWT + Passport + Zod 4.
- **Frontend**: React 19 + React Router v7 + Vite 7 + TailwindCSS 4 + Radix UI (unified) + ShadCN UI + React Query + React Hook Form + Zod 4 + i18next.
- **Infra**: Docker multi-stage builds + Nginx + dedicated `saasfoundry-network`.
- **Topologies**: monorepo and multirepo.
- **Optional modules**: email (MailerSend), storage (S3), analytics (Umami).
