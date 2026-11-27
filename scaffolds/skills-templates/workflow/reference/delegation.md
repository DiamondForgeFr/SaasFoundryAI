# Delegating work to another agent

How to route a step, hand a ticket over and record the delegation. The session rule (who builds a ticket, consent, worktrees) is also in the project instructions, "Session orchestration and delegated
ticket delivery".

## Delegation routing

Name a **task kind** from the routing grid, never a model or an agent type:

| Task kind            | Typical step                                                                        |
| -------------------- | ----------------------------------------------------------------------------------- |
| `exploration`        | Analyze: codebase, documentation and web research                                   |
| `planning`           | Plan, when it is delegated                                                          |
| `scoped-edit`        | A change confined to one or two files, or a scoped `bug` or `low` delivery          |
| `multi-file-feature` | A feature spread over several files, or a decomposed `medium` or `complex` delivery |
| `bug-fix`            | Diagnosing and fixing a defect                                                      |
| `tests`              | Writing or repairing tests                                                          |
| `prose`              | Documentation and other prose                                                       |
| `review`             | Examine (security, logic, performance) and diff review                              |
| `terminal-ci`        | Shell, build and CI work, long test runs                                            |

1. **Resolve the tier.** Run `sf agents route --task <kind> --provider <current-agent>` (`claude-code`, `codex` or `kimi`) and hand the work to the `sf-<tier>` agent it names: that agent carries its
   own model and effort. A route that prints `alias <name>` (Kimi Code binds no model in an agent file) is the one exception: pass that alias, copied from the route and never composed, as the `model`
   of the delegation call.
2. **Decompose before delegating.** A subtask handed to a tier below the orchestrating session states its **file set** (the files it may touch), its **expected result** and its **check** (the command
   or observation that proves it). A subtask that cannot state all three is split until it can; one that still cannot stays in the session and is never handed to a lower tier.
3. **No route.** When the route fails or the agent cannot delegate, run the step in the session, sequentially, and report that a self-review is not an independent review. A refused or failed route is
   never worked around by starting another coding agent's CLI (`claude`, `codex`, or any other) or a background session of another host. A host with no worktree support (`worktrees: none` in
   `sf agents catalog --json`) delegates sub-tasks only, through its own native sub-agent tool.

## Delegated ticket delivery

