# STATUS (drafting lifecycle): Spawning

**ROLE**: Turn the approved SRS page into the matching GitHub (or tool-native) tickets that will drive implementation.

> Logical sub-phase of `In progress`. The board column stays `In progress` during this phase, then the `transition-drafting done` call moves the ticket directly to `Done`.

## When to Enter This Status

- `3b-human-review.md` is complete (owner approval signalled)
- The backend page is stable
- Ticket still carries its `srs:*` label

## Mandatory Actions

### 1. RUN THE SPAWNER

```bash
.claude/skills/sf-workflow/workflow-cli.sh transition-drafting <ticket> spawning
```

This dispatches to `.claude/skills/sf-srs/scripts/srs-cli.sh spawn --ticket <ticket>`, which:

- Reads the approved SRS backend page
- Renders the ticket templates from `sf-srs/templates/tickets/` (Epic or Story)
- Creates the corresponding tickets on the configured workflow tool (GitHub Projects, Jira, Linear, …) via the tool adapter — each child lands in **Backlog** with no `srs:*` label

### 2. VERIFY THE CHILDREN

Run `gh issue list --search "parent #<ticket>"` (or your tool equivalent) and sanity-check the fresh Backlog children: titles, complexity tags left empty (they will be detected once the team picks
them up), cross-links to the backend page visible in the body.

### 3. CLEAR THE SRS LABEL

Once the children exist, remove the `srs:*` label from the parent drafting ticket — the lifecycle is over, the guard can release its grip. The `done` phase takes care of the label when the `sf-srs`
adapter supports it; otherwise do it manually:

```bash
gh issue edit <ticket> --remove-label srs:drafting
```

### 4. CLOSE THE DRAFTING TICKET

```bash
.claude/skills/sf-workflow/workflow-cli.sh transition-drafting <ticket> done
```

This internally calls `update-status <ticket> Done` with the SRS guard bypassed (via `SF_WORKFLOW_BYPASS_SRS_GUARD=1`) because the transition is legitimate for a closed drafting lifecycle.

## Exit Conditions

- `srs-cli.sh spawn` exited 0
- All children exist in Backlog with correct titles and body
- Parent drafting ticket no longer carries the `srs:*` label
- Parent ticket is in board status `Done`

## Next Status (drafting lifecycle)

**Done** — the ticket is archived. Children follow the normal code-path workflow from Backlog.

## Errors to Avoid

❌ NEVER spawn before approval ❌ NEVER edit child tickets to paste code-path statuses on them — leave them in `Backlog`, the team sequences them like any other ticket ❌ NEVER close the drafting
ticket by hand with `update-status <ticket> Done` bypassing the CLI — the guard exists to flag broken flows and we want the flag to stay informative
