# SRS Lifecycle

The SRS module runs its own mini-lifecycle inside the existing workflow. Rather than reinvent a board, it carves out a corridor between **Ready** and **Done** for tickets that carry an `srs:*` label,
while non-SRS tickets keep following the seven standard statuses untouched.

This page explains what each phase is for, how to drive a ticket through it, and where the SRS lifecycle meets the code-path workflow.

## The two lanes

On an SRS-enabled project, tickets flow through one of two lanes depending on their label:

| Label                                       | Lane        | Status path                                                                     |
| ------------------------------------------- | ----------- | ------------------------------------------------------------------------------- |
| _(none)_ or non-`srs:*`                     | Code path   | `Backlog → Ready → In progress → AI testing → Human testing → In review → Done` |
| `srs:drafting` \| `srs:update` \| `srs:new` | SRS drafter | `Backlog → Ready → In progress → ai-draft → human-review → spawning → Done`     |

The SRS lane sits inside the board's `In progress` column — you don't see extra columns on the GitHub Projects board, but `workflow-cli.sh` knows which lane a ticket belongs to via its labels.

::: tip Which label do I pick? `srs:new` for a brand-new Epic tree · `srs:drafting` for an Epic being drafted from existing notes · `srs:update` for a revision on an existing Epic. All three enter the
same lane — the label is descriptive, the lane is identical. :::

## The six SRS phases

### 1. Backlog

Same as a code-path ticket. The owner:

- Describes the Epic / FR / update they want to land
- Attaches the `srs:*` label
- Sets complexity (see [Complexity System](/workflow/complexity-system))

Nothing SRS-specific happens yet.

### 2. Ready

Same as a code-path ticket. Specs are validated. Claude confirms it understands the scope, challenges gaps, waits for the owner's go.

### 3. In progress (brainstorm)

The ticket is picked up. Claude and the owner scope the drafting session — what pages to touch, whether to ingest existing notes, what the target Epic page tree should look like. No files are written
yet.

Exit : both agree the inputs are sharp enough to run the drafter.

### 4. ai-draft

The AI drafter runs against the configured backend.

```bash
.claude/skills/sf-workflow/workflow-cli.sh transition-drafting <ticket> ai-draft
```

What happens in this phase depends on the source :

- **Ingestion path** (when `pendingIngestion` is set, or the owner pointed at existing notes) : Claude calls `srs-cli.sh browse` to pick pages worth ingesting, then
  `srs-cli.sh draft --from notion-pages --ids ...` to fetch them as `RawContent`. Claude reads the raw content and proposes a `DraftCandidate[]` list (one Epic + its FR children) in the conversation.
  On owner approval, `srs-cli.sh write --spec <tmp.json>` applies the draft to the backend.
- **Codebase path** (mature project, the source tree is the truth of record) : Claude runs `srs-cli.sh draft --from codebase` — five scanners emit `ScannerFinding[]` for endpoints, UI flows, Prisma
  entities, specs, and docs. Claude clusters findings by `area`, proposes one Epic at a time in conversation, and writes accepted clusters via `srs-cli.sh write`. See
  [Scanner findings reference](/srs/scanner-findings) for the full JSON shape.
- **Green-field path** (no source notes) : Claude drafts the `EpicSpec` + `FrSpec[]` directly from conversation, serialises to `DraftCandidate[]`, then runs `srs-cli.sh write`.

At the end of this phase, the backend has an Epic page + one FR child page per requirement. `tools.srs.pendingIngestion` is cleared if it was set.

Exit : `write` returned exit code 0, pages are visible on the backend.

### 5. human-review

```bash
.claude/skills/sf-workflow/workflow-cli.sh transition-drafting <ticket> human-review
```

The spec owner reviews the backend page tree :

- Main spec page — overview, scope, user personas, traceability table
- FR-001, FR-002, ... pages — each with UR / FR / DS / TC blocks

If edits are needed, the owner does them directly on the backend. The drafter is **not** re-run — small tightenings live in the page; if the whole Epic needs a redo, go back to ai-draft.

Exit : owner explicitly approves (comments "OK to spawn" or bumps the transition manually).

### 6. spawning

```bash
.claude/skills/sf-workflow/workflow-cli.sh transition-drafting <ticket> spawning
```

The spawner enumerates FR page children of the Epic, renders each Story body from `renderStoryTicketBody`, and calls `workflow-cli.sh create-subtask --bypass-srs spawned-from-srs` to create one GitHub
sub-issue per FR under the parent ticket.

```bash
.claude/skills/sf-srs/scripts/srs-cli.sh spawn --ticket <parent> --epic <epic-url-or-id>
```

Each spawned child :

- Lands in the parent's sub-issues list
- Tagged `srs:new` so anyone can trace it back to the SRS Epic
- Has a body rendered from `renderStoryTicketBody` : a summary, the FR page link, acceptance criteria pulled from the TC blocks, and the traceability chain (UR → FR → DS → TC)
- Sits in **Backlog** — ready to flow through the normal code-path workflow from there

Use `--dry-run` first to preview without writing. The spawner is idempotent via stable FR-id matching, so re-running it on the same Epic won't duplicate tickets.

Exit : every FR page has a matching child issue in Backlog. Board moves the drafter ticket to **Done**.

### 7. Done

Same as a code-path ticket. The drafter ticket is closed. Its child Stories live on, each following the code-path lane independently.

## Commands — one-page reference

All commands are driven from two wrappers :

