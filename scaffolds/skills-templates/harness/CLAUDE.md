# {{PROJECT_NAME}}

AI-assisted workflow harness installed by SaaSFoundry (CLI v{{VERSION}}). This project keeps its own technical stack — SaaSFoundry only manages the AI collaboration layer (workflow, skills, SRS).

## 🧭 Preconditions first (read before asking questions)

Before asking the user anything about scope, workflow, or tooling, **read the manifest and check the configured tools**:

1. Read `.saasfoundry.json` — source of truth for the workflow configuration, SRS backend, and installed modules. Never re-ask what is already declared there.
2. Run `sf status --claude-friendly --no-network` for a summary of the manifest and preconditions. On a configured session this is auto-injected via the `SessionStart` hook in `.claude/settings.json`.
3. If a precondition is `fail`, route the user to the relevant install/config CLI (`sf workflow`, `sf update --add-modules srs`, `sf skill install`) instead of asking scope questions.

## Git Workflow

- Main branch: `{{MAIN_BRANCH}}` (see `.saasfoundry.json` → `workflow.workingBranch` / `prTargetBranch` — never hardcode branch names)

## Development Commands

Document this project's build, test, and lint commands here so the AI can validate its changes — SaaSFoundry does not manage this project's technical stack.
