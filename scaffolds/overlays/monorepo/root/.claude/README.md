# Claude Code Integration

This directory holds the Claude Code configuration and skills of this project.

## 📁 Structure

```
.claude/
├── settings.json        # Hooks (session preflight with `sf status`)
├── skills/
│   ├── sf-git-commit/           # Commit in the project's commit format
│   ├── sf-git-create-pr/        # Open a pull request against the configured target branch
│   ├── sf-git-fix-pr-comments/  # Implement pull request review feedback
│   ├── sf-git-merge/            # Rebase the ticket branch on the PR target branch
│   ├── sf-utils-fix-errors/     # Fix ESLint and TypeScript errors
│   ├── sf-utils-fix-grammar/    # Fix grammar and spelling
│   ├── sf-integration-rules/    # How to add modules, pages, endpoints, hooks and forms
│   ├── sf-workflow/             # Ticket workflow (when a workflow is configured)
│   ├── sf-srs/                  # SRS drafting and spawning (when the SRS module is enabled)
│   └── sf-tool-<name>/          # Tool integrations you selected (github-projects, notion, figma, …)
└── README.md            # This file
```

Only the skills matching your setup are installed: `sf status` lists what this project actually has.

## 🛠️ Skills

### Always installed

- **sf-git-commit** - Commit with the message format declared in `.saasfoundry.json`
- **sf-git-create-pr** - Open a pull request against `workflow.prTargetBranch`
- **sf-git-fix-pr-comments** - Implement pull request review feedback
- **sf-git-merge** - Rebase the ticket branch on the PR target branch and resolve deterministic conflicts; never merges a pull request
- **sf-utils-fix-errors** - Fix ESLint and TypeScript errors
- **sf-utils-fix-grammar** - Fix grammar and spelling while preserving formatting
- **sf-integration-rules** - The project's integration grammar (backend modules, pages, API hooks, forms, RBAC)

### Installed with a module

- **sf-workflow** - Ticket statuses, guards and pull requests, driven by `workflow-cli.sh`
- **sf-srs** - Software requirements: draft, write, evaluate and spawn tickets

### Tool integrations (selected at setup)

Installed as `sf-tool-<name>` and configured with your own credentials:

- **sf-tool-github-projects**, **sf-tool-jira**, **sf-tool-linear**, **sf-tool-notion** - Ticket board and documentation tools
- **sf-tool-context7** - Up-to-date library documentation
- **sf-tool-atlassian** - Jira and Confluence
- **sf-tool-figma** - Figma designs and components

## 📖 How to Use

Claude Code loads the skills of this directory when you open the project. Ask for the task ("fix all TypeScript errors", "open the pull request") or name the skill; most skills also trigger on
their keywords.

---

**Note**: The skills follow the project's own tooling and rules (`.saasfoundry.json`, tests, git hooks); they never bypass them.
