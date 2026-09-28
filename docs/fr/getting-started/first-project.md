# Premier projet

Un parcours complet pour créer votre premier projet SaaS avec SaaSFoundryAI.

## Ce que vous allez construire

Dans ce guide, vous allez :

1. créer un projet SaaSFoundryAI ;
2. comprendre la structure générée ;
3. lancer l'environnement de développement ;
4. créer un endpoint API personnalisé ;
5. ajouter une page frontend ;
6. effectuer votre premier commit avec l'agent de code configuré.

**Durée** : environ 30 minutes

## Prérequis

- Node.js 24.19.0, version épinglée par les fichiers `.nvmrc` générés
- Docker Desktop pour la base de données et S3
- un outil d'agent de code enregistré, facultatif mais recommandé
- des connaissances de base en TypeScript, React et NestJS

## Étape 1 : créer le projet

Ouvrez un terminal et exécutez :

```bash
sf new
```

Pour ce tutoriel, répondez aux questions comme suit :

```
? What would you like SaaSFoundryAI to install?
→ Full — technical stack and AI harness

? Which coding agents should share this harness?
→ Select the tools you use (for example Claude Code and Codex)

? What is the name of your project?
→ my-first-saas

? What is the description of your project?
→ My first SaaSFoundryAI project (press Enter)

? Which main branch name do you prefer?
→ main

? How would you like to structure your project?
→ Monorepo (Turborepo)

? Do you have already a remote repository?
→ Not yet, just setup on local

? Do you want to set up a development database with Docker?
→ Yes, with Docker

Database credentials (use defaults):
  User: db_dev_user
  Password: db_dev_password
  Database: db_dev

? For your transactional emails...
→ None, just set up the logic

? Do you want to set up object storage (S3)?
→ Yes, add MinIO with Docker

? Do you want to include Umami analytics?
→ No
```

**Attendez la fin de la génération**, environ une à deux minutes :

- les fichiers sont créés ;
- les dépendances sont installées ;
- le dépôt Git est initialisé.

✅ **Terminé !** Votre projet est prêt.

## Étape 2 : explorer la structure générée

Entrez dans le projet :

```bash
cd my-first-saas
```

La structure du projet est la suivante :

```
my-first-saas/
├── apps/
│   ├── api/              # Backend (NestJS)
│   └── web/              # Frontend (React)
├── CLAUDE.md              # Canonical Claude entrypoint
├── AGENTS.md              # Shared agent entrypoint
├── GEMINI.md              # Gemini entrypoint
├── .claude/skills/        # Existing harness skill source
├── .agents/skills/        # Shared-profile skill surface when declared
├── docker-compose.dev-services.yml
├── turbo.json
└── package.json
```

### Structure de l'API (`apps/api/`)

```
api/
├── src/
│   ├── modules/
│   │   ├── auth/         # JWT authentication
│   │   ├── users/        # User management
│   │   ├── organizations/ # Multi-tenancy
│   │   ├── invitation/   # Team invitations
│   │   ├── email/        # Email service
│   │   └── storage/      # S3 file uploads
│   ├── configs/          # Environment variables
│   ├── common/           # Shared utilities
│   └── main.ts           # Application entry
├── prisma/
│   └── schema/           # Database models
└── tests/                # E2E tests
```

### Structure du frontend (`apps/web/`)

```
web/
├── src/
│   ├── pages/
│   │   ├── private/      # Protected pages (dashboard)
│   │   └── public/       # Public pages (login, register)
│   ├── components/
│   │   ├── layout/       # Layout components
│   │   ├── nav/          # Navigation
│   │   └── ui/           # ShadCN UI components
│   ├── hooks/
│   │   └── api/          # React Query API hooks
│   ├── router/           # React Router v7 config
│   └── locales/          # i18n translations (EN/FR)
└── tests/                # Playwright E2E tests
```

## Étape 3 : démarrer l'environnement de développement

### Démarrer les services Docker

Depuis la racine du monorepo :

```bash
npm run services:up
```

