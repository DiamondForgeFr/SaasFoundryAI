---
status: Backlog
banner_ai: Detect + persist the complexity label, analyze and plan per complexity, challenge the specs
banner_human: Validate specs + plan, then confirm pickup (→ In progress)
next_status: In progress
---

# STATUS: Backlog

Preparation: complexity, analysis, plan, validated specs. In the solo workflow one developer "go" covers the spec validation and the pickup confirmation. No branch and no code until it comes.

## Steps

1. **Detect the complexity, as a suggestion only:** `.claude/skills/sf-workflow/scripts/detect-complexity.sh <ticket>` prints a level and persists nothing.
2. **Have the developer confirm the level.** Give the suggested level and ask the developer to confirm or change it: the developer decides, even when they already said "go". Persist nothing until they
   have answered.
3. **Persist the confirmed level:** `.claude/skills/sf-workflow/workflow-cli.sh retag <ticket> <bug|low|medium|complex>`. Done when `get-complexity <ticket>` prints that level, not `(none)`:
   `update-status` refuses every move out of Backlog without the `complexity: *` label, and a suggestion is not a label.
4. **Analyze:** `.claude/skills/sf-workflow/scripts/analyze.sh <ticket> <level>` with the confirmed level; follow its guidance. A delegated analysis is an `exploration`
   ([delegation.md](../reference/delegation.md)).
5. **Plan:** `.claude/skills/sf-workflow/scripts/plan.sh <ticket> <level>` with the confirmed level; follow its guidance. On `medium` and `complex`, post the plan and wait for its approval; a
   delegated plan is `planning`.
6. **Challenge the specs:** ask questions, surface edge cases, propose alternatives. The ticket states the problem or need, the acceptance criteria, the technical context and its complexity.
7. **Wait for the developer's go.** Done when the label is on the ticket, the analysis and the plan are complete as the level requires, and the developer validated the plan and confirmed the pickup.

| Level      | Analyze     | Plan                     |
| ---------- | ----------- | ------------------------ |
| 🐛 bug     | skip        | skip                     |
| 🟢 low     | minimal     | mental                   |
| 🟡 medium  | 2–4 agents  | file-by-file + approval  |
| 🔴 complex | 6–10 agents | comprehensive + approval |
