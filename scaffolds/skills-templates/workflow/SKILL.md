# Workflow {{WORKFLOW_NAME}}

Complexity-adaptive development workflow with {{TOOL}} (GitHub Projects, Jira, Notion, Linear, etc.)

## Auto-trigger keywords
workflow status, check workflow, what should i do, next step, workflow help, current status, complexity, detect complexity

## 🎯 Complexity-Based Adaptive Workflow

This workflow adapts its rigor based on ticket complexity:

| Level | Label | Process | Use Case |
|-------|-------|---------|----------|
| **bug** | 🐛 Bug Fix | Direct fix, regression test | Quick bug fixes |
| **low** | 🟢 Low | Oneshot-style (minimal ceremony) | Simple tasks |
| **medium** | 🟡 Medium | Apex-free-style (structured) | Standard features |
| **complex** | 🔴 Complex | Full Apex (adversarial review) | Critical features |

**Key principle:** Higher complexity = more rigor (analysis depth, planning detail, adversarial review, test coverage)

## How to use this skill

**FIRST TIME on a ticket:**
1. **Detect complexity:** `/workflow detect-complexity <ticket-number>`
2. **Confirm with developer:** AI suggests, developer decides
3. **Follow adaptive process:** Each status adapts to complexity level

**BEFORE EVERY ACTION:**
1. Invoke this skill with `/workflow status <ticket-number>`
2. Read the COMPLETE description of the current status
3. Follow EXACTLY the instructions from that description
4. Never guess - if uncertain, run `/workflow status` again

## Configuration (Source of Truth)

**ALL workflow configuration is in `.saasfoundry.json` at the project root.**

When you need workflow information (branches, naming conventions, etc.), read it from there:

```bash
# Read working branch
cat .saasfoundry.json | jq -r '.workflow.workingBranch'

# Read PR target branch
cat .saasfoundry.json | jq -r '.workflow.prTargetBranch'

# Read project URL
cat .saasfoundry.json | jq -r '.workflow.projectUrl'

# Read branch naming pattern
cat .saasfoundry.json | jq -r '.workflow.branchNaming.feature'

# Read commit format
cat .saasfoundry.json | jq -r '.workflow.commitFormat.pattern'
```

**NEVER hardcode branch names** (develop, master, etc.) - always read from `.saasfoundry.json`.

## Available Commands

### Workflow Status Commands

**`/workflow status <ticket>`**
Displays the current status of the ticket and loads the complete description of that status.

**`/workflow next <ticket>`**
Indicates the next status and what needs to be done to get there.

**`/workflow validate <ticket>`**
Checks if all conditions are met to move to the next status.

**`/workflow help`**
Displays the list of statuses and their role.

### Complexity Commands (NEW)

**`/workflow detect-complexity <ticket>`**
Auto-suggests complexity level based on:
- Number of files potentially impacted
- Keywords (auth, payment, security → complex)
- Risk assessment
- Historical patterns

Developer always has final say.

**`/workflow retag <ticket> <new-complexity>`**
Changes ticket complexity level (bug | low | medium | complex).
Adjusts remaining workflow steps to match new complexity.

### Workflow Phase Commands (Complexity-Adaptive)

**`/workflow prepare <ticket> <complexity>`**
Runs adaptive analyze + plan phase (Backlog → Ready).
- **bug**: Skip (direct to implementation)
- **low**: Minimal (2-3 files, mental plan)
- **medium**: Standard (2-4 agents, detailed plan + approval)
- **complex**: Deep (6-10 agents, comprehensive plan + approval)

**`/workflow test <ticket> [complexity]`**
Runs validation + optional adversarial review (→ AI Testing).
- **bug/low/medium**: Validation only (build, lint, typecheck, unit tests)
- **complex**: + Adversarial review (security, logic, performance)

## Tool-Specific Commands

Workflow commands that interact with your project management tool (GitHub Projects, Jira, Notion, Linear) are delegated to tool-specific CLIs.

The workflow skill automatically routes commands to the appropriate tool based on your `.saasfoundry.json` configuration.

**Example:** Creating a subtask
```bash
# This command is automatically routed to the correct tool
.claude/skills/sf-workflow/workflow-cli.sh create-subtask <parent> <title>
```

See your tool-specific skill documentation for complete command reference:
- GitHub Projects: `.claude/skills/sf-tool-github-projects/SKILL.md`
- Jira: `.claude/skills/sf-tool-jira/SKILL.md`
- Notion: `.claude/skills/sf-tool-notion/SKILL.md`
- Linear: `.claude/skills/sf-tool-linear/SKILL.md`

## SRS Handoff (drafting / spawning tickets)

When a ticket crosses into **Ready** and requires Software Requirements Specifications (US / UR / FR / DS / TC),
stop and hand off to the agnostic SRS skill:

