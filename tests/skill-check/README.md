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

### Recording the baseline on `develop`

The baseline is taken on a checkout whose skills are those of `develop` (this branch, before any child of #1095 lands, or `develop` once it is merged). It needs a login for each agent, passed as the
variable that agent reads (below), and it spends tokens: **156 model runs**, 123 for Claude Code (41 scenarios) and 33 for Codex (the 7 region scenarios and one core scenario per projected skill).

```bash
node tests/skill-check/run.mjs run --runner claude --all --repeat 3 --model <the model of the build tier's route> --label "develop <sha>" --confirm --out tests/skill-check/baseline/claude-code.json
node tests/skill-check/run.mjs run --runner codex  --all --repeat 3 --model <the model of the build tier's route> --label "develop <sha>" --confirm --out tests/skill-check/baseline/codex.json
```

`--model` is recorded in the results, and the baseline is taken again when it changes. A child ticket runs the core scenarios of the skill it changes, before and after, and compares:

```bash
node tests/skill-check/run.mjs run --runner claude --core --skill sf-workflow --repeat 3 --confirm --out /tmp/after.json
node tests/skill-check/run.mjs compare tests/skill-check/baseline/claude-code.json /tmp/after.json   # exit 1: a regression or a new forbidden token
```

### What an agent is given

- **Tools.** Claude Code: `Read`, `Glob`, `Grep` and `Skill`, with `Bash`, `Edit`, `Write`, web access and sub-agents removed, `--permission-mode dontAsk` (a read outside the project folder needs a
  permission, which that mode refuses), no MCP server, no hook, no saved session. Codex: `--sandbox read-only`, `--ephemeral`, `--ignore-user-config`.
- **A project of its own.** Generated into a temporary folder by `bin/sf.js` with a scratch `HOME`, an `npm` that does nothing (no dependency is installed, no network is needed), and every `.env` file
  removed afterwards. The `harness-srs` project declares a Notion SRS directly in its manifest: no token exists, and the replay only plans. The `dogfood` project copies the _tracked_ harness files of
  this repository, never an untracked file.
- **An allowlisted environment.** `PATH`, `LANG`, `TERM`, `TMPDIR`, a scratch `HOME`, and the one variable each agent reads to log in (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` or
  `ANTHROPIC_AUTH_TOKEN` for Claude Code; `OPENAI_API_KEY` or `CODEX_API_KEY` for Codex). No `GH_TOKEN`, no `SF_PROJECTS_TOKEN`, no Notion, Jira or Linear token. `--dry-run` prints exactly this.
- A login kept in your real `HOME` (a keychain item, `~/.codex/auth.json`) is out of reach by default. `--agent-home inherit` hands it over, says so, and weakens the isolation: Codex's read-only
  sandbox can read any file the process can.

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
