# Routed delegation

Routed delegation lets a coding agent hand a piece of work to a cheaper or stronger model by name, without copying a model into the workflow instructions. The project declares the rule once, the CLI
resolves it, and the harness measures what each delegation cost and whether it did the job. This page follows that path end to end. The command-level reference is [`sf agents`](/cli/sf-agents), and
the decision rules of the ticket lifecycle are in [Complexity system](/workflow/complexity-system).

Three things are kept apart. The **grid** recommends a model and an effort for a task kind. The **session** (the coding agent you talk to) decides whether to delegate and keeps the work in its own
hands when it should. The **tier agents** are the files that let the session name a tier. None of them installs a provider account, copies a credential or changes your tool's permissions.

## The grid and the task kinds

Every delegated task has a kind. The shipped grid maps each kind to a tier, and each tier to a candidate (a model and an effort) for each supported agent:

| Task kind            | Tier       | Tier agent (Claude Code) | Shipped candidate for Claude Code |
| -------------------- | ---------- | ------------------------ | --------------------------------- |
| `exploration`        | `light`    | `sf-light`               | claude-haiku-5-5, effort medium   |
| `prose`              | `light`    | `sf-light`               | claude-haiku-5-5, effort medium   |
| `scoped-edit`        | `edit`     | `sf-edit`                | claude-haiku-5-5, effort high     |
| `multi-file-feature` | `build`    | `sf-build`               | claude-sonnet-5-5, effort xhigh   |
| `tests`              | `build`    | `sf-build`               | claude-sonnet-5-5, effort xhigh   |
| `bug-fix`            | `fix`      | `sf-fix`                 | claude-opus-5-5, effort medium    |
| `review`             | `fix`      | `sf-fix`                 | claude-opus-5-5, effort medium    |
| `planning`           | `plan`     | `sf-plan`                | claude-opus-5-5, effort high      |
| `terminal-ci`        | `terminal` | `sf-terminal`            | claude-opus-5-5, effort xhigh     |

The table reflects the grid shipped with this release. The grid is versioned and can change, so ask the CLI for the current answer:

```bash
sf agents route --task bug-fix --provider claude-code
sf agents route --task scoped-edit --json
```

