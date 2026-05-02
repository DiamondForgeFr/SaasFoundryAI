# SaaSFoundry — v1.0 Release Objectives

> **Status:** Captured 2026-04-25 from product owner (AGachet) during release-readiness audit. **Purpose:** Acceptance rubric for the v1.0 stable release. Use this to gate "are we ready?" decisions
> and to spot scope drift on incoming tickets. **Source of truth:** this file. The mirrored entry in agent memory (`project_release_objectives.md`) exists for AI sessions but defers to this document
> on conflict.

---

## 1. Generated application (mono + multirepo)

| #   | Objective                                                       | Notes                                                                                   |
| --- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A1  | One command produces a clean monorepo **or** multirepo scaffold | User starts on business features immediately, no plumbing tax                           |
| A2  | Database **RBAC-ready** out of the box                          | Roles, permissions, guards wired — not stubbed                                          |
| A3  | **S3 usable directly** (not stub)                               | Upload/download flow works with sane defaults                                           |
| A4  | Monorepo is **optimized**                                       | Zero duplication of shared resources between apps (types, configs, UI primitives, etc.) |
| A5  | Backend **modular**                                             | Easy to evolve a module OR split into a microservice later without rewriting            |
| A6  | Frontend "**exemplar**"                                         | Opinionated example pages + design rules a team can follow                              |
| A7  | **Cohesion guardrails**                                         | Lint, commitlint, husky hooks, conventions — any contributor stays in line              |

## 2. CLI (`sf`)

| #   | Objective                                           | Notes                                                                                                                 |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| C1  | One-command project creation                        | `sf new`                                                                                                              |
| C2  | Modular generation                                  | User picks only what they need                                                                                        |
| C3  | **Add a previously-skipped module later**           | Post-install module installation on an existing project                                                               |
| C4  | **Cross-version update path** ✅ v2.0.0              | Closed by Epic #310 — manifest + module migration framework. See `.claude/docs/migration-framework.md`                |
| C5  | Install **AI tool skills** for ticketing/services   | GitHub + GitHub Projects today; Notion / Jira / ClickUp / Linear later — uniform install pattern                      |
| C6  | Install **AI tool skills** for SRS backends         | Notion today; Confluence + others later                                                                               |
| C7  | Install **strategic ticketing skill** (workflow AI) | Actions adapt to ticket complexity; dispatched on whichever ticketing tool is configured                              |
| C8  | Install **strategic SRS skill**                     | Drafts/maintains SRS on whichever doc tool is configured                                                              |

## 3. AI layer (Claude skills)

| #   | Objective                                                                                               | Notes                                                               |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| AI1 | **Central skill** giving Claude full mastery of the `sf` CLI                                            | One canonical entry point                                           |
| AI2 | **Integration-rules skill** for adding features in mono/multi (API + frontend)                          | Where things go, how they're wired                                  |
| AI3 | Workflow skill follows configured workflow **to the letter** on generated projects                      | No bypass paths                                                     |
| AI4 | SRS skill **infers and updates SRS** from user conversation, then opens tickets via the configured tool | Conversation → SRS → tickets                                        |
| AI5 | **Always read `.saasfoundry.json` first**                                                               | Manifest grounds every action                                       |
| AI6 | Deep mastery of **ticket hierarchy** (Epic / Story-FR / Task-SUB)                                       | Knows how to author each level                                      |
| AI7 | Pre-`sf new` advisory                                                                                   | Asks user about project intent, recommends a config, then scaffolds |
| AI8 | **Documentation complete + clear + marketing-grade**                                                    | "Sexy" — must make people want to use the CLI                       |
| AI9 | **Test coverage** sufficient to prevent regressions                                                     | Across CLI + AI + scaffolds                                         |

---

## How to use this document

- **Audit checkpoint** — Compare current product state to this list before tagging an RC.
- **Scope-creep filter** — When a new ticket is proposed, check whether it advances one of these objectives or merely decorates the product. Flag the latter.
- **"What's missing for v1.0?"** — Answer is derived from gaps in this list, not from the backlog snapshot.

## Change log

| Date       | Author  | Change                               |
| ---------- | ------- | ------------------------------------ |
| 2026-04-25 | AGachet | Initial capture during release audit |
