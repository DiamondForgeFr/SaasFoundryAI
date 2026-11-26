# Workflow system

SaaSFoundryAI's development harness turns delivery policy into project files, guarded commands and board state. Humans and coding agents read the same `.saasfoundry.json`; neither side has to
reconstruct the process from chat history.

## What the harness installs

- `sf-workflow` — the router, guards and status instructions;
- one board tool skill — `sf-tool-github-projects` for the complete v1 path;
- branch, commit, pull-request and status policy in `.saasfoundry.json`;
- complexity profiles for adaptive analysis and review;
- native child-ticket, test-plan and merge-evidence rules.

The workflow is coding-agent neutral. Claude Code can use the one-line assistant bootstrap; Codex, Gemini CLI, Kimi Code, Qwen Code and generic hosts consume the shared instructions and installed
`sf-*` skills according to their native capabilities.

## Choose a workflow shape

### Team: `saasfoundry`

```text
Backlog → Ready → In progress → AI testing → Human testing → In review → Done
```

This is the complete workflow documented throughout this site.

- **Human testing means feature testing:** validate behavior in a real runtime from the draft PR and test plan.
- **In review means code review:** mark the same PR ready, run full CI and review the implementation before merge.

Use it when product behavior deserves a separate functional checkpoint before code review.

### Solo: `solo`

```text
Backlog → In progress → AI testing → In review → Done
```

Solo removes the separate `Ready` and `Human testing` columns. It keeps planning, implementation, pushes, test evidence, CI and merge guards. `In review` becomes the single human gate: review the PR
and test manually there when needed.

Select a preset during creation or while adding the harness:

```bash
sf new --project-name my-product --profile full --workflow saasfoundry
sf new --project-name my-product --profile harness --workflow solo
sf update --target-profile harness --workflow solo
```

Switch an existing managed project in place:

```bash
sf workflow use solo
sf workflow use saasfoundry
```

The command preserves the project's board, branches and URLs, replaces the status set, regenerates matching status documentation and attempts to align a configured GitHub Project.

### Custom workflow

Interactive setup offers **Custom Workflow**. Define at least two named statuses, give every status a description for agent context and select its board color. Save and reuse the result:

```bash
sf workflow save regulated-team
sf workflow create release-train
sf workflow list
sf workflow show-template regulated-team
sf workflow use regulated-team
```

::: warning Custom means configurable, not unguarded

The built-in Team and Solo presets are the only end-to-end guarded routes in v1. A Custom template can store and synchronise board stages, but the installer does not generate complete status documents
or arbitrary guards for new names. The team must extend the installed skill before using that sequence as a delivery contract.

:::

## The three axes are independent

| Axis           | Controls                                              | Examples                                   |
| -------------- | ----------------------------------------------------- | ------------------------------------------ |
| Workflow shape | Which guarded preset or advanced extension is active  | team, solo, custom                         |
| Complexity     | Analysis, planning and review depth inside the phases | bug, low, medium, complex                  |
| Nature         | Delivery ownership and legal route                    | user-facing, internal, bundled child, Epic |

A complex ticket in Solo still receives deep analysis and adversarial review; it simply has one human PR gate instead of separate feature-testing and code-review columns. A low-risk ticket in the team
preset still passes through its configured stages, with lighter ceremony inside them.

Nature adds guarded exceptions. A bundled child has no PR because its atomic commit ships in its delivery parent's PR. An Epic has neither branch nor PR; its status is derived from native children.

## Pull-request lifecycle

For the team preset:

1. commit and push before AI testing: the pushed-commits guard refuses a ticket whose tracked files are not committed or whose commits `origin` lacks, and names the command to run;
2. publish the test plan and the report as ticket comments, starting with the headings `## Test plan` and `## Test report`;
3. create or reuse a **draft PR** before Human testing, and make the project's local CI green on its head commit: the local CI guard refuses the move to Human testing otherwise (see below);
4. let the developer perform functional feature testing;
5. after approval and non-regression tests, the developer marks the same PR ready (the agent never does on this route);
6. enter In review for code review and full CI;
7. wait for the developer to merge;
8. verify the merge before Done.

