# Structure d’un projet

Cette page présente la structure d’un projet SaaSFoundryAI.

## Structure monorepo

Structure monorepo recommandée :

```
my-saas/
├── apps/
│   ├── api/              # Backend NestJS
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   ├── configs/
│   │   │   ├── common/
│   │   │   └── main.ts
│   │   ├── prisma/
│   │   ├── test/
│   │   └── package.json
│   └── web/              # Frontend React
│       ├── src/
│       │   ├── pages/
│       │   ├── components/
│       │   ├── hooks/
│       │   ├── lib/
│       │   └── main.tsx
│       ├── public/
│       └── package.json
├── packages/
│   └── shared/           # Code partagé optionnel
├── .claude/ et .agents/  # Instructions et skills partagés des agents configurés
├── .github/
│   └── workflows/        # Pipelines CI/CD
├── docker-compose.*.yml  # Services de développement
├── turbo.json            # Configuration Turborepo
├── package.json          # package.json racine
└── .saasfoundry.json     # Manifeste du projet
```

## Structure de l’API

### Organisation par module

Chaque fonctionnalité est un module :

```
src/modules/auth/
├── auth.module.ts        # Définition du module
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

### Alias de chemins

```typescript
// Instead of: ../../../configs/env/env.service
import { EnvService } from '@configs/env/env.service'

// Instead of: ../../common/decorators
import { Public } from '@common/decorators/public.decorator'

// Instead of: ../../../modules/user/user.service
import { UserService } from '@modules/user/user.service'
```

Configuration dans `tsconfig.json` :

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

### Base de données

Prisma utilise un schéma réparti en plusieurs fichiers :

```
prisma/
├── schema.prisma         # Fichier principal et datasource
└── schema/
    ├── user.prisma
    ├── organization.prisma
    └── invitation.prisma
```

Chaque fichier se concentre sur une entité du domaine.

## Structure Web

### Pages

```
src/pages/
├── private/              # Routes authentifiées
│   ├── Dashboard.tsx
│   ├── Profile.tsx
│   └── Settings.tsx
└── public/               # Routes publiques
    ├── Login.tsx
    ├── Register.tsx
    └── ForgotPassword.tsx
```

### Composants

```
src/components/
├── ui/                   # Composants ShadCN UI
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
├── api/                  # Hooks React Query
│   ├── useAuth.ts
│   ├── useOrganizations.ts
│   └── useUsers.ts
└── common/
    ├── useLocalStorage.ts
    └── useDebounce.ts
```

### Routage

React Router v7 avec chargement différé :

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

### Services de développement

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

### Builds multi-étapes

Les images Docker de production utilisent plusieurs étapes :

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

### Variables d’environnement

```
.env                      # Configuration de développement
.env.test                 # Configuration de test
.env.production           # Configuration de production, ignorée par Git
```

Validation avec Zod :

```typescript
// src/configs/env/env.schema.ts
export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(3000)
})
```

### Manifeste

`.saasfoundry.json` suit les métadonnées du projet :

```json
{
  "version": "1.0.0-beta",
  "structure": "monorepo",
  "projectName": "my-saas",
  "modules": {
    "email": { "provider": "mailersend", "version": 1 },
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

### Scripts racine

```json
{
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "type-check": "turbo run type-check",
    "test:unit": "turbo run test:unit",
    "test:e2e": "turbo run test:e2e",
    "test:full": "turbo run test:full",
    "services:up": "npm run services:up -w apps/api"
  }
}
```

### Scripts du package API

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

### Scripts du package Web

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

Turborepo assure le cache et l’orchestration des tâches :

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "dependsOn": ["^build"],
      "cache": false,
      "persistent": true
    },
    "test:e2e": {
      "dependsOn": ["^build"],
      "cache": false
    }
  }
}
```

## Pour aller plus loin

- [Monorepo ou multirepo](/fr/guide/monorepo-vs-multirepo) — choisir une structure ;
- [Système de modules](/fr/guide/module-system) — ajouter des fonctionnalités ;
- [Système de skills](/fr/guide/skills-system) — utiliser le harness avec les agents de développement.
