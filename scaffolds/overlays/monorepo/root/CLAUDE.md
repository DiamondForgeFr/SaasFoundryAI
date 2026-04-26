# {{PROJECT_NAME}}

Production-ready SaaS monorepo generated with **SaaSFoundry** - An AI-First development platform.

## 🧭 Preconditions first (read before asking questions)

Before asking the user anything about scope, backend, or module choices, **read the manifest and check the configured tools**:

1. Read `.saasfoundry.json` — the source of truth for workflow, SRS backend, and installed modules. Never re-ask what is already declared there.
2. Run `sf status --claude-friendly --no-network` to get a summary of the manifest, installed modules, and preconditions. A `SessionStart` hook in `.claude/settings.json` also auto-injects this summary at session start.
3. Only ask about things that are **not** resolvable from the manifest. If a precondition is `fail`, route the user to the relevant install/config CLI (`sf workflow`, `sf skill install`, etc.) instead of opening a scope dialogue.

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
├── packages/             # Shared packages (consumed by both apps/api and apps/web)
│   ├── shared-types/     # Pure TypeScript types + z.infer outputs
│   ├── shared-validation/ # Zod schemas (signup, signin, org CRUD, …)
│   └── shared-config/    # Runtime constants (routes, flags, locales, …)
├── turbo.json            # Turborepo configuration
└── package.json          # Root workspace configuration
```

### 📦 Shared packages — the no-drift contract

`packages/shared-*` is the single source of truth for code that must be identical on both sides of the wire. Each package is a private npm workspace published under `@{{PROJECT_NAME}}/shared-*`:

- **`@{{PROJECT_NAME}}/shared-types`** — Pure TypeScript types and `z.infer` outputs reused by `apps/api` (DTO types) and `apps/web` (props, hook responses).
- **`@{{PROJECT_NAME}}/shared-validation`** — Zod schemas consumed by NestJS DTOs (via the chosen Zod-Nest bridge) and React Hook Form (`zodResolver`). Define a schema once; both sides validate identically.
- **`@{{PROJECT_NAME}}/shared-config`** — Runtime constants (public route segments, feature flag defaults, supported locales, validation thresholds) that both apps reference.

Module resolution goes through npm workspaces — each package is symlinked into the root `node_modules/@{{PROJECT_NAME}}/shared-*` and consumed via its compiled `dist/` (set as the package's `main`/`types`). Build order is handled by Turborepo (`build` depends on `^build`), so `npm run build` always rebuilds shared packages first. After editing a shared package's source, run `npm run build` (or rely on CI) before the change is picked up by `apps/api` or `apps/web`. Each package ships its own README with the "what goes in / what does not" rules.

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