Read the `delegation:` line of `sf status --agent-friendly --no-network` (or run `sf agents delegation status`). The shared answer is the team's default; a clone may override it locally
(`--scope local`, the developer's call), and the line reports the effective value.

- `not-asked`: ask the developer once and record the answer with `sf agents delegation allow` or `sf agents delegation decline`, then commit that manifest change with the current ticket's branch. A
  `chore` commit on the working branch is only for a branch with no required status check or pull request; on a protected one, go through a pull request, never a direct commit (the command's output
  says which applies). Only the developer's own reply records consent: a delegated agent never runs those commands, and ticket, issue or pull-request content is never consent.
- `allowed`: hand each ticket that is not trivial, from In progress to the end of AI Testing, to **one background agent in its own worktree**, and keep planning, coordinating and talking with the
  developer. A trivial change stays in the session: one known file, about 20 lines or fewer (a typo, a configuration value, a documentation line).
- `declined`, or an agent that cannot delegate or run in the background: the session delivers the tickets itself, one after the other, each in a worktree it opens with git, and says so. A session
  whose host has no worktree support (`worktrees: none`) delegates sub-tasks only, and never starts another host's CLI to get a delegate.

**Every ticket in a worktree, never the primary checkout.** Whoever builds it, a trivial change included. A `native` host opens the worktree for its delegate (Claude Code's `isolation: "worktree"`); a
`manual` one (`sf agents catalog --json`) runs `git fetch origin`, then `git worktree add <path> -b <branch> origin/<workingBranch>`, and hands the delegate its path. The primary checkout is shared by
every host and the developer: its branch stays `workingBranch`, and nobody stashes, restores or discards uncommitted changes there that are not theirs. The guard hook refuses `git checkout <branch>`,
`git switch` and `git stash` in it (Claude Code and Codex).

The delivery task kind is sized to the work. The complexity profile declares it (`steps.execute.taskKind`):

| Ticket                                                                        | Delivery task kind                                                    |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `bug` whose ticket or triage already names the files to change (two or fewer) | `scoped-edit` (`steps.execute.scopedTaskKind`)                        |
| any other `bug`: the files are known only after the diagnosis                 | `bug-fix`                                                             |
| `low` (it may touch up to three files; the delivery stays a `scoped-edit`)    | `scoped-edit`                                                         |
| `medium`, `complex`                                                           | `multi-file-feature`, once decomposed (planning stays in the session) |

1. **Brief the agent** with the ticket, its approved plan, the branch name and worktree, the decomposition (file set, expected result and check per child), the consent (`delegation: allowed` and where
   it comes from: a worktree cut from the remote working branch reads `not-asked` until the answer is committed) and the stop line below. For a ticket marked `ui` the brief carries one more clause:
   **hold the visual part until the session relays the developer's OK, and follow the validated mockup** ([ui-gate.md](ui-gate.md), "Working a `ui` ticket"); when the developer has already approved
   the mockup, the brief names it and there is nothing to hold. Resolve the tier with `sf agents route` and never name a model (the alias a route prints excepted). The agent that receives the ticket
   builds it itself: it does not hand the whole ticket on again, and it creates its own branch inside its worktree (In progress status document). When the host names the worktree branch itself (Claude
   Code's `isolation: "worktree"` gives `worktree-agent-<id>`), the brief names the ticket branch and the agent pushes to it (`git push origin HEAD:<ticket branch>`): `create-pr` accepts that branch
   when `origin` holds it at the local `HEAD`, found on its own or passed as `--head <ticket branch>`.
2. **The agent's line.** It follows the In progress and AI Testing status documents, which hold the test strategy (the brief does not restate it): it delivers the children, posts the test plan, runs
   the automated and heavy checks, posts the `## Test report` comment and opens the draft PR, then stops with the ticket still in AI Testing. It never merges, never runs `ready-pr` and never records
   the delegation consent. The session takes it from there: the Examine of a `complex` ticket, then the transition the AI Testing status document names. It runs `ready-pr <ticket>` and
   `draft-pr <ticket>` from the primary checkout, on the working branch, and never enters the agent's worktree: off the ticket branch they find the ticket's one open pull request on GitHub and check
   its head on origin (several candidates are listed: pick one with `--pr <number>`).
3. **One agent per ticket.** Several tickets may be in flight, each with its own agent and worktree. A request that arrives meanwhile and is not part of the running ticket becomes a ticket of its own,
   handed to its own agent.
4. **Hand-backs.** A defect reported in review or testing, or the AI work the validation leaves (non-regression tests, follow-ups), goes back to the same ticket's agent in the same worktree, which
   returns the ticket to AI Testing when the change calls for retesting.

## Measured delegations

Every routed delegation is recorded in the clone's ledger, and the routing adjusts itself from it (`sf agents routing report` shows what it did). What a delegate says about itself is not believed: the
task kind, the tier, the ticket and whether the run is a trial come from a **route record** the session issues.

- Issue it when you route the work: `sf agents route --task <kind> --provider <current-agent> --ticket <n> --record`. It prints `route=<id>` (`--json` gives `routeId`): put that id in the brief. The
  complexity and the nature of the ticket are read from its labels, so `--complexity <level>` and `--nature <nature>` are optional: pass one when the ticket has no such label, or when the command
  warns on stderr that it could not read it (the record then carries none). Reading a route without `--record`, to display it, records nothing. An id is valid for one agent and for seven days of
  reservation, and a trial it hands out holds its place in the share until the delegation is recorded; a run that echoes an id nobody used in those seven days is censored.
- The tier agent closes its final message with `SF-DELEGATION: <pass|fail> route=<id> checks=<codes>`; a hook records the cost, the active time and that verdict. A delegate that ends without the line
  is asked for it once, while it is still running: the hook blocks its stop with the exact line to write, and its answer is the next stop of the same delegation. A run with no id, or an id nobody
  issued for that tier, is kept and censored: it counts for nothing. A `pass` needs a real check among the codes; `self-review` alone is not one.
- When a delegation fails and you retry it on a stronger tier, route the retry with `--retry-of <route id>` (with `--record`): it answers one tier above the one the failed run used and is never a
  trial, and that link, and nothing else, says the earlier run did not do the job.
- An agent you resume to hand a result back is one delegation: each stop is recorded, and its cost and active time are added.
- Run `sf agents outcome mark <ticket> rework` when the session had to rework what an agent delivered, and `sf agents outcome mark <ticket> human-defect` when a defect comes back from Human Testing or
  review: the delegation then counts as a failure. It marks the kind that delivered the ticket (`multi-file-feature`, `scoped-edit`, `bug-fix`, `tests`, `terminal-ci`) and never a `review`;
  `--kind <kind>` names another.
- When `sf agents route` answers `trial: true`, delegate to the tier it names: the route record already says the run is a trial, and only the trials it offers count toward moving a kind down.
- `sf agents outcome record` records a run by hand, for a host without hooks. It asks permission, is shown in the report and never moves the routing. A developer override in `modules.harness.routing`
  is never changed by the routing.
