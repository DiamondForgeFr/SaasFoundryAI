# STATUS (drafting lifecycle): Human Review

**ROLE**: The spec owner reviews the AI-drafted backend page, iterates until it reflects the team's intent, then signals approval.

> Logical sub-phase of `In progress` — the board column stays `In progress`. Only tickets carrying an `srs:*` label reach this phase (via `ai-draft`).

## When to Enter This Status

- `3a-ai-drafting.md` is complete (`srs-cli.sh draft` exited 0)
- The backend page URL is posted as a ticket comment
- Ticket still carries its `srs:*` label

## Mandatory Actions

### 1. POST THE REVIEW CHECKLIST

```bash
.claude/skills/sf-workflow/workflow-cli.sh transition-drafting <ticket> human-review
```

This phase is intentionally _human-only_ — the CLI only prints a reminder of what must happen. Post the review checklist as a ticket comment (copy/paste template below, adjust to the kind of SRS):

```markdown
## Human review — SRS draft

**Backend page**: <paste URL from ai-draft phase>

Review checklist:

- [ ] Scope is aligned with the ticket intent
- [ ] Acceptance criteria are testable
- [ ] Dependencies & assumptions are explicit
- [ ] No sensitive data leaked into the page
- [ ] Links to parent Epic / related FRs are correct

Comment `/approve` (or apply the `srs:reviewed` label if your team uses it) when satisfied.
```

### 2. ITERATE WITH THE OWNER

Edit the backend page directly or ask for a re-draft round (`transition-drafting <ticket> ai-draft` again). There is no hard limit — the point is to stop when the spec is right, not after N rounds.

### 3. DO NOT TOUCH THE BOARD

Board status stays `In progress`.

## Exit Conditions

- Owner has signalled approval (comment `/approve` or team-specific convention)
- Backend page reflects the final agreed scope
- `srs:*` label is still in place (cleared by `spawning`, not here)

## Next Status (drafting lifecycle)

**Spawning** — see `statuses/3c-spawning.md`.

## Errors to Avoid

❌ NEVER skip approval — spawning tickets from an unreviewed spec forces the team to reshape work mid-cycle ❌ NEVER advance to `spawning` just because `ai-draft` exited 0 ❌ NEVER remove the `srs:*`
label to "force" progress — it bypasses the guard and hides the drafting lifecycle from the board
