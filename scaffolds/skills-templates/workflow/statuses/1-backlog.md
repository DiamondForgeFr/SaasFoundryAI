---
status: Backlog
banner_ai: Detect + persist the complexity label, analyze and plan per complexity, challenge the specs
banner_human: Validate specs + plan (→ Ready), then confirm pickup priority (→ In progress)
next_status: Ready
---

# STATUS: Backlog

Preparation: complexity, analysis, plan, validated specs. The developer validates the specs (→ Ready), then confirms the pickup priority (→ In progress). No branch and no code before Ready.

## Steps

1. **Detect the complexity** (a suggestion): `.claude/skills/sf-workflow/scripts/detect-complexity.sh <ticket>`.
2. **Persist the label:** `.claude/skills/sf-workflow/workflow-cli.sh retag <ticket> <bug|low|medium|complex>`. Done when `get-complexity <ticket>` prints one of the four, not `(none)`:
   `update-status` refuses every move out of Backlog without the `complexity: *` label.
3. **Analyze:** `.claude/skills/sf-workflow/scripts/analyze.sh <ticket> <complexity>`; follow its guidance. A delegated analysis is an `exploration` ([delegation.md](../reference/delegation.md)).
4. **Plan:** `.claude/skills/sf-workflow/scripts/plan.sh <ticket> <complexity>`; follow its guidance. On `medium` and `complex`, post the plan and wait for its approval; a delegated plan is
   `planning`.
5. **Challenge the specs:** ask questions, surface edge cases, propose alternatives. The ticket states the problem or need, the acceptance criteria, the technical context and its complexity.
6. **Wait for the developer's validation.** Done when the label is on the ticket, the analysis and the plan are complete as the level requires, and the developer validated that the specs are complete,
   which moves the ticket to Ready: move it on their word only.

| Level      | Analyze     | Plan                     |
| ---------- | ----------- | ------------------------ |
| 🐛 bug     | skip        | skip                     |
| 🟢 low     | minimal     | mental                   |
| 🟡 medium  | 2–4 agents  | file-by-file + approval  |
| 🔴 complex | 6–10 agents | comprehensive + approval |