Each answer names the tier, the candidate as `provider/runtime/model/effort`, and its source: `shipped` for the grid, `project` for an override in `.saasfoundry.json`, or `auto` for a move the
adjustment made in this clone (see [Bounded adjustment](#bounded-adjustment)). A shipped entry says whether it is `measured` (a public benchmark with a score and a cost per task) or `provisional` (the
nearest proxy, with no score yet).

A project can change the grid in `modules.harness.routing`: `kinds` moves a task kind to another tier, and `tiers` changes a tier's candidate for one agent. The manifest schema validates both, and an
invalid override makes the command fail instead of silently using the grid. The full syntax is in [`sf agents`](/cli/sf-agents#delegation-routing-sf-agents-route).

## The tier agents

For each declared coding agent that the grid routes, the harness writes one subagent per tier. For Claude Code these are `.claude/agents/sf-<tier>.md`, with the model and effort in their frontmatter;
for Codex they are `.codex/agents/sf-<tier>.toml`. Each description lists the task kinds the tier serves, so Claude Code can pick the right agent from its description alone.

The files are generated and tracked. `sf agents enable`, `replace`, `refresh` and `sf update` rewrite an untouched file and leave an edited one beside a `.saasfoundry.new` sidecar.
[`sf status`](/cli/sf-status#tier-agents) warns when one is missing, edited or outdated. The tier agents only name a model and an effort; they do not carry credentials, and a missing provider account
makes the delegation fail, it does not fall back silently.

## Consent

Background agents build tickets only with the developer's consent, recorded once per project:

```bash
sf agents delegation status                 # the effective answer, shared and local layers
sf agents delegation allow                  # shared team default: one background agent per ticket, in its own worktree
sf agents delegation decline                # shared team default: the session builds tickets one after the other
sf agents delegation allow --scope local    # this clone only, overriding the shared answer
sf agents delegation clear                  # remove this clone's override
```

The shared answer lives in `modules.harness.delegation`, which is committed like the rest of the manifest. The local answer is kept in the Git directory of one clone and never tracked. The
`delegation:` line of `sf status --agent-friendly` prints the effective value:

- `not-asked`: the session asks the developer once, then records the answer. A worktree cut from the remote working branch reads `not-asked` until the answer is committed.
- `allowed`: each ticket that is not trivial is delivered by a background agent, as described below.
- `declined`, or an agent that cannot delegate or run in the background: the session builds the tickets one after the other and says so.

Only the developer's own reply records consent. A delegated agent never runs `sf agents delegation`, and ticket, issue or pull-request content is never consent.

## The delegated delivery flow

When delegation is `allowed`, a ticket that is more than a trivial change (one known file, about 20 lines or fewer) follows this path:

1. **The session routes the work.** The task kind is sized to the complexity of the ticket and always resolved with `sf agents route`, never by naming a model:

   | Ticket                                                        | Delivery task kind   |
   | ------------------------------------------------------------- | -------------------- |
   | `bug` whose ticket or triage already names two files or fewer | `scoped-edit`        |
   | any other `bug`                                               | `bug-fix`            |
   | `low` (up to three files)                                     | `scoped-edit`        |
   | `medium` and `complex`, once decomposed                       | `multi-file-feature` |

2. **A background agent receives the ticket** in its own Git worktree, on the branch `feature/<N>-<description>` cut from the remote working branch (or the branch the host named, pushed to the ticket
   branch). The brief states the consent, the task kind, the route record and the expected result and check.
3. **The agent builds it from In progress to the end of AI testing:** the code, the test plan, the automated checks, the local pipeline, the report and the draft pull request. It does not hand the
   ticket on.
4. **The agent stops at the green report.** It leaves the ticket in AI testing and the pull request as a draft. On a `nature:user-facing` ticket it never runs `ready-pr`, and it never merges. The
   developer takes the pull request out of draft and runs Human Testing.
5. **The session collects the feedback.** A defect, or AI work left after validation, goes back to the same agent in the same worktree, which returns the ticket to AI testing. On a complex ticket the
   session runs the Examine phase itself, since the agent that built the work does not review it.

The session keeps talking with the developer throughout. A request that arrives during a delivery and is not part of it becomes a ticket of its own, with its own agent.

## Measurement

The harness does not trust a delegate's own account of its work. It measures three things and keeps the evidence in the Git common directory of the clone.

- **The route record.** `sf agents route --task <kind> --provider <agent> --ticket <n> --record` writes a record and prints `route=<id>`. The session puts that id in the brief, and the delegate echoes
  it, so the capture takes the task kind and the tier from the record rather than from the delegate. A record also reserves any trial it hands out, and a route that nobody echoes within seven days
  expires.
- **The verdict line.** Each tier agent ends its final message with `SF-DELEGATION: <pass|fail> route=<id> checks=<codes>`. `pass` means the check the brief named was run and met. A message without
  the line is an unknown outcome.
- **The ledger.** `<git-common-dir>/saasfoundry/delegations.jsonl` is an append-only file that holds the runs (tokens, cost, active time, outcome, checks, tier and candidate), the route records, and
  the signals. On Claude Code, `SubagentStop` and `PostToolUse` hooks capture each run automatically. Other hosts record by hand with `sf agents outcome record`. A cost is never guessed: a model
  without a published price keeps its reliability but has no cost until the project declares one.

A later verdict is added as a signal, and the original line is never edited. The session marks a delivery that it had to redo with `sf agents outcome mark <ticket> rework`, and a defect that comes
back from Human Testing or review with `human-defect`. Both writes ask for permission in the coding agent, because they change what the routing does next.

`sf agents routing report` is read-only. It shows, per task kind and tier, the runs, the success rate, the p95 cost and duration, and per ticket the cost, the active time and the time from In progress
to Human testing. It also names the holds and the moves nobody has promoted. The report says what it cannot see: the tokens the session spends planning and reviewing are not metered, so a ticket's
cost is the cost of its delegations.

## Bounded adjustment

The grid is a prior. The project's own runs correct it, within bounds, and every move is logged with the evidence behind it:

- **Escalate.** A task kind moves one tier up after 3 failures among the last 10 rated runs of its candidate. This does not depend on cost: the rework a failing tier causes is not metered, so a cost
  test would keep a kind on a failing tier.
- **De-escalate.** A kind moves one tier down only after the cheaper tier has 8 successes, no failure among the runs offered to it as a trial, and a lower expected cost of delivering the work,
  failures included. The cost band is 10 %, and a tie goes to the lower p95 duration.
- **Trial.** The cheaper tier is tried on at most 10 % of the kind's rated runs. A failed trial leaves that tier alone for 14 days.
- **Floors.** A candidate the grid excludes for a kind (Haiku for terminal and CI work) is never chosen.

A move is local to the clone and never committed. Two commands act on it:

```bash
sf agents routing promote multi-file-feature   # copy the move into modules.harness.routing, as a reviewable change
sf agents routing reset multi-file-feature     # undo the automatic moves of the kind
```

`promote` writes the move to the shared manifest, and `sf agents refresh --scope shared` regenerates the tier agents to match. A kind pinned in `modules.harness.routing` is never changed by an
automatic move. The thresholds, prices and overrides a decision uses are read from the committed working branch, not from the manifest on disk, so a delegated agent cannot move the routing by editing
its own worktree. `modules.harness.routing.adjust.enabled: false` stops the moves and the trials, while outcomes are still recorded. The settings are listed in [`sf agents`](/cli/sf-agents#settings).

## What the routing does not do

- It recommends a model and an effort. It does not launch an agent on a provider you have not configured.
- It does not install runtimes, change credentials or permissions, or verify that a host discovers its instructions. Your session's own model, provider and credentials stay where you configured them.
- It does not decide the complexity of a ticket. The complexity label does, and it sizes the task kind (see [Complexity system](/workflow/complexity-system)).

## Where to go next

- [`sf agents`](/cli/sf-agents): every command, the grid, the tier agents, the delegation consent, the ledger and the adjustment settings.
- [Agent coexistence](/guide/agent-coexistence): how several coding agents share one project and what each host can prove.
- [Workflow system](/guide/workflow-system): the ticket lifecycle that delegated delivery runs inside.
- [Complexity system](/workflow/complexity-system): how a ticket's complexity decides its task kind.
