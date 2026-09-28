# One source of truth for product requirements

SaaSFoundryAI does not hide product decisions inside a chat transcript or invent a private specification store. It writes structured requirements to the system your team can inspect, search, review,
and retain after the AI session ends.

In v1, that system is **Notion**. The SRS engine is backend-neutral, but Notion is the only end-to-end adapter shipped today. Confluence and local Markdown are roadmap backends, not configuration
options you can rely on yet.

::: tip The contract in one sentence

The agent may propose and structure a requirement; **your team approves it, and your configured SRS backend keeps the durable record**.

:::

## Why specifications live outside the conversation

An AI conversation is useful working memory. It is a poor system of record: sessions are personal, context can be compacted, and decisions are difficult for the rest of the team to discover.

An external SRS gives every contributor the same reference point:

| Need           | What the shared SRS provides                                                       |
| -------------- | ---------------------------------------------------------------------------------- |
| Product review | Non-technical stakeholders can read and comment without opening the repository.    |
| Auditability   | Requirements, design decisions, and tests remain visible after the coding session. |
| Search         | A teammate can find a requirement by feature, identifier, or wording.              |
| Traceability   | UR, FR, DS, TC, and delivery tickets link back to one another.                     |
| Portability    | The workflow depends on an adapter contract, not on chat history or one AI vendor. |

This is not a claim that Notion is always better than files in Git. It is the v1 product choice for teams that need product and engineering to share the same readable surface. A local-Markdown adapter
is planned for teams that deliberately want specifications reviewed and versioned in the repository.

## What ships in v1

| Capability                            | Status  | Meaning                                                                                                   |
| ------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| Backend-neutral `SrsAdapter` contract | Shipped | Drafting, browsing, writing, updating, and ticket spawning do not import a provider directly.             |
| Notion SRS adapter                    | Shipped | Page creation, child-page traversal, append-only updates, and SRS-driven ticket creation work end to end. |
| Confluence SRS adapter                | Roadmap | The adapter contract anticipates it; the implementation does not ship yet.                                |
| Local-Markdown SRS adapter            | Roadmap | Planned for Git-native specifications; not available in v1.                                               |
| Conversational requirement capture    | Shipped | The agent proposes an ADD-only change and waits for approval before writing.                              |
| Evidence-first ticket reconciliation  | Shipped | Spawning compares the SRS, board, and implementation before creating or reusing a ticket.                 |

::: warning Backend-neutral does not mean every backend is available

`tools.srs.backend` selects a registered implementation. In v1, the valid operational value is `notion`. Choosing an unregistered backend fails explicitly instead of silently falling back.

:::

## The flow from idea to durable requirement

```text
Your message
    │
    ▼
local intent detector ── no signal ──▶ continue the current task
    │ requirement signal
    ▼
agent proposes a typed diff: UR / FR / DS / TC
    │
    ├── reject ──▶ no write
    ├── edit   ──▶ revise the proposal
    └── accept ──▶ sf srs apply-update
                         │
                         ▼
                  configured SrsAdapter
                         │
                         ▼
                    Notion page
```

The detector is local and fast. It looks for requirement language in the prompt and emits a reminder to the coding agent. It does **not** send the prompt to Notion, and it does not authorize a write.

The agent may fire at most once per conversation turn. It must show the proposed destination and content, then wait for `accept`, `edit`, or `reject`. Only an explicit acceptance reaches
`sf srs apply-update`.

## A traceable specification model

SaaSFoundryAI uses five connected categories:

| Category                             | Question answered                               | Example                                                       |
| ------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------- |
| **UR** — User Requirement            | Why does a person or business need this?        | An account owner can restrict access to one legal entity.     |
| **FR** — Functional Requirement      | What observable behavior must exist?            | The role editor assigns entity-scoped permissions.            |
| **DS** — Design Specification        | How is the behavior represented or implemented? | `UserRoleAssignment` stores the scope and target entity.      |
| **TC** — Test Case                   | How do we prove the requirement?                | A user assigned to entity A cannot read entity B.             |
| **NFR** — Non-functional Requirement | Which quality constraint applies?               | Authorization checks add less than the agreed latency budget. |

The identifiers create a readable chain:

```text
UR-001 ──▶ FR-003 ──▶ DS-004
              └────▶ TC-007
              └────▶ NFR-002
```

The links matter more than the numbering. A reviewer can start from a user need, see the promised behavior, inspect its design, and find the evidence that proves it.

## Schema-driven, not improvised

