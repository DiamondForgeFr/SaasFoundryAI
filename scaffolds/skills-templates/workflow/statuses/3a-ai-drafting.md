# STATUS (drafting lifecycle): AI Drafting

**ROLE**: AI produces the first draft of the SRS page in the configured backend (Notion, Confluence, local markdown, …).

> This status is **not** a board column. It's a _logical sub-phase_ of `In progress` reached exclusively by tickets carrying `srs:drafting | srs:update | srs:new`. The board column stays `In progress`
> throughout the drafting lifecycle.

## When to Enter This Status

- Ticket is in board status `In progress`
- Ticket carries exactly one SRS label (`srs:drafting`, `srs:update`, or `srs:new`)
- Brainstorm phase is complete — the owner has finished sharpening the ticket body and is ready for AI to draft

## Mandatory Actions

### 1. RUN THE DRAFTER

```bash
.claude/skills/sf-workflow/workflow-cli.sh transition-drafting <ticket> ai-draft
```

This dispatches to `.claude/skills/sf-srs/scripts/srs-cli.sh draft --ticket <ticket>`, which:

- Reads `tools.srs.backend` from `.saasfoundry.json`
- Resolves the matching `SrsAdapter`
- Produces an `EpicSpec` or `FrSpec` from the ticket body + linked context
- Writes the draft to the backend via `adapter.createEpicPage` / `createFrPage`

### 2. POST THE DRAFT URL

After `srs-cli.sh draft` succeeds, post the backend page URL as a ticket comment so the human reviewer can find it without leaving the board.

### 3. KEEP THE BOARD STATUS ON `In progress`

Do not touch the board during this phase — the column stays `In progress` until the whole drafting lifecycle closes with `transition-drafting done`.

## Exit Conditions

- `srs-cli.sh draft` exited 0
- Backend page URL posted as ticket comment
- No backend error left unresolved

## Next Status (drafting lifecycle)

**Human review** — see `statuses/3b-human-review.md`.

## Errors to Avoid

❌ NEVER hand-draft the spec — always go through the skill CLI so the backend adapter stays the single integration point ❌ NEVER move the ticket to `AI testing` — code-path statuses are blocked by
the SRS guard ❌ NEVER bypass `srs-cli.sh draft` with direct backend SDK calls ❌ NEVER delete the `srs:*` label until `spawning` succeeds — the label is what keeps the ticket in the drafting
lifecycle