- `.claude/skills/sf-srs/SKILL.md` — selects the configured SRS backend from `.saasfoundry.json → tools.srs.backend`
- `.claude/skills/sf-srs/scripts/srs-cli.sh validate` — smoke-tests the backend adapter (init OK, exit 0)
- `.claude/skills/sf-srs/scripts/srs-cli.sh draft|spawn|eval` — backend-neutral actions (sibling SUBs under #174 fill the body)

Never bypass the skill to write SRS by hand — the backend dispatch is how new projects get to swap Notion for
Confluence / local markdown without touching the workflow logic.

### Drafting lifecycle (tickets labelled `srs:drafting | srs:update | srs:new`)

SRS tickets don't flow through the code-path statuses — they have their own lifecycle inside the `In progress` board column:

```
Ready → In progress (brainstorm)
         → ai-draft        (srs-cli.sh draft)
         → human-review    (owner reviews the backend page)
         → spawning        (srs-cli.sh spawn — creates Backlog children)
         → done            (board status → Done)
```

Drive it with:

```bash
.claude/skills/sf-workflow/workflow-cli.sh transition-drafting <ticket> <phase>
# phase: ai-draft | human-review | spawning | done
```

Each phase is documented in detail:
- `statuses/3a-ai-drafting.md` — AI drafter runs against the configured backend
- `statuses/3b-human-review.md` — spec owner reviews and approves
- `statuses/3c-spawning.md` — children land in Backlog, drafting ticket closes

**Guard** — `update-status <ticket> "AI testing|Human testing|In review"` is rejected when the ticket carries an `srs:*` label. Use `transition-drafting` instead. The guard fails open if label fetch errors (offline / auth issues) so normal teams are not punished by infrastructure hiccups.

### Rule 8 — spawning Stories from SRS

Once an Epic page tree is drafted (Main spec + FR-001…FR-N children), the Story sub-tickets under the parent must be created by the spawner, not by hand:

```bash
.claude/skills/sf-srs/scripts/srs-cli.sh spawn --ticket <parent> --epic <page-url-or-id>
```

The spawner enumerates FR pages, renders each Story body from `renderStoryTicketBody`, and invokes `workflow-cli.sh create-subtask` with `--bypass-srs spawned-from-srs`. Children land as regular sub-issues under the parent ticket (no `srs:*` label — they flow through the normal code-path workflow). Use `--dry-run` to preview without writing.

On SRS-enabled projects (`tools.srs.backend` is set), `create-subtask` refuses calls without `--bypass-srs <reason>` and exits 2. The escape hatch is legitimate only for:

- Meta tickets that don't map to an FR page (SRS tooling, drafter refactors, eval polish)
- Bootstrapping an Epic's own SUBs during rollout before the page tree exists

Typing the reason is the audit trail — pick something a reviewer can grep for (`spawned-from-srs`, `meta-srs-tooling`, `bootstrap-epic-174`…). If the ticket represents a feature requirement, the answer is always "go draft it first, then spawn."

## Workflow Statuses

{{STATUSES_LIST}}

**⚠️ This skill is your SOURCE OF TRUTH for the workflow.**

## Critical Rules

1. **ALWAYS read the status description** before taking any action
2. **NEVER skip steps** described in a status
3. **NEVER move to the next status** without meeting all exit conditions
4. **ASK if uncertain** - don't assume or guess
5. **CLOSE SUBTASKS AS YOU GO** — after a subtask's commit lands, immediately run `workflow-cli.sh update-status <sub> Done` and verify `gh issue view <sub> --json state` prints `CLOSED` before starting the next one. Never batch closures at the end of the parent ticket.
6. **GATE PARENT TRANSITIONS ON OPEN CHILDREN** — before any parent transition (`AI Testing` → `Human Testing` → `In Review` → `Done`), run `gh issue list --state open --search "parent #<N>"` and ensure it returns empty. If not, go back and close the children first.
7. **FINISH THE CURRENT TICKET BEFORE STARTING ANOTHER** — if a ticket is `In Progress` / `AI Testing` / `Human Testing` / `In Review`, drive it to `Done` before claiming or starting another. The only override is an explicit developer request to pause.
8. **TICKETS FROM SRS** — when `tools.srs.backend` is set in `.saasfoundry.json`, Story sub-tickets under an SRS Epic must be spawned from the canonical FR pages, not hand-written. Use `.claude/skills/sf-srs/scripts/srs-cli.sh spawn --ticket <parent> --epic <page-url-or-id>` to create one child issue per FR page, each body rendered from `renderStoryTicketBody`. The `create-subtask` command rejects any call without `--bypass-srs <reason>` on SRS-enabled projects — see the "SRS Handoff" section above. The escape hatch exists for meta tickets (SRS refactors, tooling) but must never be used to duplicate an FR that already has a page.

## Implementation

The status descriptions are in the `statuses/` directory:
- Each status has its own markdown file
- Descriptions include: when to enter, mandatory actions, exit conditions, next status
- The CLI script (`workflow-cli.sh`) queries the project management tool and displays the appropriate description
