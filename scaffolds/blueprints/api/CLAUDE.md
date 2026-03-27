# {{PROJECT_NAME}} API

Production-ready NestJS API generated with **SaaSFoundry** - An AI-First development platform.

## Tech Stack

- **Backend**: NestJS 11, Prisma 7 (driver adapters + PrismaPg), PostgreSQL 16
- **Auth**: JWT + Passport (access + refresh tokens)
- **Validation**: Zod 4 + class-validator
- **Testing**: Jest (unit) + Supertest (E2E)
- **Logging**: Winston (daily rotation)
- **API Docs**: OpenAPI/Swagger (auto-generated)

## Project Structure

```
src/
├── common/           # Filters, guards, interceptors, pipes
├── configs/          # Configuration modules (DB, env, API docs, test)
└── modules/          # Feature modules
    ├── auth/         # Authentication & authorization
    ├── users/        # User management
    ├── organizations/  # Multi-tenant organizations
    ├── invitation/   # User invitations
    └── email/        # Email service (optional: MailerSend)
```

## Code Conventions

### Module Pattern
```
module-name/
├── module.ts              # NestJS module definition
├── controller.ts          # HTTP endpoints
├── service.ts             # Business logic
├── dto/                   # Data transfer objects
│   ├── create-*.dto.ts
│   ├── update-*.dto.ts
│   └── query-*.dto.ts
└── tests/
    ├── unit/*.spec.ts     # Unit tests
    └── e2e/*.spec.ts      # E2E tests
```

### Path Aliases
- `@modules/*` → `src/modules/*`
- `@common/*` → `src/common/*`
- `@configs/*` → `src/configs/*`
- `@/*` → `src/*`

### Validation
- **DTOs**: Use Zod schemas for runtime validation
- **Decorators**: `@ApiProperty()` for OpenAPI docs
- **Transform**: Use `class-transformer` for type coercion

### Prisma Schema
- Multi-file schemas in `prisma/schema/`
- Soft deletes with `deletedAt` field
- Created/updated timestamps on all entities
- Relations follow NestJS naming (camelCase)

## Git Workflow

- Main branch: `master`
- **ALWAYS** use conventional commits: `<type>(#<ticket>): <description>`
- Types: feat, fix, docs, style, refactor, perf, test, chore
- Scope (ticket number) is required
- Max header: 100 characters
- Husky enforces commit format + pre-push checks

### Commit Examples
```bash
feat(#42): add user profile endpoint
fix(#43): resolve JWT token expiration issue
docs(#44): update API documentation
```

## Development Commands

```bash
# Development
npm run dev                 # Start in watch mode

# Database
npm run db:update:dev       # Update dev database schema
npm run db:studio           # Open Prisma Studio

# Testing
npm run test:unit           # Run unit tests
npm run test:e2e            # Run E2E tests
npm run test:full           # Format + Lint + Type-check + Tests

# Code Quality
npm run format              # Prettier
npm run lint                # ESLint
npm run type-check          # TypeScript

# Docker
docker compose -f docker-compose.dev-services.yml up -d  # Start DB + S3
docker compose -f docker-compose.dev-services.yml down   # Stop services
```

## 🤖 AI-Assisted Development

This project is pre-configured for AI development with Claude Code.

### 🛠️ Available Skills

Located in `.claude/skills/`:

#### Git Workflows
- **`/git-commit`** - Quick commit with conventional messages
  - Auto-generates commit messages following project conventions
  - Includes ticket number and proper type

- **`/git-fix-pr-comments`** - Implement PR review feedback
  - Fetches PR comments from GitHub
  - Implements requested changes automatically
  - Creates new commits with fixes

#### Code Quality
- **`/utils-fix-errors`** - Fix ESLint and TypeScript errors
  - Parallel processing for fast fixes
  - Respects project conventions
  - Safe refactoring

- **`/utils-fix-grammar`** - Fix grammar and spelling
  - Preserves code formatting
  - Works on markdown, comments, docs

#### Development Workflows
- **`/workflow-apex-free`** - APEX methodology (Analyze-Plan-Execute-Validate)
  - Systematic feature implementation
  - Parallel agents for exploration
  - Self-validation with tests
  - Use for complex features

### 🎯 Common AI Workflows

#### Implement a new feature
```
User: "Add a user profile endpoint with avatar upload"
Claude: Uses /workflow-apex-free
1. Analyzes existing user module
2. Plans implementation (DTO, service, controller, tests)
3. Executes changes
4. Validates with tests
```

#### Fix errors after refactoring
```
User: "Fix all TypeScript errors"
Claude: Uses /utils-fix-errors
- Scans all files in parallel
- Fixes type errors
- Maintains code style
```

#### Create a commit
```
User: "Commit these changes"
Claude: Uses /git-commit
- Analyzes changed files
- Generates conventional commit message
- Includes Co-Authored-By: Claude
```

### ✅ Best Practices

**DO**:
- Trust the skills - they respect project conventions
- Let AI handle repetitive tasks (commits, error fixes)
- Use APEX workflow for complex features
- Review security-critical code manually

**DON'T**:
- Skip tests - AI code must pass all checks
- Bypass git hooks (`--no-verify`)
- Ignore TypeScript errors
- Over-rely on AI for business logic

### 🔒 Security Gates

All AI-generated code passes through:
- **Zod validation** - Runtime type checking
- **ESLint** - Code quality standards
- **TypeScript** - Compile-time safety
- **Jest tests** - Unit + E2E validation
- **Git hooks** - Pre-commit checks
- **CI/CD** - Automated deployment validation

## API Documentation

- **Interactive docs**: `http://localhost:3000/api/docs`
- **OpenAPI spec**: Auto-generated in `docs/openapi.json`
- **Update docs**: Decorators automatically update OpenAPI spec

## Environment Variables

See `.env.example` for required variables. Key variables:

```bash
# Database
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."

# JWT Secrets (auto-generated during setup)
JWT_SECRET_AUTH="..."
JWT_SECRET_REFRESH="..."

# Optional: MailerSend Email
MAILERSEND_API_KEY="..."
MAILERSEND_SENDER_EMAIL="..."

# Optional: AWS S3 Storage
S3_ACCESS_KEY="..."
S3_SECRET_KEY="..."
S3_BUCKET="..."
```

## Testing

### Unit Tests
```bash
npm run test:unit
# Tests business logic in isolation
# Located in: src/**/*.spec.ts
```

### E2E Tests
```bash
npm run test:e2e
# Tests full HTTP request/response cycle
# Uses in-memory test database (tmpfs)
# Located in: src/**/tests/e2e/*.spec.ts
```

### Test Database
- Automatically created via `docker-compose.db-test.yml`
- Uses tmpfs for fast I/O
- Isolated from development database
- Cleaned between test runs

## Important Notes

- This is a **generated project** from SaaSFoundry v{{VERSION}}
- Check `.saasfoundry.json` for installed modules and configuration
- Update this CLAUDE.md as your project evolves
- Prisma schema changes require migration: `npm run db:update:dev`

---

**Need help?** Check the [SaaSFoundry documentation](https://github.com/DiamondForgeFr/SaaSFoundry) or use Claude Code skills for assistance.
