# Claude Code Integration

This directory contains Claude Code configuration and skills for AI-assisted development.

## 📁 Structure

```
.claude/
├── skills/              # Pre-configured skills for common workflows
│   ├── git-commit/      # Quick commit with conventional messages
│   ├── git-fix-pr-comments/  # Implement PR review feedback
│   ├── utils-fix-errors/     # Fix ESLint and TypeScript errors
│   └── utils-fix-grammar/    # Fix grammar and spelling
└── README.md            # This file
```

## 🛠️ Available Skills

### Git Workflows
- **git-commit** - Create commits with conventional commit messages
- **git-fix-pr-comments** - Automatically implement PR review feedback

### Code Quality
- **utils-fix-errors** - Fix all ESLint and TypeScript errors in parallel
- **utils-fix-grammar** - Fix grammar and spelling errors while preserving formatting

## 📖 How to Use

Skills are automatically loaded by Claude Code when you open this project. You can invoke them by:

1. **Asking directly**: "fix all TypeScript errors"
2. **Using skill name**: "use git-commit to commit these changes"
3. **Auto-trigger**: Many skills auto-trigger based on keywords

## 🚀 Getting Started

1. Open this project in your IDE with Claude Code installed
2. Claude will automatically load the CLAUDE.md file and available skills
3. Start coding with AI assistance - skills are ready to use

## ✨ Best Practices

- Let skills handle repetitive tasks (commits, error fixes, etc.)
- Review AI-generated code, especially for UI components
- Skills respect project conventions (ESLint, Prettier, TypeScript)
- Test React components after AI generation

---

**Note**: These skills are part of SaaSFoundry's AI-First development approach. They work seamlessly with the project's existing tooling (tests, CI/CD, git hooks).
