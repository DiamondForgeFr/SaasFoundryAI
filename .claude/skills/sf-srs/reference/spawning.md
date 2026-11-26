# Spawning: details

Read from `SKILL.md`, "Spawn tickets from a version", when a run goes beyond the everyday spawn.

## Reading a dry run

`--dry-run` writes nothing and prints one line per FR:

- `FR-X: new`: the run creates its Story. Only these appear in the `•` list.
- `FR-X: exists #929, skipped`: a ticket spawn reuses. `(closed)` marks one that stays closed. `ignored #1028 (closed as not planned)` is a duplicate a cleanup closed.
  `(linked under the delivery parent)` marks a Story with no parent, which joins the Epic instead of being created again.
- `FR-X: blocked — …`: the run exits 10, a dry run included, before the milestone or any ticket is touched. The line names the cause: two tickets for one page, a title that names the FR id without
  owning its page, or a match under another parent. Spawn never reparents a ticket implicitly: read the line to the user and let them decide. An FR id that a Story only cites in its body is a
  cross-reference, not a match.

With a reconciliation plan, the same lines read `partial → reuse #929`, `missing → create`, and so on.

## The Epic of a re-run

Without `--ticket`, the open `sf-epic` that a previous run created is adopted, not created again. Spawn recognises it by the version page link it wrote in the Epic body, then by its
`<feature> - <version>` title, so renaming the version page between two runs does not lose it. When the Stories hang under an Epic spawn cannot recognise (one made by hand), the run blocks and names
it: pass `--ticket <n>` if it is the version's Epic. `transition-drafting <N> spawning` passes the drafting ticket as `--drafting-ticket <N>`, and the Epic body says `Drafted in #N`. An Epic that
already exists keeps its milestone because it may span several releases; re-running the same spawn does not produce a second release.

## Cleaning up a duplicate

A duplicate Story created by an older spawn or by hand is cleaned up without a raw API call: detach it from the Epic so the Epic can reach Done, then close it as not planned so that every later spawn
ignores it.

```bash
.claude/skills/sf-workflow/workflow-cli.sh unlink-subtask <epic> <duplicate>
gh issue close <duplicate> --reason "not planned"
```

`unlink-subtask` refuses a child that belongs to another parent and does nothing for one that has none.

## Evidence-first reconciliation

When an approved SRS version may overlap existing work, the drafting transition requires `--reconciliation-plan`. Reuse itself does not wait for a plan; the plan adds the evidence that lets `spawn`
skip an FR as delivered or superseded. Build a versioned JSON plan that exactly covers every selected FR and records verified evidence from the board, the SRS and the implementation (source, tests or
docs). Classify each FR as `delivered`, `partial`, `missing` or `superseded`:

```json
{
  "version": 1,
  "sources": {
    "board": { "status": "verified", "evidence": ["Epic #42 and its open/closed native children inspected"] },
    "srs": { "status": "verified", "evidence": ["Approved version page and canonical FR links read"] },
    "implementation": { "status": "verified", "evidence": ["Relevant source, tests, and docs audited"] }
  },
  "requirements": [
    { "frId": "FR-AUTH-001", "classification": "delivered", "evidence": ["Delivered by #18; regression test auth.spec.ts"] },
    { "frId": "FR-AUTH-002", "classification": "missing", "evidence": ["No matching board ticket or implementation"] }
  ]
}
```

Preview, then apply the same command:

```bash
.claude/skills/sf-workflow/workflow-cli.sh transition-drafting 42 spawning \
  --epic <feature-url> --version <version-title-or-url> --milestone v1.0.0 \
  --reconciliation-plan /tmp/reconcile.json --dry-run
# remove only --dry-run after reviewing the plan
```

The preflight runs before the version Epic exists: a matching ticket with no parent is reused and linked under the Epic, one that already belongs to another parent blocks the run, and when every FR is
delivered or superseded no Epic is created. It fails before any mutation when a source is unavailable, coverage is incomplete, an FR id conflicts with its canonical page, or several tickets match. If
a create response is interrupted, retry the same command: the spawner inspects open and closed candidates, recovers the exact ticket, and links it only when it is truly orphaned.

## Failure modes

The milestone is ensured before any ticket exists, so a backend problem leaves an untouched board. When an assignment fails after the tickets are created, the run reports which ones joined and exits
9, rather than leaving a half-assigned board implicit.