```bash
WORKFLOW=.claude/skills/sf-workflow/workflow-cli.sh

$WORKFLOW create-pr 42 --draft      # during AI testing at the latest
# the developer clicks Ready for review; the review listener moves the ticket to In review
# without the listener, once the PR is out of draft:
$WORKFLOW update-status 42 "In review"
# developer merges
$WORKFLOW update-status 42 Done
```

Without Human testing (the Solo preset, or a `nature:internal` ticket), the agent also opens the draft during AI testing, and marks it ready itself with `ready-pr` at the end of AI testing: In review
is then the human gate.

### Two guards at the edges of AI testing

`update-status` checks two things that used to be instructions only:

- **`→ AI testing` needs pushed work.** The guard reads git alone, so it holds for every workflow tool. It inspects the checkout that holds the work: the ticket branch, the delivery parent's branch
  for a bundled child, a branch the host named (`worktree-agent-<id>`) against the one ticket branch of `origin`, or, from the primary checkout or a checkout on another ticket's branch, the worktree
  of the ticket branch. Tracked changes (staged or not), a branch `origin` lacks, a commit it does not have, a branch it moved past, an unreachable `origin` and a detached HEAD are refused, and the
  message names the commit, push or `git pull --rebase` command. Untracked files only warn. The same check covers the return from Human testing to AI testing after a fix.
- **`→ Human testing` needs a green local CI.** With GitHub Projects, the guard reads the head commit of the draft PR it just matched, from any checkout, and requires the project's local CI statuses
  green on it. They come from `workflow.localCi.requiredStatuses` when it is recorded (`sf workflow set-local-ci`), otherwise from `local-<job>` for each job of `.molten/project.json` when it
  publishes to GitHub, otherwise from the `AI testing / Local CI` status the agent publishes with `workflow-cli.sh ai-status <ticket> "Local CI" success` once the project's suite is green. The refusal
  names the source and the command to run (`molten ci run <branch>`, or the suite and the `ai-status` call). `workflow-cli.sh local-ci-gate <ticket>` runs the same check on its own. A project with no
  local CI records that with `sf workflow set-local-ci --none`.

A recorded list is pinned: a job added to `.molten/project.json` afterwards is not required until the list is recorded again, or cleared with `sf workflow set-local-ci --clear` to follow the pipeline.
`sf workflow show` and `sf status` print the effective list and where it comes from.

## The UI mockup gate

A ticket that changes the user interface is validated on a mockup before its visual work reaches your review: you see the look first, not in the screenshots of a finished pull request. Three things
carry the gate, with GitHub Projects as the workflow tool.

- **The `ui` marker.** The session labels a ticket `ui` when it creates it (`create-ticket … --ui`, `create-subtask … --ui`) or later with `set-ui <ticket>`, and `clear-ui <ticket>` removes it. The
  label is not a nature label and is not reserved to you: the session sets it, `sf new` provisions it, and `set-ui` creates it when the repository lacks it.
- **The validation record.** Once you have approved a mockup, the session records the mockup's link or path, the date and who approved it. When you supplied the visuals yourself (your own mockup, or
  an exact target screenshot), it records that and what you supplied instead, and no mockup is made. The record is a ticket comment, written by `record-ui-validation` and read back by
  `get-ui-validation`.
- **The guard.** `update-status` refuses a `ui` ticket that has no complete record on its way to your review: `→ In review` under the Solo preset, `→ Human testing` (and `→ In review` for a ticket
  that skips Human testing) under the Team preset. The refusal names the `record-ui-validation` command to run, and it comes before the guards of the pull request. A ticket without the marker passes
  exactly as before.