La commande délègue à `apps/api/docker-compose.dev-services.yml` et démarre :

- PostgreSQL sur le port 5435 ;
- MinIO S3 sur le port 9000, avec la console sur 9001.

Vérifiez que les services fonctionnent :

```bash
docker ps
```

Vous devez voir `saasfoundry-db-dev` et `saasfoundry-s3-dev`, ainsi que `saasfoundry-s3-init` au premier démarrage.

### Initialiser la base de données

```bash
npm run db:setup:dev
```

Cette commande exécute les migrations Prisma qui créent les tables.

### Démarrer les serveurs de développement

Depuis la racine du monorepo :

```bash
npm run dev
```

Turborepo démarre **simultanément** l'API et le frontend :

```
API:  http://localhost:3500
Web:  http://localhost:5173
```

Attendez la ligne `[api]` indiquant que l'application fonctionne et la ligne `[web]` confirmant que Vite est prêt.

## Étape 4 : tester l'application générée

### Créer un compte

1. Ouvrez http://localhost:5173 ; vous êtes redirigé vers `/signin`.
2. Cliquez sur **« Sign Up »**.
3. Remplissez le formulaire, qui ne demande que les champs imposés par le DTO SignUp :
   - e-mail : `test@example.com` ;
   - mot de passe : `Test123!`, au moins huit caractères avec une minuscule, une majuscule et un chiffre.
4. Cliquez sur **« Create Account »**.

Lorsque le module e-mail est configuré, un message de confirmation est envoyé. En développement sans fournisseur SMTP réel, consultez les logs de l'API : le scaffold y inscrit le jeton de confirmation
afin de valider le compte manuellement.

Après validation, connectez-vous pour arriver sur `/dashboard`.

### Explorer l'application

Le scaffold fournit deux routes authentifiées :

- **`/dashboard`** — une page d'accueil provisoire, prête à être étendue ;
- **`/account`** — l'espace de gestion du compte : profil, paramètres de l'organisation, membres et invitations.

Toutes les données liées aux personnes, organisations et entités se trouvent sous `/account`. Il n'existe pas de route principale distincte « Profile » ou « Organization » : le scaffold conserve
volontairement un seul espace d'administration, que vous pourrez découper lorsque le produit grandira.

### Documentation de l'API

Ouvrez http://localhost:3500/api/docs pour afficher l'interface Swagger générée automatiquement.

Essayez les **endpoints d'authentification** exposés par `apps/api/src/modules/auth/controllers/auth.controller.ts` :

- `POST /api/auth/signup` — créer un compte
- `POST /api/auth/signin` — s'authentifier et définir les cookies HTTP-only
- `POST /api/auth/signout` — invalider la session
- `GET  /api/auth/me` — récupérer le profil de la personne authentifiée
- `POST /api/auth/request-password-reset` — demander un e-mail de réinitialisation
- `POST /api/auth/reset-password` — réinitialiser avec un jeton

Comme les cookies d'authentification sont HTTP-only, une connexion depuis Swagger ne maintient pas la session entre les requêtes. Connectez-vous dans l'application web, puis rouvrez Swagger dans la
même session de navigateur pour appeler interactivement les endpoints authentifiés.

## Étape 5 : créer votre premier endpoint API

Ajoutons une fonctionnalité **tasks** limitée à la personne courante : chaque utilisateur ne voit que ses propres tâches. Pour une fonctionnalité isolée par tenant, utilisez plutôt `accountId`.
Consultez le [système de modules](/fr/guide/module-system) pour comprendre les relations entre comptes, entités et organisations.

Depuis la racine du monorepo :

```bash
cd apps/api
mkdir -p src/modules/tasks/{controllers,services,dto/requests}
```

### Définir le modèle Prisma

Créez `apps/api/prisma/schema/tasks.prisma` :

```prisma
model Task {
  id          String   @id @default(cuid())
  title       String   @db.VarChar(140)
  completed   Boolean  @default(false)
  userId      String                       @map("user_id")
  createdAt   DateTime @default(now())     @map("created_at")
  updatedAt   DateTime @updatedAt          @map("updated_at")

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("tasks")
}
```

