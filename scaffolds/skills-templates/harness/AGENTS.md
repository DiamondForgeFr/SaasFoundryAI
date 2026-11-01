# {{PROJECT_NAME}}

AI-assisted workflow harness installed by SaaSFoundryAI (CLI v{{VERSION}}). This project keeps its own technical stack — SaaSFoundryAI only manages the AI collaboration layer (workflow, skills, SRS).

This file is the project's instructions for every coding agent. Claude Code reads it natively; host-specific additions live beside it (`.claude/rules/claude-code.md` for Claude Code, `GEMINI.md`
for Gemini CLI).

## 🧭 Preconditions first (read before asking questions)

Before asking the user anything about scope, workflow, or tooling, **read the manifest and check the configured tools**:

1. Read `.saasfoundry.json` — source of truth for the workflow configuration, SRS backend, and installed modules. Never re-ask what is already declared there.
2. Run `sf status --agent-friendly --no-network` for a summary of the manifest and preconditions. Some hosts run it automatically at session start.
3. If a precondition is `fail`, route the user to the relevant install/config CLI (`sf workflow`, `sf update --add-modules srs`, `sf skill install`) instead of asking scope questions.

## Skills

The procedures (workflow, SRS, tool adapters) are skills named `sf-*`. Claude Code discovers them under `.claude/skills/`; other agents read the copies under `.agents/skills/`, or the
`.claude/skills/<name>/SKILL.md` file explicitly when no copy exists. Before a status transition, read the matching status document and run the guarded workflow CLI
(`.claude/skills/sf-workflow/workflow-cli.sh`), never raw board mutations.

## Output language

Everything you produce — SRS pages, tickets and their comments, code comments, commit messages — is written in the language declared in `.saasfoundry.json` → `language`, which defaults to English on
all three surfaces (`srs`, `tickets`, `codeComments`).

**The language of the conversation is not the signal.** Talking with the user in French does not make the artefacts French. `sf status --agent-friendly` prints the resolved values.

## Git Workflow

- Main branch: `{{MAIN_BRANCH}}` (see `.saasfoundry.json` → `workflow.workingBranch` / `prTargetBranch` — never hardcode branch names)
- **Branch naming — the ticket number is mandatory.** Read the patterns from `.saasfoundry.json` → `workflow.branchNaming`; the defaults are `feature/{N}-{description}` and `fix/{N}-{description}`.
- **Why the `{N}` prefix is not cosmetic:** the workflow guards resolve a ticket's PR by matching `^(feature|fix)/<ticket>(-|$)` against open PR head branches. A branch without the ticket number
  matches nothing, so the `→ In Review` PR-existence guard and the `→ Done` PR-merged guard both fail — and the only way forward becomes `SF_WORKFLOW_BYPASS_*` on every ticket, silently disabling the
  guards project-wide. If the pattern and the regex ever disagree, realign `branchNaming`; never "fix" the regex.
- Commit format: see `.saasfoundry.json` → `workflow.commitFormat` (a ticket reference is required when `requireTicket` is true).

## Development Commands

Document this project's build, test, and lint commands here so the agent can validate its changes — SaaSFoundryAI does not manage this project's technical stack.

<!-- saasfoundry:generated:start -->
<!-- saasfoundry:generated:end -->