```bash
WORKFLOW=.claude/skills/sf-workflow/workflow-cli.sh

# mark a new ticket, or an existing one (clear-ui removes the marker)
$WORKFLOW create-ticket story "Redesign the login screen" --complexity medium --ui
$WORKFLOW set-ui 42

# record the approval of a mockup, or the visuals you supplied (one of the two)
$WORKFLOW record-ui-validation 42 --mockup docs/mockups/login.html --approved-by "Ada Lovelace" --date 2026-11-23
$WORKFLOW record-ui-validation 42 --supplied "an exact target screenshot, login-target.png"

# read the record the guard reads
$WORKFLOW get-ui-validation 42
```

`--date` defaults to today. `get-ui-validation` prints the latest complete record as one line of JSON, and nothing when there is none. A comment that only quotes the marker, or that lacks one of its
fields (the mockup, the approver and the date; or what was supplied and the date), is not a record.

The guard fails open when the ticket's labels cannot be read (an offline `gh`, an expired token), like the nature guard, so that infrastructure trouble does not wedge the workflow. It fails closed
when the ticket carries the marker and its comments cannot be read: a read that failed is never taken for a ticket with no record. The other workflow tools (Jira, Linear, Notion) refuse the marker and
record commands with exit code `2`, and their `update-status` does not read a record.

The refusal is lifted by `SF_WORKFLOW_BYPASS_UI_MOCKUP_GUARD=1`, an [escape hatch](#escape-hatches) that is yours to apply, announced and recorded on the ticket like the others. The guard hook refuses
an agent that sets it.

### How an agent works a `ui` ticket

The workflow skill gives every coding agent (Claude Code, Codex, Kimi Code or any other) the same instructions for a `ui` ticket. They name capabilities, never the tool of one host:

- **Design skills.** The agent loads the design and UX skills its host offers before it draws anything, and works as a UI/UX professional, with the project's design tokens and components.
- **A short checklist.** `ui-checklist.md` ships next to the skill's `SKILL.md`: hierarchy; spacing and design tokens; states (empty, loading, error, disabled); accessibility (contrast, keyboard,
  focus, labels); copy.
- **One HTML file as the mockup.** The floor is a single self-contained HTML file: inline CSS, no build step, and it opens in any browser. It is kept with the ticket's evidence (committed on the
  ticket's branch, in `docs/mockups/` unless your `AGENTS.md` names another folder), and its path or link goes into `record-ui-validation`. A richer surface the host offers, such as a Claude artifact
  or a Figma frame, may be added next to it, never in its place.
- **You see it first.** The mockup is shown to you before the visual implementation. The spec, the model, the data and the tests may start meanwhile; only the visual part waits for your OK. When you
  supply the visuals yourself, the session records that with `record-ui-validation --supplied` and no mockup is made.
- **A delegated agent waits for your OK.** The brief of a delegated `ui` ticket says to hold the visual part until the session relays your OK, and to follow the validated mockup. The session is the
  one that shows you the mockup and records your approval; an agent never records an approval you did not give.

Where your project shows a mockup (for example the browser panel of your terminal) and which design tokens it uses are yours to state, in your own `AGENTS.md` and outside its generated region. The
generated region tells the agents to look there; without a statement, the agent gives you the mockup file's path to open in a browser.

## The first ticket

Create tickets through the CLI, so they land on the board in Backlog with their issue type and complexity label:

```bash
.claude/skills/sf-workflow/workflow-cli.sh create-ticket task "Bootstrap the repository" --complexity low
```

A repository with no commit yet has no working branch to branch from and no pull request to merge. For that first ticket only, `bootstrap` does four things:

- commits the setup as the root commit of the main branch;
- creates and pushes the working branch;
- records why on the ticket;
- closes the ticket.

```bash
.claude/skills/sf-workflow/workflow-cli.sh bootstrap 1
```

The Done guard accepts that ticket because the repository's single root commit names it. Every later ticket needs a merged pull request, and no bypass variable is involved.