Ajoutez la relation inverse sur `User` dans `apps/api/prisma/schema/users.prisma` :

```prisma
model User {
  // ... existing fields
  tasks Task[]
}
```

Appliquez la migration :

```bash
npm run db:setup:dev
```

Le client Prisma est régénéré dans `apps/api/src/generated/prisma/`. Le scaffold lit les types Prisma à cet endroit, pas dans `@prisma/client`.

### Implémenter le service

Créez `apps/api/src/modules/tasks/services/tasks.service.ts` :

```typescript
import { Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '@configs/prisma/services/prisma.service'

import type { CreateTaskDto } from '@modules/tasks/dto/requests/create-task.dto'

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  create(userId: string, dto: CreateTaskDto) {
    return this.prisma.task.create({ data: { ...dto, userId } })
  }

  findAllForUser(userId: string) {
    return this.prisma.task.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    })
  }

  async toggle(userId: string, id: string) {
    const task = await this.prisma.task.findFirst({ where: { id, userId } })
    if (!task) throw new NotFoundException('Task not found')
    return this.prisma.task.update({ where: { id }, data: { completed: !task.completed } })
  }

  async remove(userId: string, id: string) {
    await this.prisma.task.deleteMany({ where: { id, userId } })
  }
}
```

### Créer le DTO

Créez `apps/api/src/modules/tasks/dto/requests/create-task.dto.ts` :

```typescript
import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

export class CreateTaskDto {
  @ApiProperty({ example: 'Finish the getting started guide' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(140)
  title: string
}
```

### Implémenter le contrôleur

Créez `apps/api/src/modules/tasks/controllers/tasks.controller.ts`. Le `JwtAuthGuard` du scaffold attache la personne authentifiée à `request.user` :

```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard'
import { CreateTaskDto } from '@modules/tasks/dto/requests/create-task.dto'
import { TasksService } from '@modules/tasks/services/tasks.service'

import type { AuthenticatedRequest } from '@common/types/authenticated-request.type'

@ApiTags('Tasks')
@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @ApiOperation({ summary: 'Create a task for the current user' })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateTaskDto) {
    return this.tasksService.create(req.user.id, dto)
  }

  @Get()
  @ApiOperation({ summary: 'List the current user tasks' })
  findAll(@Req() req: AuthenticatedRequest) {
    return this.tasksService.findAllForUser(req.user.id)
  }

  @Patch(':id/toggle')
  toggle(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.tasksService.toggle(req.user.id, id)
  }

  @Delete(':id')
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.tasksService.remove(req.user.id, id)
  }
}
```

### Connecter le module

Créez `apps/api/src/modules/tasks/tasks.module.ts` :

```typescript
import { Module } from '@nestjs/common'

import { TasksController } from '@modules/tasks/controllers/tasks.controller'
import { TasksService } from '@modules/tasks/services/tasks.service'

@Module({
  controllers: [TasksController],
  providers: [TasksService]
})
export class TasksModule {}
```

Enregistrez-le dans `apps/api/src/app.module.ts` :

```typescript
import { TasksModule } from '@modules/tasks/tasks.module'

@Module({
  imports: [
    // ... existing modules
    TasksModule
  ]
})
export class AppModule {}
```

### Tester l'endpoint

Redémarrez l'API. `npm run dev` détecte le changement de schéma ; un redémarrage complet peut être utile après la régénération de Prisma.

Ouvrez http://localhost:3500/api/docs. Les cookies d'authentification étant HTTP-only, connectez-vous d'abord dans l'application web sur http://localhost:5173, puis conservez la même session de
navigateur pour l'appel Swagger `POST /api/tasks` :

```json
{ "title": "My first task" }
```

Appelez ensuite `GET /api/tasks` pour afficher la liste.

✅ **Votre endpoint API fonctionne !**

## Étape 6 : créer votre première page frontend

Créons une page Tasks qui communique avec l'endpoint précédent.

### Créer les hooks API

