# Skills System

SaaSFoundry includes Claude-powered skills that assist with development tasks.

## Overview

Skills are specialized agents that help with:

- 🔧 **Git operations** - Commits, PRs, merges, conflict resolution
- 📋 **Project management** - Issue tracking, workflow automation
- 🛠️ **Utilities** - Error fixing, code formatting, grammar checks
- 🚀 **Workflows** - Systematic implementation patterns (APEX)

## Skill Naming Convention

SaaSFoundry skills use the **`sf-*` prefix** to distinguish them from generic skills:

- **`sf-git-commit`** - SaaSFoundry-specific commit workflow
- **`sf-utils-fix-errors`** - SaaSFoundry-specific error fixing
- **`sf-workflow-apex`** - SaaSFoundry-specific APEX implementation

**Why the prefix?**

- ✅ Clearly identifies SaaSFoundry-specific skills
- ✅ Avoids conflicts with generic Claude Code skills
- ✅ Integrates with SaaSFoundry workflow system (`.saasfoundry-workflow.json`)
- ✅ Follows project conventions and structure

**Generic vs SaaSFoundry Skills:**

| Type          | Prefix | Example         | Use Case                     |
| ------------- | ------ | --------------- | ---------------------------- |
| SaaSFoundry   | `sf-*` | `sf-git-commit` | SaaSFoundry projects         |
| Generic       | None   | `git-commit`    | Any Claude Code project      |
| Tool-specific | `sf-*` | `sf-tool-jira`  | Generated for workflow tools |

**In SaaSFoundry projects, always use `sf-*` skills** - they're configured to work with your project structure and workflow settings.

## Skill Location

Skills are stored in `.claude/skills/`:

```
.claude/
└── skills/
    ├── sf-git-commit/
    ├── sf-git-create-pr/
    ├── sf-utils-fix-errors/
    └── sf-workflow-apex/
```

## Core Skills

### Git Skills

| Skill                      | Command   | Description                               |
| -------------------------- | --------- | ----------------------------------------- |
| **sf-git-commit**          | `/commit` | Quick commit with minimal message         |
| **sf-git-create-pr**       | `/pr`     | Create PR with auto-generated description |
| **sf-git-fix-pr-comments** | `/fix-pr` | Implement all PR review comments          |
| **sf-git-merge**           | `/merge`  | Context-aware conflict resolution         |

### Utility Skills

| Skill                    | Command        | Description                                  |
| ------------------------ | -------------- | -------------------------------------------- |
| **sf-utils-fix-errors**  | `/fix-errors`  | Fix all ESLint and TypeScript errors         |
| **sf-utils-fix-grammar** | `/fix-grammar` | Fix grammar/spelling while preserving format |
| **sf-utils-oneshot**     | `/oneshot`     | Ultra-fast feature implementation            |

### Workflow Skills

| Skill                     | Command      | Description                                |
| ------------------------- | ------------ | ------------------------------------------ |
| **sf-workflow-apex**      | `/apex`      | Systematic APEX methodology implementation |
| **sf-workflow-apex-free** | `/apex-free` | APEX without adversarial review            |

## Tool-Specific Skills

Generated based on workflow tool selection:

| Tool            | Skill                     | Features                                  |
| --------------- | ------------------------- | ----------------------------------------- |
| GitHub Projects | `sf-tool-github-projects` | Issue management, sub-issues, GraphQL API |
| Jira            | `sf-tool-jira`            | Tickets, sub-tasks, sprints               |
| Notion          | `sf-tool-notion`          | Pages, databases, properties              |
| Linear          | `sf-tool-linear`          | Issues, sub-issues, cycles                |

## Using Skills

### In Claude Code

Skills are invoked via slash commands:

```
User: /commit
Claude: [Uses sf-git-commit skill to create commit]

User: /fix-errors
Claude: [Uses sf-utils-fix-errors to fix all lint errors]

User: /pr
Claude: [Uses sf-git-create-pr to create pull request]
```

### Auto-Trigger

Skills activate automatically based on keywords in your messages:

- "create commit" → sf-git-commit
- "fix errors" → sf-utils-fix-errors
- "create pr" → sf-git-create-pr

## Skill Intelligence

Generated skills include workflow intelligence:

### Git Workflow Intelligence

- ✅ Auto-verify working branch before work
- ✅ Auto-create feature branches: `feature/{N}-{description}`
- ✅ Validate commit format: `type(#N): description`
- ✅ Auto-update issue status on branch checkout

### Subtask Management Intelligence

- ✅ Auto-detect ticket complexity
- ✅ Suggest decomposition into subtasks
- ✅ Auto-create with format `[Parent #N] Component`
- ✅ Update parent with GitHub checkboxes

### Test Plan Generation Intelligence

- ✅ Auto-generate when moving to "To test"
- ✅ Analyze content for relevant tests
- ✅ Structured format (Setup, Tests, Errors, Verification)
- ✅ Auto-post as issue comment

## Creating Custom Skills

Skills use a specific structure:

```
.claude/skills/my-skill/
├── SKILL.md              # Skill documentation + instructions
├── skill-cli.sh          # Optional CLI script
└── lib/                  # Optional helper scripts
```

### SKILL.md Format

```markdown
# Skill Name

Brief description of what the skill does.

## Auto-trigger Keywords

keyword1, keyword2, keyword3

## Usage

How to use this skill...

## Examples

Example usage...
```

See the SKILL.md format above for creating custom skills.

## Monorepo Skills

In monorepo structure, skills are shared across all apps:

```
my-saas/                  # Monorepo root
├── apps/
│   ├── api/
│   └── web/
└── .claude/
    └── skills/           # Shared by all apps
        ├── sf-git-commit/
        └── sf-utils-fix-errors/
```

Benefits:

- ✅ Single source of truth
- ✅ Consistent workflow across apps
- ✅ Centralized updates

## Next Steps

- Check `.claude/skills/` directory for all available skills
- Use `/help` command in Claude Code to see skill documentation
- Refer to skill SKILL.md files for detailed usage instructions
