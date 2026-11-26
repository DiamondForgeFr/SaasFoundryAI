# Feedback: module request

A catalogue slot is a long-term maintenance commitment, so the five-criterion scorecard runs before `sf feedback request`, and a request that does not fit is refused with its reasoning instead of
filed as noise. It runs when the Anti-Reinvention Guardrail returned `LOW` or `NONE` and the user wants to push for catalogue inclusion (`LOW` is "worth evaluating", never a green light to file), or
when the user asks ("file a module request", "request this as a module", "submit this to SaaSFoundryAI"). A bug report is `flows/feedback-bug.md`, and voting needs no scorecard.

## The 5-criterion scorecard

Ask each criterion as a natural question in the conversation, not as a dry form. Each answers `yes`, `no` or `unclear`, and one `no` or one `unclear` refuses the filing.

| Criterion            | The question behind it                                                             | What `yes` looks like                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `scopeFit`           | "Is this something every SaaS eventually wants?"                                   | It belongs to the SaaS baseline: auth, billing, email, storage, observability, comms, admin tooling         |
| `reusability`        | "Would 3+ unrelated projects plausibly want this?"                                 | Broad SaaS relevance, not specific to one product or industry                                               |
| `notAlreadySolvable` | "Can't this already be done cleanly with existing modules or a small custom impl?" | Existing modules do not cover it, and a hand-rolled version would be non-trivial (more than 2 days of work) |
| `opinionOwnership`   | "Is there a clear opinionated 'right way' to do this in SaaSFoundryAI?"            | You can name the stack, the vendor(s) and the integration surface without hedging                           |
| `maintenanceRealism` | "Can this be maintained long-term?"                                                | Stable dependencies, a non-fragile upstream, a vendor unlikely to pivot or shutter within 2 years           |

## Steps

1. Walk the five criteria and translate each answer to `yes`, `no` or `unclear` yourself; the host's structured question tool serves the user-facing choices.
2. Propose a kebab-case module name inferred from the intent ("real-time chat" becomes `chat`) and confirm it with the user.
3. Classify: pipe the intent, the name, the scorecard and an optional description into `scripts/plan-feedback-request.sh`. It fetches the open module-request issues with
   `sf feedback list --status open --json`, detects duplicates and emits a `decision`.
4. Act on `decision`:
   - `file-request`: show the emitted `sf feedback request …` command, get the user's explicit approval, then run it once `scripts/bootstrap-gh.sh` exits 0 (an unauthenticated `gh` fails confusingly).
     Quote the scorecard answers in the description so a reviewer sees the rationale.
   - `route-to-existing`: point the user at the duplicate (number, title, url) and offer `sf feedback vote <n> up` or `sf feedback vote <n> comment --comment "…"`, so the existing issue gathers
     traction in place of a parallel thread.
   - `refuse`: list the `redFlags` verbatim, with the reasoning, and suggest alternatives (custom code, an existing module, wait and see). The criteria protect the catalogue from scope creep, so the
     refusal stands unless the user brings new information: then rebuild the scorecard, since a criterion may be unblocked, and classify again.
5. Tell the user the outcome (file, route or refuse) and why, never a raw JSON dump.

Done when the user has heard the decision and, on `file-request`, the filing command exited 0.
