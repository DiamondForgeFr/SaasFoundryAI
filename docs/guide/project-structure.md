# Project Structure

Understanding the structure of a SaaSFoundryAI project.

## Monorepo Structure

The recommended monorepo structure:

```
my-saas/
├── apps/
│   ├── api/              # NestJS backend
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   ├── configs/
│   │   │   ├── common/
│   │   │   └── main.ts
│   │   ├── prisma/
│   │   ├── test/
│   │   └── package.json
│   └── web/              # React frontend
│       ├── src/
│       │   ├── pages/
│       │   ├── components/
│       │   ├── hooks/
│       │   ├── lib/
│       │   └── main.tsx
│       ├── public/
│       └── package.json
├── packages/
│   └── shared/           # Shared code (optional)
├── .claude/
│   └── skills/           # Claude skills (shared)
├── .github/
│   └── workflows/        # CI/CD pipelines
├── docker-compose.*.yml  # Development services
├── turbo.json            # Turborepo config
├── package.json          # Root package.json
└── .saasfoundry.json     # Project manifest
```

## API Structure

### Module Pattern

Each feature is a module:

```
src/modules/auth/
├── auth.module.ts        # Module definition
├── controllers/
│   └── auth.controller.ts
├── services/
│   └── auth.service.ts
├── dto/
│   ├── login.dto.ts
│   └── register.dto.ts
├── guards/
│   └── jwt-auth.guard.ts
└── tests/
    ├── unit/
    │   └── auth.service.spec.ts
    └── e2e/
        └── auth.controller.spec.ts
```

### Path Aliases

```typescript
// Instead of: ../../../configs/env/env.service
import { EnvService } from '@configs/env/env.service'

// Instead of: ../../common/decorators
import { Public } from '@common/decorators/public.decorator'

// Instead of: ../../../modules/user/user.service
import { UserService } from '@modules/user/user.service'
```

Configured in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "@modules/*": ["./src/modules/*"],
      "@common/*": ["./src/common/*"],
      "@configs/*": ["./src/configs/*"]
    }
  }
}
```

### Database

Prisma multi-file schema:

```
prisma/
├── schema.prisma         # Main file with datasource
└── schema/
    ├── user.prisma
    ├── organization.prisma
    └── invitation.prisma
```

Each file focuses on one domain entity.

## Web Structure

### Pages

```
src/pages/
├── private/              # Authenticated routes
│   ├── Dashboard.tsx
│   ├── Profile.tsx
│   └── Settings.tsx
└── public/               # Public routes
    ├── Login.tsx
    ├── Register.tsx
    └── ForgotPassword.tsx
```

### Components

```
src/components/
├── ui/                   # ShadCN UI components
│   ├── button.tsx
│   ├── input.tsx
│   └── dialog.tsx
├── layout/
│   ├── Header.tsx
│   ├── Sidebar.tsx
│   └── Footer.tsx
└── features/
    ├── auth/
    └── dashboard/
```

### Hooks

```
src/hooks/
├── api/                  # React Query hooks
│   ├── useAuth.ts
│   ├── useOrganizations.ts
│   └── useUsers.ts
└── common/
    ├── useLocalStorage.ts
    └── useDebounce.ts
```

### Routing

React Router v7 with lazy loading:

```typescript
// src/routes.tsx
const Dashboard = lazy(() => import('@/pages/private/Dashboard'))
const Settings = lazy(() => import('@/pages/private/Settings'))

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        path: 'dashboard',
        element: (
          <Suspense fallback={<Loading />}>
            <Dashboard />
          </Suspense>
        )
      }
    ]
  }
])
```

## Docker

### Development Services

```yaml
# docker-compose.db.yml
services:
  postgres:
    image: postgres:16
    ports:
      - '5435:5432'
    tmpfs: # In-memory for speed
      - /var/lib/postgresql/data
```

### Multi-Stage Builds

Production Docker images use multi-stage builds:

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/main.js"]
```

## Configuration

### Environment Variables

```
.env                      # Development config
.env.test                 # Test config
.env.production           # Production config (gitignored)
```

Validated with Zod:

```typescript
// src/configs/env/env.schema.ts
export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(3000)
})
```

### Manifest

`.saasfoundry.json` tracks project metadata:

```json
{
  "version": "1.0.0-beta",
  "structure": "monorepo",
  "projectName": "my-saas",
  "modules": {
    "emailService": "mailersend",
    "s3Setup": "docker",
    "includeAnalytics": true
  },
  "workflow": {
    "tool": "github-projects",
    "projectUrl": "https://github.com/..."
  }
}
```

## Scripts

### Root Package Scripts

```json
{
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "test:full": "turbo run test:full",
    "db:dev": "docker-compose -f docker-compose.db.yml up -d"
  }
}
```

### API Package Scripts

```json
{
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "test:unit": "jest",
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "db:setup:dev": "./scripts/setup-db-dev.sh",
    "db:studio": "prisma studio"
  }
}
```

### Web Package Scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test:e2e": "playwright test"
  }
}
```

## Turborepo

Caching and task orchestration:

```json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "cache": false
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

## Next Steps

- [Monorepo vs Multirepo](/guide/monorepo-vs-multirepo) - Choose structure
- [Module System](/guide/module-system) - Add features
- [Skills System](/guide/skills-system) - Claude assistance