A project that `sf new` has just generated with a workflow is in this state: `sf new` makes no root commit of its own, so that `bootstrap` can make its own. See
[What `sf new` commits](/cli/sf-new#what-sf-new-commits).

## The ticket comes first

No line of code is written before its ticket exists: the ticket number names the branch (`workflow.branchNaming`) and every commit (`<type>(#<N>): …`). When the ticket tool or the remote is
unreachable (an expired `gh` token, no network), the agent stops, reports the blocker to you with the failing command, and proposes temporary alternatives for you to choose from. It does not pick a
workaround on its own: an agent that once did committed 19 fixes as `fix(#TBD): …` on unnumbered local branches and pushed nothing, and nobody saw the work for two days (#1232). The generated
`AGENTS.md` region and the In progress status document say so.

A project generated with its application stack also enforces it in its git hooks:

- `commit-msg`: commitlint refuses a ticket reference that is not a number (`#TBD`, `#XXX`). There is no hatch: reword the subject once the ticket exists.
- `pre-commit` and `pre-push`: `.husky/workflow-branch-guard.mjs` refuses a branch the workflow does not name. It accepts the `workflow.branchNaming` patterns, `rc-*`, and the main, working,
  pull-request target and release branches. A detached HEAD (every rebase step) and a branch the host named (`worktree-agent-<id>`, Claude Code's isolated worktree) commit freely; the push is checked
  instead, so such an agent pushes to its ticket branch with `git push origin HEAD:<ticket branch>`. A project with no `workflow` block is not checked.

A project installed with the harness alone has no git hooks of SaaSFoundryAI: the instructions carry the rule there.

## Status and configuration commands

```bash
sf workflow show
sf workflow validate
sf workflow set-working-branch develop
sf workflow set-local-ci --from-molten
sf workflow set-ai-rules

.claude/skills/sf-workflow/workflow-cli.sh status 42
.claude/skills/sf-workflow/workflow-cli.sh update-status 42 "AI testing"
```

Never mutate the board directly to bypass a rejected transition. The rejection is evidence that an entry condition, exit condition or external proof is missing.

In v1, `sf workflow validate` checks local manifest fields only. It does not compare remote board options, so inspect the configured board separately after changing statuses.

## Manifest contract

```json
{
  "workflow": {
    "template": "SaaSFoundry AI Workflow",
    "tool": "github-projects",
    "projectUrl": "https://github.com/orgs/acme/projects/1",
    "workingBranch": "develop",
    "prTargetBranch": "develop",
    "requireCodeReview": true,
    "statuses": [
      { "name": "Backlog", "color": "GRAY" },
      { "name": "Ready", "color": "YELLOW" },
      { "name": "In progress", "color": "BLUE" },
      { "name": "AI testing", "color": "PURPLE" },
      { "name": "Human testing", "color": "ORANGE" },
      { "name": "In review", "color": "PINK" },
      { "name": "Done", "color": "GREEN" }
    ]
  }
}
```

The manifest is the source of truth. Status names, branch names and pull-request targets are not inferred from documentation examples.

## Tool support

| Adapter         | v1 contract                                                                                |
| --------------- | ------------------------------------------------------------------------------------------ |
| GitHub Projects | Complete: issues, native children, status fields, milestones, PR guards and merge evidence |
| Jira            | Experimental: useful operations exist, full contract parity is not guaranteed              |
| Linear          | Experimental: issue operations exist, full contract parity is not guaranteed               |
| Notion          | SRS/documentation backend, not a complete v1 workflow tracker                              |

Run `sf status --agent-friendly --no-network` to inspect declared configuration without claiming that credentials or network access work. Use an explicit connection check only when the task needs the
external service.

## SRS drafting tickets

Specification drafting is not code delivery. Tickets labelled `srs:drafting`, `srs:update` or `srs:new` stay in the board's In progress column and follow:

```text
AI draft → Human review → Spawning → Done
```

Use `workflow-cli.sh transition-drafting`; the CLI rejects code-path transitions for these tickets.

## Escape hatches

A guard refusal means a condition or a piece of proof is missing; the answer is to supply it. For the rare case where a guard is wrong or cannot be satisfied, the scripts accept a few explicit escape
hatches. They are yours to apply, not the agent's: set a variable inline for one command only, never with `export`, with `SF_WORKFLOW_BYPASS_REASON="<why>"` beside it. `update-status` then prints a
warning naming the variable and records it, with the reason, as a ticket comment; add the evidence to that comment. A refusal does not tell a coding agent how to get past the guard: it names the next
legitimate command and sends the agent back to you, and a hook refuses the agent that sets a hatch anyway ([below](#who-applies-a-hatch)).

| Hatch                                                                                      | What it switches off                                                         |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `SF_WORKFLOW_BYPASS_SRS_GUARD=1`                                                           | Keeps `srs:*` tickets off the code-path statuses                             |
| `SF_WORKFLOW_BYPASS_COMPLEXITY_GUARD=1`                                                    | Requires a `complexity:` label to leave Backlog                              |
| `SF_WORKFLOW_BYPASS_NATURE_GUARD=1`                                                        | Routes by `nature:*` (Human testing, In review, bundled-PR to Done)          |
| `SF_WORKFLOW_BYPASS_UI_MOCKUP_GUARD=1`                                                     | Requires a `ui` ticket's mockup validation before In review or Human testing |
| `SF_WORKFLOW_BYPASS_CHILDREN_GUARD=1`                                                      | Requires every native child to be Done before the parent                     |
| `SF_WORKFLOW_BYPASS_BUNDLED_PARENT_GUARD=1`                                                | Requires a verified, non-Epic native parent for a bundled-PR child           |
| `SF_WORKFLOW_BYPASS_PUSHED_GUARD=1`                                                        | Requires the ticket work to be committed and pushed before AI testing        |
| `SF_WORKFLOW_BYPASS_PR_EXISTENCE_GUARD=1`                                                  | Requires a matching open PR (draft or ready) for Human testing and In review |
| `SF_WORKFLOW_BYPASS_PR_MERGED_GUARD=1`                                                     | Requires a verified merged PR before Done                                    |
| `SF_WORKFLOW_BYPASS_BRANCH_GUARD=1` on `git commit` or `git push`                          | The git hooks' branch guard: work lands on a branch the workflow names       |
| `--bypass-srs <reason>` on `create-ticket`, `create-subtask`, `create-epic`                | Rule 8: tickets of an SRS-enabled project come from the SRS spawner          |
| `--bypass-reason <text>` on `srs-cli.sh spawn`                                             | Sets the `--bypass-srs` reason of spawned tickets; disables no check         |
| `--skip-local-ci "<reason>"` on `create-pr`, `ready-pr`, `update-status … "Human testing"` | Requires the local CI statuses to be green on the head commit                |
| `SF_CACHE_BUST=1`                                                                          | Not a guard: refetches the cached board schema                               |
| `SF_DISABLE_SRS_HOOK=1`                                                                    | Not a guard: silences the SRS intent-detector reminder                       |

`--bypass-srs` and `--skip-local-ci` carry a mandatory reason. The reason is the record: choose a grep-able token such as `meta-srs-tooling`. `--bypass-srs` posts it on the created ticket and
`--skip-local-ci` writes it on the pull request (or on the ticket when no pull request can carry it). The legitimate and illegitimate uses of each hatch, and the record to leave, are in
`.claude/skills/sf-workflow/escape-hatches.md` in every project that installs the workflow.

### Who applies a hatch

An escape hatch is your decision, and so is every choice a guard protects: whether a ticket skips Human testing, whether a pull request is ready, whether it merges. A `PreToolUse` hook, written into
`.claude/settings.json` and `.codex/hooks.json` by `sf new`, `sf update` and `sf agents refresh`, refuses an agent's Bash call before it runs (and PowerShell on Claude Code). It refuses, in the main
session as well as in a delegated agent:

- a `SF_WORKFLOW_BYPASS_<X>=…` assignment in front of a command, in `export`, `env`, `bash -c` or `eval` (the reason variable alone is not refused);
- `--skip-local-ci` given to `workflow-cli.sh` or `github-projects-cli.sh`;
- `nature:internal` or `nature:bundled-pr` put on a ticket with `gh issue edit` or `gh api`.

For a **delegated agent** only (an agent id in the event, or a working directory under `.claude/worktrees/` or `.codex/worktrees/`) it also refuses `sf agents delegation allow|decline|clear`,
`ready-pr` and `gh pr ready`, `gh pr merge`, and `create-ticket … --nature internal`. The same calls from the primary checkout are allowed. The scripts add a second barrier that does not depend on the
hook: `update-status`, `create-pr`, `ready-pr`, `draft-pr` and `local-ci-gate` refuse a hatch, `--skip-local-ci` and `ready-pr` themselves when they run in a delegated worktree.

You apply a hatch from the primary checkout, in either of two ways:

- **Claude Code:** type the command in the session with a leading `!`. It runs directly, without going through the agent's Bash tool, so the hook does not fire, and its output joins the conversation.
  `! SF_WORKFLOW_BYPASS_PR_MERGED_GUARD=1 SF_WORKFLOW_BYPASS_REASON="hotfix a1b2c3d pushed directly" .claude/skills/sf-workflow/workflow-cli.sh update-status 42 Done`. The script still posts the
  bypass comment.
- **Any host:** your own terminal, at the root of the primary checkout. `update-status` and `local-ci-gate` find the ticket's worktree or pull request from there.

Nature labels are added by you on GitHub, or with `!` in Claude Code.

The same hook also keeps an agent to **one plain command per shell call**, which `AGENTS.md` asks of it. A host cannot analyse a line that chains commands (`&&`, `;`, `||`, a newline), substitutes the
output of one into another (`$(…)`, backticks), loops, runs an inline script (`node -e`, `python3 -c`, `bash -c`, `eval`) or writes a file through a heredoc, so it asks you for a permission on every
such call, even when each command in it is allowed. The hook refuses the line and names the split to make, so the agent rewrites its call instead of asking you. That is not an escape hatch: nothing is
left for you to apply. It is on by default (`modules.harness.guard.shellShape` is `refuse` when nothing is recorded, and `sf update` writes nothing), and which mode a project uses is your decision:
`sf agents shell-guard warn` makes the hook warn the agent without refusing (the host's own permission prompt still applies), and `sf agents shell-guard off` stops reading the shape of a line. The
refusal of an escape hatch, a nature label and a delegated merge holds in every mode. Claude Code does not ask about `git commit -m "$(cat <<'EOF' … EOF)"` or
`gh pr create --body "$(cat <<'EOF' … EOF)"` with a single-quoted delimiter (measured on 2.1.325), so the hook leaves those two forms alone on Claude Code; on Codex, and for any other command, text
goes through a file (`git commit -F <file>`, `--body-file <file>`). The details, the table of constructs and the measurement are in
[`sf agents guard`](/cli/sf-agents#a-shell-line-that-is-not-one-plain-command).

The hook is a guardrail against the ordinary path the refusals used to teach, not a security boundary: it reads the command the agent wrote, covers the Bash tool only, and fails open (no CLI, an old
CLI or a payload it cannot read lets the call through). `sf status` says so on its `routing:` line (`guard enforced`, `guard declared`, `guard hook missing`…) and warns when the hook cannot work.
Claude Code reads its settings when a session starts, so a running session keeps its old hooks until it restarts. Codex runs a project hook only once the `.codex/` layer and the hook are trusted:
after `sf update`, review and trust the guard with `/hooks`. See [`sf agents guard`](/cli/sf-agents#the-guard-hook).

## Continue

- [Team 7-status reference](/workflow/7-status-system)
- [Complexity system](/workflow/complexity-system)
- [GitHub Projects integration](/workflow/github-integration)
- [Connect your tools](/features/your-tools)
- [CLI or assistant setup](/getting-started/setup-paths)
