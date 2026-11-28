# Skill check

The before/after behaviour check of the agent-facing documents (#1096): the skills, the generated `AGENTS.md` region and the status documents. The writing standard it enforces is at the top of
[`.claude/docs/architecture-skills.md`](../../.claude/docs/architecture-skills.md). This folder is not shipped in the npm package.

A change that slims a skill must show two things: **nothing a guard or a spec relies on was lost** (Layer 1, deterministic, in CI) and **an agent still does the same thing** (Layer 2, a model, run by
a session).

## Layer 1: the rule ledger (no model)

```bash
npm run skill:check                                    # what CI runs: node tests/skill-check/run.mjs check
node tests/skill-check/run.mjs check --only sf-workflow --json
node tests/skill-check/run.mjs metrics                 # bytes and lines per skill and surface
node tests/skill-check/run.mjs metrics --generated     # also generate projects and size what they receive (needs `npm run build`)
node tests/skill-check/run.mjs validate                # the data files against schema.json
```

It reads three kinds of data and fails with a code that names the cause:

| Code                                                               | What broke                                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `TOKEN_MISSING`                                                    | A ledgered rule lost a token (a command, a flag, a heading, a label) in the file that owns it                |
| `TOKEN_DUPLICATED`                                                 | A rule marked `unique` has a token in a second file: its single source is no longer single                   |
| `OWNER_MISSING`, `REGION_MISSING`                                  | The file (or the generated region) that owns a rule is gone                                                  |
| `TIER_MISPLACED`, `POINTER_MISSING`, `POINTER_NOT_LEADING`         | A disclosed rule sits in the entry file, nothing points at it, or the pointer does not open with its trigger |
| `LINK_BROKEN`, `KNOWN_LINK_FIXED`                                  | A relative link resolves to nothing, or a link the ledger lists as broken works now                          |
| `CEILING_EXCEEDED`, `CEILING_MISSING`, `CEILING_STALE`             | A surface is over its byte ceiling, has none, or a ceiling names a file that is gone                         |
| `LEDGER_MISSING`, `LEDGER_UNKNOWN`, `VIEW_MISSING`, `VIEW_UNKNOWN` | The data and the tree disagree                                                                               |

### The data

| File                     | Holds                                                                                                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills.json`            | Each skill and its **views**: one tree of files per surface (`template`, `repo`, `agents`; for `sf-workflow` `template:solo` and `template:team`, which rename `statuses-solo/` to `statuses/`) |
| `ledger/<skill>.json`    | The rules. Each has an `owner` (a file, in the layout of a generated project), a `tier` (`step`, `reference`, `disclosed`), `tokens`, and what makes it real (`source`)                         |
| `budgets.json`           | Byte ceilings per skill and surface: the entry file, the whole, the files over 4 KiB. Rounded up to the next KB, taken on the commit it records                                                 |
| `scenarios/<skill>.json` | The replay scenarios (Layer 2)                                                                                                                                                                  |
| `fixtures.json`          | How the disposable projects of the replay are generated                                                                                                                                         |
| `replay.json`            | The prompt every scenario shares, the tokens no scenario may plan, the tools an agent gets                                                                                                      |
| `schema.json`            | The shape of all of the above                                                                                                                                                                   |
| `baseline/`              | Recorded results: `metrics.json` (Layer 1) and the replay results                                                                                                                               |

A ledger holds **tokens and incident numbers, never a copy of a rule's text**: a second copy of the rules is exactly what the standard removes. Whitespace is collapsed before matching, so a token that
a 200-column wrap splits across two lines still matches.

### Changing a skill

1. Move, reword or delete a section.
2. If a ledgered rule moved, change its `owner` (and its `tier` and `pointer` when it is now disclosed). If its wording changed, keep the tokens a guard or a spec relies on. If it is gone, mark it
   `"retired": { "reason": "...", "by": "#N" }`: the reason is mandatory.
3. Lower the ceiling: `node tests/skill-check/run.mjs metrics --write-budgets`. A ceiling only goes down; `--allow-raise` raises one, and the pull request says why.
4. `npm run skill:check`, then Layer 2 for the skill (below).

A new skill needs an entry in `skills.json`, a ledger, scenarios with a core one, and ceilings (`validate` says what is missing).

## Layer 2: plan-only agent replay (a model; a session runs it, never CI)

A scenario puts a situation to a real agent that has **read-only tools** and stands in a **disposable generated project**. The agent reads what it would read and answers with the commands it would
run. Nothing is executed. What is compared before and after a change: the files it read, the commands it planned in order, and the forbidden tokens among them.

```bash
npm run build                                            # the fixtures are generated by this checkout's own CLI
node tests/skill-check/run.mjs list                      # the scenarios (* = core: runs on every child ticket)
node tests/skill-check/run.mjs run --runner claude --all --plan     # how many model runs, and stop
node tests/skill-check/run.mjs run --runner claude --core --dry-run # the invocation and its environment, and stop
```

Pass rule: a scenario runs 3 times and passes at 2 of 3; a forbidden token fails it on any run. A noisy run is evidence, not a gate.

### The baseline on `develop`

The baseline is taken on a checkout whose skills are those of `develop`, with a login for each agent, and it spends tokens: **156 model runs** in all, 123 for Claude Code (41 scenarios) and 33 for
Codex (the 7 region scenarios and one core scenario per projected skill).

**Claude Code: recorded**, in `baseline/claude-code.json`. Skills of `develop` at `bdfb1f12`, model `claude-sonnet-5-5`, 41 scenarios of 3 runs each, 41 of 41 passing. It ran with
`--agent-home inherit`: the login of the developer's subscription lives in their real `HOME`. Two runs make it, and its `meta.sources` says which and why: the full run (123 runs on `17186102`), and a
rerun of the 6 scenarios whose expectations were recalibrated afterwards (18 runs on `a7743759`), which replaces them, since in each the agent was right and the check was wrong. In all 141 runs were
paid for, 21.60 USD; the 123 runs the file keeps cost 19.43 USD. Each scenario records the commit it ran on (`ranOn`) and every run records the agent's answer.

**Codex: not measured yet.** Codex logs in with the developer's subscription, a login stored in the real `HOME` (`~/.codex/auth.json`). It can only reach the replay through `--agent-home inherit`, and
Codex's read-only sandbox can read any file its process can, so that login would weaken the isolation the replay promises (nothing but the fixture, no credential). Whether to accept that, or to give
Codex an API key (`OPENAI_API_KEY` or `CODEX_API_KEY`) instead, is a decision that is still pending. Until it is made there is no Codex baseline, and `compare` has nothing to compare a Codex run to.

```bash
# Claude Code, to take the baseline again (the model of the build tier's route is recorded in the results)
node tests/skill-check/run.mjs run --runner claude --all --repeat 3 --model <model> --label "develop <sha>" --confirm --out tests/skill-check/baseline/claude-code.json
# Codex, once the login is decided
node tests/skill-check/run.mjs run --runner codex --all --repeat 3 --model <model> --label "develop <sha>" --confirm --out tests/skill-check/baseline/codex.json
```

The baseline is taken again when the model changes. When a scenario's expectations are recalibrated, rerun only that scenario and merge the rerun into the full run: the merged file says which
scenarios came from the rerun, why, and what both runs cost. It refuses runs of another kind (runner, host, repeat) and a reason left out.

```bash
node tests/skill-check/run.mjs run --runner claude --scenario <id>,<id> --repeat 3 --confirm --out /tmp/rerun.json
node tests/skill-check/run.mjs merge tests/skill-check/baseline/claude-code.json /tmp/rerun.json --out tests/skill-check/baseline/claude-code.json --reason "Recalibration in <sha>: <what was wrong with the check>"
```

A child ticket runs the core scenarios of the skill it changes, before and after, and compares:

```bash
node tests/skill-check/run.mjs run --runner claude --core --skill sf-workflow --repeat 3 --confirm --out /tmp/after.json
node tests/skill-check/run.mjs compare tests/skill-check/baseline/claude-code.json /tmp/after.json   # exit 1: a regression or a new forbidden token
```

### What an agent is given

- **Tools.** Claude Code: `Read`, `Glob`, `Grep` and `Skill`, with `Bash`, `Edit`, `Write`, web access and sub-agents removed, `--permission-mode dontAsk` (a read outside the project folder needs a
  permission, which that mode refuses), reads outside the working directory blocked by setting, the credential paths denied (below), no MCP server, no hook, no saved session. Codex:
  `--sandbox read-only`, `--ephemeral`, `--ignore-user-config`.
- **A project of its own.** Generated into a temporary folder by `bin/sf.js` with a scratch `HOME`, an `npm` that does nothing (no dependency is installed, no network is needed), and every `.env` file
  removed afterwards. The `harness-srs` project declares a Notion SRS directly in its manifest: no token exists, and the replay only plans. The `dogfood` project copies the _tracked_ harness files of
  this repository, never an untracked file.
- **An allowlisted environment.** `PATH`, `LANG`, `TERM`, `TMPDIR`, a scratch `HOME`, and the one variable each agent reads to log in (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` or
  `ANTHROPIC_AUTH_TOKEN` for Claude Code; `OPENAI_API_KEY` or `CODEX_API_KEY` for Codex). No `GH_TOKEN`, no `SF_PROJECTS_TOKEN`, no Notion, Jira or Linear token. `--dry-run` prints exactly this.
