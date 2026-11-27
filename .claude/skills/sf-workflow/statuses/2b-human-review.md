---
status: Human Review (drafting lifecycle — board column stays "In progress")
banner_ai: Waiting — apply your review feedback to the draft pages
banner_human: Review the SRS pages and approve, or request changes on the ticket
next_status: Spawning (see `statuses/2c-spawning.md`)
---

# STATUS (drafting lifecycle): Human Review

The spec owner reviews the AI-drafted backend page, iterates until it reflects the team's intent and signals approval. Start when [2a-ai-drafting.md](2a-ai-drafting.md) is complete: the spec is
written and the page URL is on the ticket. The column stays `In progress` and the `srs:*` label stays in place (spawning clears it, not this phase).

## Steps

1. **Trigger the phase:** `.claude/skills/sf-workflow/workflow-cli.sh transition-drafting <ticket> human-review`.
2. **Post the review checklist** below as a ticket comment.
3. **Iterate with the owner:** edit the page, or run another `ai-draft` round; there is no round limit. A draft that `ai-draft` wrote is still unreviewed: spawning from it forces mid-cycle reshapes.
4. **Wait for the approval.** Done when the owner signalled it (a `/approve` comment, or the team's own convention) and the backend page reflects the agreed scope.

## Review checklist template

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
