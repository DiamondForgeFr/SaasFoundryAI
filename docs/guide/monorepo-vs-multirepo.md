# Monorepo vs Multirepo

SaaSFoundryAI supports both monorepo and multirepo project structures.

## Monorepo (Recommended)

A monorepo keeps all packages in a single repository with shared tooling.

### Structure

```
my-saas/
├── apps/
│   ├── api/          # NestJS backend
│   └── web/          # React frontend
├── packages/
│   └── shared/       # Shared types, utils
├── .claude/
│   └── skills/       # Shared Claude skills
├── turbo.json
└── package.json
```

### Advantages

- ✅ **Shared skills** - Claude skills available to all apps
- ✅ **Atomic commits** - Change API + frontend in one commit
- ✅ **Centralized tooling** - One ESLint, one Prettier config
- ✅ **Type safety** - Shared TypeScript types between apps
- ✅ **Faster CI** - Turborepo caches and parallelizes builds

### When to use

- Full-stack teams working on related apps
- Need tight coupling between frontend and backend
- Want unified versioning and releases

## Multirepo

Each app lives in its own repository.

### Structure

```
my-saas-api/          # Separate repo
├── src/
├── .claude/skills/
└── package.json

my-saas-web/          # Separate repo
├── src/
├── .claude/skills/
└── package.json
```

### Advantages

- ✅ **Independent deployment** - Apps deploy separately
- ✅ **Team autonomy** - Frontend and backend teams work independently
- ✅ **Fine-grained access** - Control repo permissions per app

### When to use

- Separate frontend and backend teams
- Apps have different release cycles
- Microservices architecture

## Choosing a structure during profile promotion

A harness-only managed project has no SaaSFoundry technical topology yet. When `sf update --target-profile full` adds the stack, interactive mode asks for `monorepo` or `multirepo`; non-interactive
mode requires the choice explicitly. Preview it first with `--dry-run --json`.

Once a technical stack exists, profile promotion preserves its topology. `stack → full` adds the managed harness and `full → full` is a no-op; neither converts repository structure.

## Manual migration

Moving between structures remains a manual repository migration outside `sf update`:

```bash
# Monorepo → Multirepo
# Extract apps/ into separate repos

# Multirepo → Monorepo
# Use Turborepo to combine repos
```

## Recommendation

**Start with monorepo** unless you have a specific reason for multirepo. It can be split later as a deliberate manual migration, but the profile-transition command does not perform that conversion.