- A login kept in your real `HOME` (a keychain item, `~/.codex/auth.json`) is out of reach by default. `--agent-home inherit` hands it over and says so.

### What `--agent-home inherit` exposes, and what stays blocked

`--agent-home inherit` sets the agent's `HOME` to yours, so Claude Code finds the login of your subscription there and no token has to be generated. What the agent's tools can reach does not change
with it (#1360):

- **Reads outside the fixture are refused.** Claude Code runs with `--settings '{"disableAllHooks":true,"permissions":{"blockReadsOutsideWorkingDirectories":true}}'` and `--permission-mode dontAsk`:
  its file tools refuse any path outside the fixture folder, in either mode.
- **The credential paths are denied by name**, on top of that, in both modes. `replay.json` → `deniedReadPaths` lists them: `~/.ssh/**`, `~/.aws/**`, `~/.gnupg/**`, `~/.config/**`, `~/.netrc`,
  `~/.npmrc`, `~/.docker/**`, `~/.kube/**`, `~/Library/Keychains/**`, `~/.git-credentials`, `~/.pgpass`, `~/.claude.json`, `~/.claude/.credentials.json`, `~/.codex/**`, and every `.env` and `.env.*`
  file (`**/.env`, `**/.env.*` in the fixture, `//**/.env`, `//**/.env.*` anywhere). Each becomes a `Read(<path>)` rule of `--disallowedTools`, one argument per rule. Claude Code applies a `Read` deny
  rule to Read and to the folder Glob and Grep search; a `Glob(<path>)` or `Grep(<path>)` rule is accepted but never matched, so none is written (Claude Code docs, "Configure permissions" → "Read and
  Edit"). With a scratch `HOME`, `~` is the scratch folder, so the same paths of your real `HOME` are also denied by their absolute spelling (`Read(//Users/<you>/.ssh/**)`); `--dry-run` prints that
  spelling as `<real HOME>`.
- **Codex gets no deny rule.** Its read-only sandbox can read any file your user can, and the runner names no path it may not read. Codex's beta permission profiles can deny reads
  (`permissions.<name>.filesystem` with `"deny"`), but they are selected with `default_permissions`, which does not combine with the `--sandbox read-only` the runner relies on, and no Codex run has
  been measured to check them. Until that is decided, do not run Codex with `--agent-home inherit`.

What a run does with what the agent touched:

- **A read outside the fixture flags the run.** Every path an agent read, and every folder it pointed Glob or Grep at, is checked against its fixture folder. A path outside it is recorded in the run's
  `outsideReads` (with `errored: true` when the tool call came back as an error, a refusal included), counted in `outsideRuns` per scenario and in the totals, printed as an `OUTSIDE` line, and the run
  exits 1. Read the run's answer before trusting it: a prompt injection in a fixture or a skill shows up here first.
- **Results never hold a path of the machine.** `run` and `merge` rewrite every absolute path before they write: the fixture becomes `<fixture>`, the run's scratch folder `<scratch>`, a temporary
  folder `<tmp>`, this checkout `<repo>`, and your `HOME`, or any `/Users/<name>` or `/home/<name>`, `~`. `validate` (and the spec) refuse a file under `baseline/` that still holds `/Users/`, `/home/`
  or `/private/var/folders/`; `node tests/skill-check/run.mjs redact <file> --out <file>` rewrites one recorded before #1360.

None of this stops what the model is told. Whatever the agent reads inside its fixture goes to the model and into the results file, so a fixture never holds a real secret: the generation removes every
`.env` file and the `dogfood` copy takes tracked files only.

### Writing a scenario

A scenario states a situation with every fact the agent needs (ticket number, labels, what is already done), the fixture it runs in, and what must hold:

- `reads`: path fragments the agent must have read (an inner array is an any-of);
- `commands`: planned commands that must appear, **in this order**; a step is a string, a `/regex/`, or `{ all, any, none }`;
- `includes`: planned commands that must appear, in any order;
- `forbidden`: tokens no planned command may contain, on top of the global list in `replay.json` (escape hatches, `--skip-local-ci`, raw GraphQL, `gh pr ready`, a chained line, another agent's CLI);
- `answer`: words the prose after the plan must, or must not, hold;
- `oneOf`: two or more accepted outcomes (`commands`, `includes`, `answer`), of which a run must satisfy at least one. For a situation whose right move is either a command or a question to the
  developer: the shared prompt lets a plan stay empty when the right move is to ask first.

The results keep the prose of each run's answer (`answer`, plan block removed, cut at 4,000 characters), so a failed scenario can be read, and a scenario that fails because the agent stopped to ask
can be told from one that did the wrong thing.

Keep the expectations to the **essential** commands: a scenario that pins an incidental flag fails for a harmless rewording and teaches nothing. Do not tune a prompt to make a scenario pass: the point
is to see what the skill leads an agent to do.

`--runner fake --fake-responses <file>` answers from a file instead of a model: it is how the runner, the scoring and `compare` are tested (`src/__tests__/unit/skill/skill-check-ledger.spec.ts`).

## What this does not tell you

- A plan is not an execution. The guards stay covered by their own CLI specs.
- Three runs of a model are a sample. A scenario at 2 of 3 can hide a rate of 50%.
- The Claude Code runner uses the documented flags of `claude -p --output-format stream-json`; the Codex runner reads the final message from `--output-last-message` and guesses the files it read from
  the paths in its shell commands, because the JSON event shapes of `codex exec --json` are not documented. Neither has been run by the author of this tool. If a first replay reads no file or no
  answer, save the agent's stream and run `node tests/skill-check/run.mjs parse --runner claude --file <stream>` (or `--runner codex`) to see what the runner takes from it.
- Kimi Code is not run (decision D3 of #1096): the scenarios name the hosts `claude-code` and `codex`, and the replay has a runner for each.
