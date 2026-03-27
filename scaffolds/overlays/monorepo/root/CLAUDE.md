# {{PROJECT_NAME}}

Production-ready SaaS monorepo generated with **SaaSFoundry** - An AI-First development platform.

## 🏗️ Monorepo Structure

This is a **Turborepo monorepo** with centralized tooling and shared skills.

```
{{PROJECT_NAME}}/
├── .claude/              # ⭐ Centralized Claude skills (shared by all apps)
│   ├── skills/           # Core skills for git, utils, workflows
│   └── skills-optional/  # Advanced skills (Context7, Atlassian, etc.)
├── apps/
│   ├── api/              # NestJS backend
│   │   └── CLAUDE.md     # API-specific context
│   └── web/              # React frontend
│       └── CLAUDE.md     # Web-specific context
├── packages/             # Shared packages (optional)
├── turbo.json            # Turborepo configuration
└── package.json          # Root workspace configuration
```

## 🎯 Skills Priority

**IMPORTANT**: This monorepo uses centralized SaaSFoundry skills (prefix `sf-*`). When multiple skills with similar functionality exist, **always prefer SaaSFoundry skills** over global or other skills:

- ✅ Use `sf-git-commit` instead of `git-commit`
- ✅ Use `sf-utils-fix-errors` instead of `utils-fix-errors`
- ✅ Use `sf-workflow-apex` instead of `workflow-apex`
- ✅ Use `sf-tool-atlassian` instead of `tool-atlassian`

SaaSFoundry skills are located in `.claude/` at the repository root and are optimized for this monorepo structure.

## 📦 Tech Stack

### Backend (apps/api/)
- **Framework**: NestJS 11
- **Database**: PostgreSQL 16 + Prisma 7
- **Auth**: JWT + Passport
- **Validation**: Zod 4
- **Testing**: Jest + Supertest
- **API Docs**: OpenAPI/Swagger

### Frontend (apps/web/)
- **Framework**: React 19 + React Router v7
- **Build**: Vite 7
- **Styling**: TailwindCSS 4 + ShadCN UI
- **State**: React Query + React Hook Form
- **i18n**: i18next (French + English)
- **Testing**: Playwright

### Monorepo Tools
- **Build System**: Turborepo (parallel builds, caching)
- **Package Manager**: npm workspaces
- **Git Hooks**: Husky + Commitlint (conventional commits)
- **Linting**: ESLint (shared config)
- **Formatting**: Prettier (shared config)

## 🛠️ Available Skills

All skills are located in `.claude/` at the root and are available across the entire monorepo.

### Core Skills (Always Available)

#### Git Workflows
- **`sf-git-commit`** - Create commits with conventional messages
- **`sf-git-create-pr`** - Generate PR with auto-generated description
- **`sf-git-fix-pr-comments`** - Implement PR review feedback
- **`sf-git-merge`** - Intelligent branch merging

#### Code Quality
- **`sf-utils-fix-errors`** - Fix ESLint and TypeScript errors in parallel
- **`sf-utils-fix-grammar`** - Fix grammar and spelling

#### Development Workflows
- **`sf-utils-oneshot`** - Ultra-fast feature implementation
- **`sf-workflow-apex-free`** - APEX methodology (Analyze-Plan-Execute-Validate)
- **`sf-workflow-apex`** - APEX with adversarial review (for critical features)

### Advanced Skills (Optional - Require Configuration)

- **`sf-tool-context7`** - Up-to-date library documentation (React, Vite, Prisma, etc.)
- **`sf-tool-atlassian`** - Jira/Confluence integration
- **`sf-tool-notion`** - Notion workspace integration
- **`sf-tool-figma`** - Figma design system integration

> **Note**: Advanced skills require API tokens. Configure them during `sf new` or when Claude prompts you.

## 🚀 Common Commands

### Monorepo-wide
```bash
npm run dev               # Start all apps in parallel
npm run build             # Build all apps
npm run test              # Run all tests
npm run lint              # Lint all apps
npm run format            # Format all apps
```

### App-specific
```bash
npm run dev:api           # Start API only
npm run dev:web           # Start Web only
npm run test:api          # Test API only
npm run test:web          # Test Web only
```

## 📖 Git Workflow

- Main branch: `master`
- **ALWAYS** use conventional commits: `<type>(#<ticket>): <description>`
- Types: feat, fix, docs, style, refactor, perf, test, chore
- Scope (ticket number) is required
- Max header: 100 characters
- Husky enforces commit format + pre-push checks

### Commit Examples
```bash
feat(#42): add user profile endpoint
fix(#43): resolve JWT token expiration
docs(#44): update API documentation
```

## 🤖 AI-Assisted Development

### Using Skills
```bash
# Let Claude handle commits
"Commit these changes"  # → sf-git-commit

# Fix errors across the monorepo
"Fix all TypeScript errors"  # → sf-utils-fix-errors

# Implement complex features
"Use APEX workflow to add real-time notifications"  # → sf-workflow-apex
```

### Best Practices
- ✅ Skills respect monorepo structure (apps/api, apps/web)
- ✅ Git hooks validate all AI-generated commits
- ✅ Tests run automatically before push
- ✅ Use CLAUDE.md files in apps/ for app-specific context

## 📚 Documentation

- **API Docs**: `http://localhost:3500/api/docs` (when API is running)
- **App-specific context**: Check `apps/api/CLAUDE.md` and `apps/web/CLAUDE.md`
- **Skills**: Check `.claude/README.md` for detailed skill documentation

## 🔧 Troubleshooting

**Turborepo cache issues?**
```bash
npx turbo clean
npm install
```

**Git hooks not working?**
```bash
npx husky install
```

**Skills not loading?**
- Ensure you're at the monorepo root when starting Claude
- Check `.claude/` directory exists and contains skills

---

**Generated with SaaSFoundry v{{VERSION}}** - Check `.saasfoundry.json` for configuration and installed modules.

