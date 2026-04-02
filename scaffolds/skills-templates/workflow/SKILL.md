# Workflow {{WORKFLOW_NAME}}

Skill to follow the development workflow with {{TOOL}} (GitHub Projects, Jira, Notion, Linear, etc.)

## Auto-trigger keywords
workflow status, check workflow, what should i do, next step, workflow help, current status

## How to use this skill

**BEFORE EVERY ACTION on a ticket, you MUST:**
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

### `/workflow status <ticket>`
Displays the current status of the ticket and loads the complete description of that status.

### `/workflow next <ticket>`
Indicates the next status and what needs to be done to get there.

### `/workflow validate <ticket>`
Checks if all conditions are met to move to the next status.

### `/workflow help`
Displays the list of statuses and their role.

## Helper Scripts

### Create Subtask

Create a GitHub sub-issue linked to a parent issue in one command.

**Usage:**
```bash
.claude/skills/sf-workflow/create-subtask.sh <parent-number> <title> [body]
```

**Examples:**
```bash
# Simple subtask
.claude/skills/sf-workflow/create-subtask.sh 9 "Add validation logic"

# With description
.claude/skills/sf-workflow/create-subtask.sh 9 "Write unit tests" "Cover edge cases and error handling"
```

**What it does:**
1. Prepends `[Parent #{N}]` to the title
2. Creates the GitHub issue
3. Links it as a sub-issue to the parent (via GraphQL API)
4. Returns the subtask number and URL

**Use this script instead of manual `gh issue create` + linking.**

## Workflow Statuses

{{STATUSES_LIST}}

**⚠️ This skill is your SOURCE OF TRUTH for the workflow.**

## Critical Rules

1. **ALWAYS read the status description** before taking any action
2. **NEVER skip steps** described in a status
3. **NEVER move to the next status** without meeting all exit conditions
4. **ASK if uncertain** - don't assume or guess

## Implementation

The status descriptions are in the `statuses/` directory:
- Each status has its own markdown file
- Descriptions include: when to enter, mandatory actions, exit conditions, next status
- The CLI script (`workflow-cli.sh`) queries the project management tool and displays the appropriate description
