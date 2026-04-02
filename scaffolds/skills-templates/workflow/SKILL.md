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

## Available Commands

### `/workflow status <ticket>`
Displays the current status of the ticket and loads the complete description of that status.

### `/workflow next <ticket>`
Indicates the next status and what needs to be done to get there.

### `/workflow validate <ticket>`
Checks if all conditions are met to move to the next status.

### `/workflow help`
Displays the list of statuses and their role.

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