| Command                                                | What it does                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `workflow-cli.sh transition-drafting <ticket> <phase>` | Moves the drafter ticket through `ai-draft \| human-review \| spawning \| done` |
| `srs-cli.sh validate`                                  | Smoke-test the configured backend (`adapter.init()`)                            |
| `srs-cli.sh browse --parent <id>`                      | List direct children of a backend page                                          |
| `srs-cli.sh draft --from notion-pages --ids <ids>`     | Fetch pages as `RawContent` for conversational drafting                         |
| `srs-cli.sh write --spec <path>`                       | Apply `DraftCandidate[]` to the backend (creates Epic + FR pages)               |
| `srs-cli.sh spawn --ticket <parent> --epic <url>`      | Create one Story sub-issue per FR page                                          |
| `srs-cli.sh apply-update < patch.json`                 | Conversational eval hook — append new UR / FR / DS / TC (ADD-only v1)           |
| `srs-cli.sh eval [--review-packet <path>]`             | Batch freshness score SRS vs. codebase (L1 script + L2 hints + L3 AI packet)    |

::: warning `update-status` is gated on SRS tickets `workflow-cli.sh update-status <ticket> "AI testing|Human testing|In review"` is **rejected** when the ticket carries an `srs:*` label. SRS tickets
have their own phases (`ai-draft`, `human-review`, `spawning`) — always use `transition-drafting` instead. The guard fails open if label fetch errors so networked teams aren't punished by
infrastructure hiccups. :::

## Continuous evaluation (conversational)

Outside of the drafter lifecycle, `tools.srs.enabled = true` turns on a conversational hook : when a chat turn reads like a new **User Requirement**, **Functional Requirement**, **Design decision**,
or **Test Case**, Claude **interjects**, proposes a diff, and — on accept — applies it through `srs-cli.sh apply-update`.

Detection heuristics (summarised here ; canonical list lives in
[`sf-srs/SKILL.md § Conversational eval hook`](https://github.com/DiamondForgeFr/SaaSFoundryAI/blob/develop/.claude/skills/sf-srs/SKILL.md)) :

| Signal                               | Target                             | Example                                                         |
| ------------------------------------ | ---------------------------------- | --------------------------------------------------------------- |
| Describes a user need / outcome      | new **UR** on the Epic page        | "users should be able to log in with SSO"                       |
| Defines a new feature / rule         | new **FR** page under the Epic     | "we need a feature that lets admins export audit logs as CSV"   |
| Clarifies an implementation decision | new **DS** on the relevant FR page | "let's use BCrypt with cost factor 12 for password hashing"     |
| Adds an acceptance / test condition  | new **TC** on the relevant FR page | "and a test that proves unicode passwords are accepted"         |
| Reopens a previously closed decision | likely FR or DS revision           | "on reconsidère la règle : finalement on autorise les chiffres" |

Trivial turns (`ok`, `thanks`, pure tool results, formatting tweaks) are skipped. The confirmation flow is :

```
💡 Ce que tu viens de décrire ressemble à <UR / FR / DS / TC>. Proposition :
  • <target page> — add <item id> : <narrative | title>
  • (if TC) steps : ...

J'applique via `srs-cli.sh apply-update` ? [accept / edit / reject]
```

- **accept** → Claude builds the patch JSON, calls `srs-cli.sh apply-update`, continues the coding task
- **edit** → rework the wording with the owner, then re-confirm
- **reject** → drop the proposal ; Claude does not re-propose the same item in the same conversation

### Scope limits (v1, intentional)

- **ADD-only** — tightening an existing UR / FR / DS / TC is out of scope. The current `SrsAdapter.updatePage` is append-only on Notion, so surgical section replacement isn't in the contract. A future
  SUB will extend the adapter with replace / delete semantics.
- **Append placement** — `add-ur` / `add-ds` / `add-tc` append under an "Added …" heading2 at the end of the target page. The canonical sections (User Requirements / Design / Test Cases) aren't
  updated in-place. Reviewers fold the appended block back into the right section during the next SRS review.
- **`add-fr`** creates a brand-new FR child page under the Epic via `adapter.createFrPage`. The Epic's "Traceability" table is **not** refreshed by the hook (same append-only limitation) — the new FR
  is still discoverable as a child page.
- **Throttling** — one proposal maximum per conversation turn. No persistent dedup cache — the turn boundary is sufficient.

## How the SRS lane meets the code-path lane

The seam is the **spawn** : at that moment, the drafter ticket hands off to N GitHub Stories, each of which now lives in its own code-path flow.

```
   SRS lane (drafter ticket, srs:* label)        Code-path lane (spawned Stories, srs:new label)

   Backlog → Ready → In progress                 [produced by spawn]
                    → ai-draft
                    → human-review
                    → spawning ──────────────▶   Backlog → Ready → ... → Done
                                             ▶   Backlog → Ready → ... → Done
                                             ▶   Backlog → Ready → ... → Done
                    → Done
```

- Drafter ticket : **one** lifecycle pass, closed when the pages land and the Stories are created
- Spawned Stories : **one normal code-path flow each**, independently claimed, implemented, tested, merged

If an FR evolves after spawning (a TC is added via the conversational eval hook, or a manual edit on the FR page), the Story ticket body isn't automatically re-rendered — the link back to the FR page
is the source of truth. When the Story is picked up, the implementer reads the current FR page.

## Next steps

- [SRS module overview](/modules/srs) — what ships, how to enable
- [SRS walkthrough](/srs/walkthrough) — a complete end-to-end tutorial
- [Updating projects → Enable SRS on an existing project](/guide/updating-projects#enable-srs-on-an-existing-project)
- The canonical skill contract : [`.claude/skills/sf-srs/SKILL.md`](https://github.com/DiamondForgeFr/SaaSFoundryAI/blob/develop/.claude/skills/sf-srs/SKILL.md)
