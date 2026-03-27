# Claude Code Integration

This directory contains Claude Code configuration and skills for AI-assisted development.

## 📁 Structure

```
.claude/
├── skills/              # Core skills (always installed)
│   ├── git-commit/      # Quick commit with conventional messages
│   ├── git-create-pr/   # Create PR with auto-generated description
│   ├── git-fix-pr-comments/  # Implement PR review feedback
│   ├── git-merge/       # Intelligent branch merging
│   ├── utils-fix-errors/     # Fix ESLint and TypeScript errors
│   ├── utils-fix-grammar/    # Fix grammar and spelling
│   ├── utils-oneshot/   # Ultra-fast feature implementation
│   ├── workflow-apex/   # APEX methodology (full with review)
│   └── workflow-apex-free/   # APEX methodology (free)
│
├── skills-optional/     # Advanced skills (require external services)
│   ├── tool-context7/   # Up-to-date library documentation
│   ├── tool-atlassian/  # Jira/Confluence integration
│   ├── tool-notion/     # Notion workspace integration
│   └── tool-figma/      # Figma design integration
│
└── README.md            # This file
```

## 🛠️ Available Skills

### Core Skills (Always Available)

#### Git Workflows
- **git-commit** - Create commits with conventional commit messages
- **git-create-pr** - Create PR with auto-generated title and description
- **git-fix-pr-comments** - Automatically implement PR review feedback
- **git-merge** - Intelligent branch merging with conflict resolution

#### Code Quality
- **utils-fix-errors** - Fix all ESLint and TypeScript errors in parallel
- **utils-fix-grammar** - Fix grammar and spelling errors while preserving formatting

#### Development Workflows
- **utils-oneshot** - Ultra-fast feature implementation (Explore → Code → Test)
- **workflow-apex-free** - APEX methodology (Analyze-Plan-Execute-Validate)
- **workflow-apex** - APEX methodology with adversarial review (for critical features)

### Advanced Skills (Optional - Require Configuration)

These skills integrate with external services and require API tokens/credentials:

- **tool-context7** - Fetch up-to-date library documentation (React, Vite, Prisma, etc.)
- **tool-atlassian** - Jira/Confluence integration (create tickets, update status, etc.)
- **tool-notion** - Notion workspace integration (create pages, databases, etc.)
- **tool-figma** - Figma design system integration (get designs, components, etc.)

> **Note**: Advanced skills are located in `skills-optional/`. To enable them, configure the required credentials during project setup or when Claude prompts you.

## 📖 How to Use

Skills are automatically loaded by Claude Code when you open this project. You can invoke them by:

1. **Asking directly**: "fix all TypeScript errors"
2. **Using skill name**: "use apex workflow to implement user authentication"
3. **Auto-trigger**: Many skills auto-trigger based on keywords

## 🚀 Getting Started

1. Open this project in your IDE with Claude Code installed
2. Claude will automatically load the CLAUDE.md file and available skills
3. Start coding with AI assistance - skills are ready to use

## ✨ Best Practices

- Let skills handle repetitive tasks (commits, error fixes, etc.)
- Use APEX workflow for complex features
- Review AI-generated code, especially for security-critical parts
- Skills respect project conventions (ESLint, Prettier, TypeScript)

---

**Note**: These skills are part of SaaSFoundry's AI-First development approach. They work seamlessly with the project's existing tooling (tests, CI/CD, git hooks).
