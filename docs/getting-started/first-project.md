# First Project

A comprehensive walkthrough of creating your first SaaS project with SaaSFoundryAI.

## What You'll Build

In this guide, you'll:

1. Create a new SaaSFoundryAI project
2. Understand the generated structure
3. Run the development environment
4. Create a custom API endpoint
5. Add a new frontend page
6. Make your first commit with Claude Code

**Time Required**: ~30 minutes

## Prerequisites

- Node.js 22.13+ installed
- Docker Desktop (for database and S3)
- Claude Code installed (optional but recommended)
- Basic knowledge of TypeScript, React, and NestJS

## Step 1: Create Your Project

Open your terminal and run:

```bash
sf new
```

Answer the prompts as follows (for this tutorial):

```
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

**Wait for generation** (this takes ~1-2 minutes):

- Files are being created
- Dependencies are being installed
- Git repository is initialized

✅ **Success!** Your project is ready.

## Step 2: Explore the Generated Structure

Navigate into your project:

```bash
cd my-first-saas
```

Your project structure:

```
my-first-saas/
├── apps/
│   ├── api/              # Backend (NestJS)
│   └── web/              # Frontend (React)
├── .claude/              # Claude Code skills
├── docker-compose.dev-services.yml
├── turbo.json
└── package.json
```

### API Structure (`apps/api/`)

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

### Web Structure (`apps/web/`)

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

## Step 3: Start Development Environment

### Start Docker Services

From the monorepo root:

```bash
npm run services:up
```

This delegates to `apps/api/docker-compose.dev-services.yml` and starts:

- PostgreSQL (port 5435)
- MinIO S3 (port 9000, console 9001)

Verify services are running:

```bash
docker ps
```

You should see `saasfoundry-db-dev` and `saasfoundry-s3-dev` (plus `saasfoundry-s3-init` on first boot).

### Initialize Database

```bash
npm run db:setup:dev
```

This runs Prisma migrations to create database tables.

### Start Dev Servers

From the monorepo root:

```bash
npm run dev
```

Turborepo starts **both** API and Web in parallel:

```
API:  http://localhost:3500
Web:  http://localhost:5173
```

Wait for the `[api]` line reporting the application is running and the `[web]` line reporting Vite is ready.

## Step 4: Test the Generated App

### Register an Account

1. Open http://localhost:5173 — you'll be redirected to `/signin`.
2. Click **"Sign Up"**.
3. Fill the registration form (the scaffold collects only what the SignUp DTO enforces):
   - Email: `test@example.com`
   - Password: `Test123!` (min 8 chars, at least one lower + one upper + one digit)
4. Click **"Create Account"**.

A confirmation email is dispatched via the email module if it's configured. In dev mode without a real SMTP provider, inspect the API logs — the scaffold logs the confirmation token so you can
validate the account manually.

Once validated, sign in and you'll land on `/dashboard`.

### Explore the App

The scaffold ships two authenticated routes:

- **`/dashboard`** — a placeholder "work in progress" landing page, ready for you to extend.
- **`/account`** — the account management surface (profile, organization settings, members, invitations).

All the people/organization/entity data lives under `/account`. There is no separate "Profile" or "Organization" top-level route — the scaffold deliberately keeps a single admin surface so you decide
how to split it as your product grows.

### API Documentation

Open http://localhost:3500/api/docs to see the auto-generated Swagger UI.

Try the **Auth endpoints** exposed by `apps/api/src/modules/auth/controllers/auth.controller.ts`:

- `POST /api/auth/signup` — create an account
- `POST /api/auth/signin` — authenticate (sets HTTP-only cookies)
- `POST /api/auth/signout` — invalidate the session
- `GET  /api/auth/me` — fetch the authenticated user's profile
- `POST /api/auth/request-password-reset` — request a reset email
- `POST /api/auth/reset-password` — reset with a token

Because auth cookies are HTTP-only, signing in from the Swagger UI won't carry the session across requests. Use the web app for the login flow, then re-open Swagger in the same browser session if you
need to hit authenticated endpoints interactively.

## Step 5: Create Your First API Endpoint

Let's add a user-scoped **tasks** feature — each user sees only their own tasks. For tenant-isolated features you would scope by `accountId` instead (see [Module System](/guide/module-system) for how
Accounts, Entities, and Organizations relate in the scaffold).

Working from the monorepo root:

```bash
cd apps/api
mkdir -p src/modules/tasks/{controllers,services,dto/requests}
```

### Define the Prisma model

Create `apps/api/prisma/schema/tasks.prisma`:

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

Add the back-relation on `User` in `apps/api/prisma/schema/users.prisma`:

```prisma
model User {
  // ... existing fields
  tasks Task[]
}
```

Apply the migration:

```bash
npm run db:setup:dev
```

This regenerates the Prisma client at `apps/api/src/generated/prisma/` — the scaffold reads Prisma types from there, not from `@prisma/client`.

### Implement the service

Create `apps/api/src/modules/tasks/services/tasks.service.ts`:

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

### Create the DTO

Create `apps/api/src/modules/tasks/dto/requests/create-task.dto.ts`:

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

### Implement the controller

Create `apps/api/src/modules/tasks/controllers/tasks.controller.ts`. The scaffold's `JwtAuthGuard` attaches the authenticated user on `request.user`:

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

### Wire the module

Create `apps/api/src/modules/tasks/tasks.module.ts`:

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

Register it in `apps/api/src/app.module.ts`:

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

### Test your endpoint

Restart the API (`npm run dev` picks up the schema change; a hard restart can help after Prisma regeneration).

Open http://localhost:3500/api/docs. Because the scaffold uses HTTP-only auth cookies, you need to sign in from the web app first (http://localhost:5173), then keep the same browser tab open for the
Swagger call. `POST /api/tasks`:

```json
{ "title": "My first task" }
```

Then `GET /api/tasks` to see the list.

✅ **Your API endpoint works!**

## Step 6: Create Your First Frontend Page

Let's create a Tasks page that talks to the endpoint you just built.

### Create the API hooks

Create `apps/web/src/hooks/api/tasks/index.ts`:

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

> The scaffold's `apiClient` uses the native Fetch API and returns the JSON body directly — there is no `.data` wrapper. Auth cookies are sent automatically thanks to `credentials: 'include'`.

### Create the page

Create `apps/web/src/pages/private/tasks.tsx` (the scaffold follows kebab-case filenames + PascalCase exports):

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

### Register the route

The scaffold declares routes as `RouteObject[]` with lazy-loaded pages — not JSX `<Route>` elements.

Add the lazy import to `apps/web/src/router/lazy-pages.tsx`:

```typescript
// --- tasks ---
export const Tasks = lazy(() => import('@/pages/private/tasks').then((module) => ({ default: module.Tasks })))
```

Add the route entry to `apps/web/src/router/private-routes.tsx` inside the `LayoutLogged` children list:

```typescript
import { AccountManagement, Dashboard, LayoutLogged, Tasks } from '@/router/lazy-pages'