Créez `apps/web/src/hooks/api/tasks/index.ts` :

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import apiClient from '@/lib/api/client'

export type Task = {
  id: string
  title: string
  completed: boolean
  createdAt: string
}

export const useTasks = () =>
  useQuery({
    queryKey: ['tasks'],
    queryFn: () => apiClient.get<Task[]>('/tasks')
  })

export const useCreateTask = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: { title: string }) => apiClient.post<Task>('/tasks', payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] })
  })
}

export const useToggleTask = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.patch<Task>(`/tasks/${id}/toggle`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] })
  })
}

export const useDeleteTask = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/tasks/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] })
  })
}
```

> Le `apiClient` du scaffold utilise l'API Fetch native et renvoie directement le corps JSON, sans enveloppe `.data`. Les cookies d'authentification sont envoyés automatiquement grâce à
> `credentials: 'include'`.

### Créer la page

Créez `apps/web/src/pages/private/tasks.tsx`. Le scaffold utilise des noms de fichiers en kebab-case et des exports en PascalCase :

```tsx
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/shadcn/button'
import { Checkbox } from '@/components/ui/shadcn/checkbox'
import { Input } from '@/components/ui/shadcn/input'

import { useCreateTask, useDeleteTask, useTasks, useToggleTask } from '@/hooks/api/tasks'

