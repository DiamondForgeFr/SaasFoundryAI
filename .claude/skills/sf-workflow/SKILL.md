# Workflow SaaSFoundry AI

Complexity-adaptive development workflow with GitHub Projects (GitHub Projects, Jira, Notion, Linear, etc.)

## Auto-trigger keywords

workflow status, check workflow, what should i do, next step, workflow help, current status, complexity, detect complexity

## 🎯 Complexity-Based Adaptive Workflow

This workflow adapts its rigor based on ticket complexity:

| Level       | Label      | Process                          | Use Case          |
| ----------- | ---------- | -------------------------------- | ----------------- |
| **bug**     | 🐛 Bug Fix | Direct fix, regression test      | Quick bug fixes   |
| **low**     | 🟢 Low     | Oneshot-style (minimal ceremony) | Simple tasks      |
| **medium**  | 🟡 Medium  | Apex-free-style (structured)     | Standard features |
| **complex** | 🔴 Complex | Full Apex (adversarial review)   | Critical features |

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

**`/workflow status <ticket>`** Displays the current status of the ticket and loads the complete description of that status.

**`/workflow next <ticket>`** Indicates the next status and what needs to be done to get there.

**`/workflow validate <ticket>`** Checks if all conditions are met to move to the next status.

**`/workflow help`** Displays the list of statuses and their role.

### Complexity Commands (NEW)

**`/workflow detect-complexity <ticket>`** Auto-suggests complexity level based on:

- Number of files potentially impacted
- Keywords (auth, payment, security → complex)
- Risk assessment
- Historical patterns

Developer always has final say.

**`/workflow retag <ticket> <new-complexity>`** Changes ticket complexity level (bug | low | medium | complex). Adjusts remaining workflow steps to match new complexity.

### Workflow Phase Commands (Complexity-Adaptive)

**`/workflow prepare <ticket> <complexity>`** Runs adaptive analyze + plan phase (Backlog → Ready).

- **bug**: Skip (direct to implementation)
- **low**: Minimal (2-3 files, mental plan)
- **medium**: Standard (2-4 agents, detailed plan + approval)
- **complex**: Deep (6-10 agents, comprehensive plan + approval)

**`/workflow test <ticket> [complexity]`** Runs validation + optional adversarial review (→ AI Testing).

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

When a ticket crosses into **Ready** and requires Software Requirements Specifications (US / UR / FR / DS / TC), stop and hand off to the agnostic SRS skill:

- `.claude/skills/sf-srs/SKILL.md` — selects the configured SRS backend from `.saasfoundry.json → tools.srs.backend`
- `.claude/skills/sf-srs/scripts/srs-cli.sh validate` — smoke-tests the backend adapter (init OK, exit 0)
- `.claude/skills/sf-srs/scripts/srs-cli.sh draft|spawn|eval` — backend-neutral actions (sibling SUBs under #174 fill the body)

Never bypass the skill to write SRS by hand — the backend dispatch is how new projects get to swap Notion for Confluence / local markdown without touching the workflow logic.

## Workflow Statuses

1. **Backlog** (GRAY) — Read `statuses/1-backlog.md` for full description
2. **Ready** (YELLOW) — Read `statuses/2-ready.md` for full description
3. **In progress** (BLUE) — Read `statuses/3-in-progress.md` for full description
4. **AI testing** (PURPLE) — Read `statuses/4-ai-testing.md` for full description
5. **Human testing** (ORANGE) — Read `statuses/5-human-testing.md` for full description
6. **In review** (PINK) — Read `statuses/6-in-review.md` for full description
7. **Done** (GREEN) — Read `statuses/7-done.md` for full description

**⚠️ This skill is your SOURCE OF TRUTH for the workflow.**

## Critical Rules

1. **ALWAYS read the status description** before taking any action
2. **NEVER skip steps** described in a status
3. **NEVER move to the next status** without meeting all exit conditions
4. **ASK if uncertain** - don't assume or guess
5. **CLOSE SUBTASKS AS YOU GO** — after a subtask's commit lands, immediately run `workflow-cli.sh update-status <sub> Done` and verify `gh issue view <sub> --json state` prints `CLOSED` before
   starting the next one. Never batch closures at the end of the parent ticket.
6. **GATE PARENT TRANSITIONS ON OPEN CHILDREN** — before any parent transition (`AI Testing` → `Human Testing` → `In Review` → `Done`), run `gh issue list --state open --search "parent #<N>"` and
   ensure it returns empty. If not, go back and close the children first.
7. **FINISH THE CURRENT TICKET BEFORE STARTING ANOTHER** — if a ticket is `In Progress` / `AI Testing` / `Human Testing` / `In Review`, drive it to `Done` before claiming or starting another. The only
   override is an explicit developer request to pause.

## Implementation

The status descriptions are in the `statuses/` directory:

- Each status has its own markdown file
- Descriptions include: when to enter, mandatory actions, exit conditions, next status
- The CLI script (`workflow-cli.sh`) queries the project management tool and displays the appropriate description