When SaaSFoundryAI drafts from an existing codebase, scanners collect facts such as operations, persistent entities, UI flows, tests, and documentation excerpts. The shared `clustering-rules.json`
then defines how the agent turns those findings into reviewable candidates.

The process is deliberately layered:

1. **Collect evidence** from the repository. Scanner coverage is best-effort, so unsupported stacks require direct source inspection rather than an assumption that nothing exists.
2. **Group by product area** using the repository's own structure instead of forcing a framework-specific folder convention.
3. **Propose Features, Versions, and FRs** around coherent behavior, not around individual files.
4. **Seed DS and TC items** from models, operation contracts, UI forms, and executable tests.
5. **Mark gaps**. An uncovered operation becomes a visible TODO test case; it is never presented as tested.
6. **Ask a human to validate** inferred requirements and every proposed NFR before writing.

The rules are structured data so the drafting behavior can be reviewed and tested. They are guidance for an agent, not permission to fabricate missing product intent.

## The dedicated drafting lifecycle

Specification work does not pretend to be code delivery. A ticket carrying `srs:new`, `srs:update`, or `srs:drafting` stays inside the board's **In progress** column while it follows its own phases:

```text
Ready
  └─▶ In progress / brainstorm
         └─▶ ai-draft
                └─▶ human-review
                       └─▶ spawning
                              └─▶ Done
```

- **Brainstorm** establishes intent and scope.
- **AI draft** writes the proposed page tree through the configured adapter.
- **Human review** happens in the SRS backend, where product and engineering can refine it together.
- **Spawning** creates or reuses delivery tickets only after the page tree is approved.
- **Done** closes the drafting ticket; the spawned delivery tickets begin their normal workflow in Backlog.

This separation keeps the board readable: the drafting ticket records the specification decision, while each generated Story records implementation and delivery.

## Spec-to-ticket reconciliation

SaaSFoundryAI does not convert every FR into a fresh ticket blindly. Before spawning, the reconciliation plan must verify three evidence sources:

1. **Board** — existing open and closed tickets, native parentage, status, and canonical SRS links.
2. **SRS** — the selected Feature or Version and its complete FR set.
3. **Implementation** — evidence that a requirement is delivered, partial, missing, or superseded.

Every selected FR receives exactly one classification:

| Classification | Result                                                                |
| -------------- | --------------------------------------------------------------------- |
| `delivered`    | Skip creation; retain the evidence.                                   |
| `superseded`   | Skip creation; retain why it no longer applies.                       |
| `partial`      | Reuse the one exact canonical ticket, or create one when none exists. |
| `missing`      | Reuse the one exact canonical ticket, or create one when none exists. |

Spawning stops before mutation when an evidence source is unavailable, the plan does not cover the exact FR set, multiple tickets claim the same canonical page, or an existing ticket belongs to
another parent. This is a duplication guard, not a best-effort import.

## Configuration and credentials

The manifest stores provider identity and durable page references, never the secret:

```jsonc
{
  "tools": {
    "srs": {
      "enabled": true,
      "backend": "notion",
      "intentDetectorEnabled": true,
      "rootPage": {
        "id": "...",
        "url": "https://www.notion.so/...",
        "name": "Product SRS"
      }
    }
  }
}
```

`NOTION_API_TOKEN` stays in the environment or the configured secret store. The Notion integration must be shared only with the parent pages it needs to read or update.

## You remain in control

There are several opt-out levels:

- **Per proposal:** choose `reject`; nothing is written. Choose `edit` to refine the diff first.
- **Automatic detection off:** set `tools.srs.intentDetectorEnabled` to `false`. You can still request SRS work explicitly.
- **SRS flow off:** set `tools.srs.enabled` to `false` to disable both automatic proposals and the conversational update flow.
- **No SRS module:** do not enable it during `sf new`, or leave it out when running `sf update`.

Disabling the detector is not a data migration. Existing Notion pages remain where your team owns them.

## Intentional v1 limits

- Conversational updates are **ADD-only**. The Notion adapter appends a clearly labeled item; a reviewer folds it into the canonical section during the next SRS review.
- An AI proposal is not approval. No requirement update is written until the user accepts it.
- Code scanners provide evidence, not exhaustive understanding. Sparse findings require human-guided inspection.
- Confluence and local Markdown are architectural destinations, not shipped adapters.
- SRS centralization does not replace tickets. The SRS defines the product contract; the board records delivery.

## Continue

- [Run the Notion walkthrough](/srs/walkthrough)
- [Understand the drafting lifecycle](/srs/lifecycle)
- [Read the scanner finding contract](/srs/scanner-findings)
- [See how tools remain systems of record](/features/your-tools)