// ...

{
  path: 'tasks',
  element: LazyRouteElement(Tasks)
}
```

### Add a sidebar entry

The main sidebar lives at `apps/web/src/components/layout/layout-sidebar.tsx`. Its `data.navigation` array drives the nav groups. Add a new item to one of the groups — for example:

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

> The existing entries use i18n keys (`main-navigation.tk_feature-1_`) because the scaffold renders them via `useTranslation('nav')`. For a tutorial shortcut, a plain string works; for a production
> build, add the translation keys in `apps/web/src/locales/{en,fr}/nav.yml`.

### Test Your Page

1. Open http://localhost:5173/tasks (sign in first if needed).
2. Add a task via the form.
3. Check/uncheck to toggle completion.
4. Delete a task.

✅ **Your frontend page works end-to-end against the new API.**

## Step 7: Make Your First Commit

The monorepo enforces [conventional commits with a mandatory ticket scope](https://commitlint.js.org/) via Husky + commitlint:

```
<type>(#<ticket>): <description>
```

### With Claude Code

If Claude Code is available in your terminal, simply ask:

```
Commit these changes using the sf-git-commit skill
```

The `sf-git-commit` skill (shipped in `.claude/skills/`) reads the commit pattern from `.saasfoundry.json`, groups related changes, and writes a conventional commit with the `Co-Authored-By: Claude …`
trailer.

### Manually

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

Replace `#1` with the ticket number from your issue tracker. Husky's `commit-msg` hook will reject commits that don't match the scoped pattern.

## What's Next?

Congratulations! 🎉 You've successfully:

- ✅ Created a SaaSFoundryAI project
- ✅ Added a custom API endpoint
- ✅ Built a frontend page
- ✅ Made your first commit

### Continue Learning

1. **Add Authentication to Tasks**: Implement permissions
2. **Add Tests**: Write E2E tests for tasks
3. **Deploy**: Learn how to deploy to production
4. **Add More Modules**: Try `sf update` to add email or storage

### Resources

- [Project Structure](/guide/project-structure) - Deep dive into the codebase
- [Module System](/guide/module-system) - Understanding modules
- [Skills System](/guide/skills-system) - Using Claude Code skills
- [CLI Commands](/cli/sf-new) - All available commands

## Troubleshooting

### API Won't Start

- **Check services are up**: `docker ps` should list `saasfoundry-db-dev` (and `saasfoundry-s3-dev` if you chose MinIO).
- **Check database logs**: `docker logs saasfoundry-db-dev`
- **Restart from scratch**: `npm run services:reset` (down + up), then `npm run db:setup:dev`.

### Frontend Won't Start

- **Check API is running**: `curl http://localhost:3500/api/health` should return a 200.
- **Clear Vite cache**: `rm -rf apps/web/node_modules/.vite`.

### Database Migration Fails

**Reset database** (tmpfs is wiped on stop, so a full down/up recreates an empty DB):

```bash
npm run services:reset
npm run db:setup:dev
```

### Port Already in Use

The scaffold reads ports from environment files — edit those, not the source code:

- API: `apps/api/.env` → `PORT` (default `3500`)
- Web: `apps/web/.env` → `FRONTEND_PORT` (default `5173`)

If you change the API port, also update `apps/web/.env` → `VITE_BASE_API_URL` so the frontend still reaches the backend.
