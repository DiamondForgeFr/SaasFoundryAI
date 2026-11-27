---
status: Spawning (drafting lifecycle — board column stays "In progress" → "Done" on transition-drafting done)
banner_ai: Spawn child tickets from the approved FR pages, then move the drafting ticket to Done
banner_human: Nothing — children land in Backlog for later prioritization
next_status: Done — children follow the normal code-path workflow from Backlog
---

# STATUS (drafting lifecycle): Spawning

Turn the approved SRS page into the tickets that drive implementation. Start when [2b-human-review.md](2b-human-review.md) is complete (owner approval signalled, backend page stable) and the ticket
still carries its `srs:*` label.

## Steps

1. **Record the preflight:** inspect the board, the approved SRS version and the implementation, and classify every selected FR as `delivered`, `partial`, `missing` or `superseded` in a version-1
   reconciliation JSON file. Spawning needs verified board, SRS and implementation evidence.
2. **Preview the spawner:**
   `.claude/skills/sf-workflow/workflow-cli.sh transition-drafting <ticket> spawning --epic <feature> [--version <version>] [--milestone <release>] --reconciliation-plan <path> --dry-run`
   - it dispatches to the SRS CLI; the version Epic is the delivery parent, created or adopted on a re-run (`--ticket <epic>` names an existing one), and the drafting ticket is only referenced
   - it blocks on unavailable evidence, incomplete coverage, conflicting FR identities, ambiguous matches or implicit reparenting
3. **Apply the reviewed plan:** rerun the exact command without `--dry-run`. After an uncertain create response, rerun the same command (not a changed plan) so canonical recovery can finish safely.
   - it renders the ticket templates from `sf-srs/templates/tickets/` (Epic or Story), skips delivered and superseded FRs, reuses canonical tickets and creates only the remaining children in
     **Backlog**; leave the children there, the team sequences them
4. **Verify the children:** `github-projects-cli.sh list-incomplete-children <epic>` (the Epic the spawn printed) lists every newly spawned child with its title and Backlog status; inspect each
   backend-page link.
5. **Complete the lifecycle:** `.claude/skills/sf-workflow/workflow-cli.sh transition-drafting <ticket> done`. It calls `update-status <ticket> Done` with `SF_WORKFLOW_BYPASS_SRS_GUARD=1` itself,
   keeps the `srs:*` label as durable provenance and uses no raw provider command to rewrite labels; do not move the drafting ticket by hand.

Done when `srs-cli.sh spawn` exited 0, every child exists in Backlog with its title and body, and the drafting ticket's board status is `Done`.
