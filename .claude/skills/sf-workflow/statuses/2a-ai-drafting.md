---
status: AI Drafting (drafting lifecycle — board column stays "In progress")
banner_ai: Draft the DraftCandidate[] spec from the ticket, write it through the SRS backend and post the page links on the ticket
banner_human: Wait for the draft — your review comes next (human-review phase)
next_status: Human review (see `statuses/2b-human-review.md`)
---

# STATUS (drafting lifecycle): AI Drafting

The agent produces the first draft of the SRS pages in the configured backend (Notion, Confluence, local markdown, …). No CLI drafts a new feature from a ticket: you write the `DraftCandidate[]` spec,
and the CLI writes it. Start when the ticket is `In progress`, carries exactly one `srs:*` label and its brainstorm is sharp enough to draft. The board column stays `In progress` until
`transition-drafting done`.

## Steps

1. **Read the procedure:** `.claude/skills/sf-workflow/workflow-cli.sh transition-drafting <ticket> ai-draft` (no option: it prints the procedure and touches nothing).
2. **Draft the spec** as a `DraftCandidate[]` JSON file: one `epic` candidate for the feature, one per version (`parentId` = the feature id), one `fr` candidate per FR (`parentEpicId` = its version
   id). See `.claude/skills/sf-srs/templates/examples/example-three-levels.spec.json`. To start from existing material, `ai-draft --from notion-pages --ids <id,...>` or
   `ai-draft --from codebase [--path <dir>]` prints it as JSON.
3. **Check it offline:** `.claude/skills/sf-srs/scripts/srs-cli.sh validate --spec <file>` (no backend call).
4. **Write it:** `transition-drafting <ticket> ai-draft --spec <file>` dispatches to `srs-cli.sh write --spec <file>`, which resolves the `SrsAdapter` from `tools.srs.backend` and writes every page.
   The backend adapter is the single integration point: go through the skill CLI, never a backend SDK. Done when the command exits 0.
5. **Post the page URL** as a ticket comment so the reviewer can jump without leaving the board.

Keep the `srs:*` label until spawning succeeds: it holds the ticket in the drafting lifecycle.