export const Tasks = () => {
  const [title, setTitle] = useState('')
  const { data: tasks = [], isLoading } = useTasks()
  const createTask = useCreateTask()
  const toggleTask = useToggleTask()
  const deleteTask = useDeleteTask()

  const handleCreate = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    createTask.mutate({ title })
    setTitle('')
  }

  if (isLoading) return <p className="p-8 text-sm text-muted-foreground">Loading...</p>

  return (
    <div className="container mx-auto p-8">
      <h1 className="mb-6 text-3xl font-bold">Tasks</h1>

      <form onSubmit={handleCreate} className="mb-8 flex gap-2">
        <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add a new task..." className="flex-1" />
        <Button type="submit" disabled={createTask.isPending}>
          Add Task
        </Button>
      </form>

      <div className="space-y-2">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-center gap-3 rounded-lg border p-4">
            <Checkbox checked={task.completed} onCheckedChange={() => toggleTask.mutate(task.id)} />
            <span className={task.completed ? 'text-muted-foreground line-through' : ''}>{task.title}</span>
            <Button variant="ghost" size="sm" onClick={() => deleteTask.mutate(task.id)} className="ml-auto">
              Delete
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

### Enregistrer la route

Le scaffold déclare les routes dans un tableau `RouteObject[]` avec chargement différé, et non sous forme d'éléments JSX `<Route>`.

Ajoutez l'import différé dans `apps/web/src/router/lazy-pages.tsx` :

```typescript
// --- tasks ---
export const Tasks = lazy(() => import('@/pages/private/tasks').then((module) => ({ default: module.Tasks })))
```

Ajoutez la route dans `apps/web/src/router/private-routes.tsx`, parmi les enfants de `LayoutLogged` :

```typescript
import { AccountManagement, Dashboard, LayoutLogged, Tasks } from '@/router/lazy-pages'

// ...

{
  path: 'tasks',
  element: LazyRouteElement(Tasks)
}
```

### Ajouter une entrée dans la barre latérale

La barre latérale principale se trouve dans `apps/web/src/components/layout/layout-sidebar.tsx`. Son tableau `data.navigation` pilote les groupes de navigation. Ajoutez un élément à l'un des groupes,
par exemple :

```tsx
import { CheckSquare } from 'lucide-react'

// inside data.navigation[0].items
{
  title: 'Tasks',
  url: '/tasks',
  icon: CheckSquare,
  isActive: true
}
```

> Les entrées existantes utilisent des clés i18n comme `main-navigation.tk_feature-1_`, car le scaffold les affiche avec `useTranslation('nav')`. Pour ce tutoriel, une chaîne simple suffit. En
> production, ajoutez les clés dans `apps/web/src/locales/{en,fr}/nav.yml`.

### Tester la page

1. Ouvrez http://localhost:5173/tasks après vous être connecté si nécessaire.
2. Ajoutez une tâche avec le formulaire.
3. Cochez ou décochez la tâche pour changer son état.
4. Supprimez-la.

✅ **Votre page frontend fonctionne de bout en bout avec la nouvelle API.**

## Étape 7 : effectuer votre premier commit

Le monorepo impose des [commits conventionnels avec un numéro de ticket obligatoire](https://commitlint.js.org/) au moyen de Husky et commitlint :

```
<type>(#<ticket>): <description>
```

### Avec un agent de code configuré

Ouvrez le projet avec l'un des profils indiqués par `sf agents list`, puis demandez :

```
Commit these changes using the project's commit skill
```

La procédure lit le format imposé dans `.saasfoundry.json`, regroupe les changements liés et produit un commit conventionnel. Utilisez l'emplacement de skill exposé par le profil choisi et n'inventez
pas de trailer propre à un fournisseur si le projet ne l'exige pas.

### Manuellement

```bash
git add apps/api/src/modules/tasks \
        apps/api/prisma/schema/tasks.prisma \
        apps/api/prisma/schema/users.prisma \
        apps/web/src/hooks/api/tasks \
        apps/web/src/pages/private/tasks.tsx \
        apps/web/src/router/lazy-pages.tsx \
        apps/web/src/router/private-routes.tsx \
        apps/web/src/components/layout/layout-sidebar.tsx

git commit -m "feat(#1): add tasks module with API, hooks and UI"
```

Remplacez `#1` par le numéro du ticket. Le hook `commit-msg` de Husky refuse les commits qui ne respectent pas ce format.

## Et ensuite ?

Bravo ! 🎉 Vous avez :

- ✅ créé un projet SaaSFoundryAI ;
- ✅ ajouté un endpoint API personnalisé ;
- ✅ construit une page frontend ;
- ✅ effectué votre premier commit.

### Continuer à apprendre

1. **Ajouter des autorisations aux tâches** : implémenter les permissions.
2. **Ajouter des tests** : écrire des tests E2E pour les tâches.
3. **Déployer** : apprendre à livrer en production.
4. **Ajouter des modules** : essayer `sf update` pour installer l'e-mail ou le stockage.

### Ressources

- [Structure du projet](/fr/guide/project-structure) — approfondir le code
- [Système de modules](/fr/guide/module-system) — comprendre les modules
- [Système de skills](/fr/guide/skills-system) — utiliser les skills du projet
- [`sf agents`](/fr/cli/sf-agents) — ajouter ou vérifier un profil d'agent
- [Commandes du CLI](/fr/cli/sf-new) — toutes les commandes

## Dépannage

### L'API ne démarre pas

- **Vérifiez les services** : `docker ps` doit afficher `saasfoundry-db-dev`, ainsi que `saasfoundry-s3-dev` si MinIO a été choisi.
- **Consultez les logs de la base** : `docker logs saasfoundry-db-dev`.
- **Redémarrez les services** : `npm run services:reset`, puis `npm run db:setup:dev`.

### Le frontend ne démarre pas

- **Vérifiez l'API** : `curl http://localhost:3500/api/health` doit renvoyer 200.
- **Videz le cache Vite** : `rm -rf apps/web/node_modules/.vite`.

### La migration de base échoue

**Réinitialisez la base** : le tmpfs est effacé à l'arrêt, donc un cycle down/up recrée une base vide.

```bash
npm run services:reset
npm run db:setup:dev
```

### Un port est déjà utilisé

Le scaffold lit les ports depuis les fichiers d'environnement. Modifiez-les plutôt que le code source :

- API : `apps/api/.env` → `PORT`, valeur par défaut `3500`
- Web : `apps/web/.env` → `FRONTEND_PORT`, valeur par défaut `5173`

Si vous changez le port de l'API, mettez aussi à jour `apps/web/.env` → `VITE_BASE_API_URL` afin que le frontend continue à joindre le backend.
