# First Project

A comprehensive walkthrough of creating your first SaaS project with SaaSFoundry.

## What You'll Build

In this guide, you'll:

1. Create a new SaaSFoundry project
2. Understand the generated structure
3. Run the development environment
4. Create a custom API endpoint
5. Add a new frontend page
6. Make your first commit with Claude Code

**Time Required**: ~30 minutes

## Prerequisites

- Node.js 20.19+ installed
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
→ My first SaaSFoundry project (press Enter)

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

```bash
docker compose -f docker-compose.dev-services.yml up -d
```

This starts:

- PostgreSQL (port 5435)
- MinIO S3 (port 9000, console 9001)

Verify services are running:

```bash
docker compose -f docker-compose.dev-services.yml ps
```

### Initialize Database

```bash
npm run db:update:dev
```

This runs Prisma migrations to create database tables.

### Start Dev Servers

From the project root:

```bash
npm run dev
```

This starts **both** API and Web in parallel:

```
API:  http://localhost:3000
Web:  http://localhost:5173
```

Wait for:

```
[api] ✓ Nest application successfully started
[web] ✓ ready in 234 ms
```

## Step 4: Test the Generated App

### Register an Account

1. Open http://localhost:5173
2. Click **"Sign Up"**
3. Fill the registration form:
   - Email: `test@example.com`
   - Password: `Test123!`
   - First Name: `John`
   - Last Name: `Doe`
   - Organization: `My Company`
4. Click **"Create Account"**

✅ You should be redirected to the dashboard!

### Explore the Dashboard

The generated app includes:

- **Dashboard**: Overview page
- **Profile**: User settings
- **Organization**: Team management
- **Members**: Invite team members

### API Documentation

Open http://localhost:3000/api-docs to see Swagger documentation.

Try the **Auth endpoints**:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/profile`

## Step 5: Create Your First API Endpoint

Let's add a simple "tasks" feature.

### Create Task Module

```bash
cd apps/api
```

Create the module structure:

```bash
mkdir -p src/modules/tasks
touch src/modules/tasks/tasks.module.ts
touch src/modules/tasks/tasks.controller.ts
touch src/modules/tasks/tasks.service.ts
touch src/modules/tasks/dto/create-task.dto.ts
```

### Define Task Model

Edit `apps/api/prisma/schema/tasks.prisma`:

```prisma
model Task {
  id             String   @id @default(uuid())
  title          String
  description    String?
  completed      Boolean  @default(false)
  userId         String
  organizationId String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@map("tasks")
}
```

Update `apps/api/prisma/schema/user.prisma` to add the relation:

```prisma
model User {
  // ... existing fields
  tasks Task[]  // Add this line
}
```

Update `apps/api/prisma/schema/organization.prisma`:

```prisma
model Organization {
  // ... existing fields
  tasks Task[]  // Add this line
}
```

Run migration:

```bash
npm run db:update:dev
```

### Implement Task Controller

Edit `apps/api/src/modules/tasks/tasks.controller.ts`:

```typescript
import { Controller, Get, Post, Body, Param, Patch, Delete, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard'
import { CurrentUser } from '@common/decorators/current-user.decorator'
import { User } from '@prisma/client'
import { TasksService } from './tasks.service'
import { CreateTaskDto } from './dto/create-task.dto'

@ApiTags('tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  create(@CurrentUser() user: User, @Body() createTaskDto: CreateTaskDto) {
    return this.tasksService.create(user, createTaskDto)
  }

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.tasksService.findAll(user)
  }

  @Patch(':id/toggle')
  toggle(@CurrentUser() user: User, @Param('id') id: string) {
    return this.tasksService.toggle(user, id)
  }

  @Delete(':id')
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.tasksService.remove(user, id)
  }
}
```

### Implement Task Service

Edit `apps/api/src/modules/tasks/tasks.service.ts`:

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '@configs/database/prisma.service'
import { User } from '@prisma/client'
import { CreateTaskDto } from './dto/create-task.dto'

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: User, dto: CreateTaskDto) {
    return this.prisma.task.create({
      data: {
        ...dto,
        userId: user.id,
        organizationId: user.organizationId
      }
    })
  }

  async findAll(user: User) {
    return this.prisma.task.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: 'desc' }
    })
  }

  async toggle(user: User, id: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, organizationId: user.organizationId }
    })

    return this.prisma.task.update({
      where: { id },
      data: { completed: !task.completed }
    })
  }

  async remove(user: User, id: string) {
    await this.prisma.task.deleteMany({
      where: { id, organizationId: user.organizationId }
    })
  }
}
```

### Create DTO

Edit `apps/api/src/modules/tasks/dto/create-task.dto.ts`:

```typescript
import { IsString, IsOptional, IsNotEmpty } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateTaskDto {
  @ApiProperty({ example: 'Finish documentation' })
  @IsString()
  @IsNotEmpty()
  title: string

  @ApiPropertyOptional({ example: 'Complete the getting started guide' })
  @IsString()
  @IsOptional()
  description?: string
}
```

### Register Module

Edit `apps/api/src/modules/tasks/tasks.module.ts`:

```typescript
import { Module } from '@nestjs/common'
import { TasksController } from './tasks.controller'
import { TasksService } from './tasks.service'

@Module({
  controllers: [TasksController],
  providers: [TasksService]
})
export class TasksModule {}
```

Import in `apps/api/src/app.module.ts`:

```typescript
import { TasksModule } from '@modules/tasks/tasks.module'

@Module({
  imports: [
    // ... existing modules
    TasksModule // Add this
  ]
})
export class AppModule {}
```

### Test Your Endpoint

Restart the API server (Ctrl+C then `npm run dev`).

Test with Swagger at http://localhost:3000/api-docs:

1. Authorize with your JWT token (login first)
2. Try `POST /api/tasks`:
   ```json
   {
     "title": "My first task",
     "description": "Created via API"
   }
   ```
3. Try `GET /api/tasks` to see your tasks

✅ **Your API endpoint works!**

## Step 6: Create Your First Frontend Page

Let's create a Tasks page to display and manage tasks.

### Create API Hook

Create `apps/web/src/hooks/api/useTasks.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface Task {
  id: string
  title: string
  description: string | null
  completed: boolean
  createdAt: string
}

export function useTasks() {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      const { data } = await api.get<Task[]>('/tasks')
      return data
    }
  })
}

export function useCreateTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (task: { title: string; description?: string }) => {
      const { data } = await api.post('/tasks', task)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    }
  })
}

export function useToggleTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.patch(`/tasks/${id}/toggle`)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    }
  })
}

export function useDeleteTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/tasks/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    }
  })
}
```

### Create Tasks Page

Create `apps/web/src/pages/private/Tasks.tsx`:

```typescript
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { useTasks, useCreateTask, useToggleTask, useDeleteTask } from '@/hooks/api/useTasks'

export function Tasks() {
  const [title, setTitle] = useState('')
  const { data: tasks, isLoading } = useTasks()
  const createTask = useCreateTask()
  const toggleTask = useToggleTask()
  const deleteTask = useDeleteTask()

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    createTask.mutate({ title })
    setTitle('')
  }

  if (isLoading) return <div>Loading...</div>

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Tasks</h1>

      <form onSubmit={handleCreate} className="mb-8 flex gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a new task..."
          className="flex-1"
        />
        <Button type="submit" disabled={createTask.isPending}>
          Add Task
        </Button>
      </form>

      <div className="space-y-2">
        {tasks?.map((task) => (
          <div
            key={task.id}
            className="flex items-center gap-3 p-4 border rounded-lg"
          >
            <Checkbox
              checked={task.completed}
              onCheckedChange={() => toggleTask.mutate(task.id)}
            />
            <span className={task.completed ? 'line-through text-gray-500' : ''}>
              {task.title}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => deleteTask.mutate(task.id)}
              className="ml-auto"
            >
              Delete
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

### Add Route

Edit `apps/web/src/router/routes.tsx`:

```typescript
import { Tasks } from '@/pages/private/Tasks'

// Inside ProtectedLayout routes:
<Route path="/tasks" element={<Tasks />} />
```

### Add Navigation Link

Edit `apps/web/src/components/nav/Sidebar.tsx`:

```typescript
// Add to navigation links:
{
  title: 'Tasks',
  url: '/tasks',
  icon: CheckSquare  // Import from lucide-react
}
```

### Test Your Page

1. Refresh http://localhost:5173
2. Click **"Tasks"** in the sidebar
3. Add a task
4. Check/uncheck to mark complete
5. Delete a task

✅ **Your frontend page works!**

## Step 7: Make Your First Commit

If you have Claude Code installed:

```bash
# In Claude Code terminal
/commit
```

Claude will:

1. Review your changes
2. Generate a commit message following conventions
3. Create the commit

Example commit message:

```
feat: add tasks module with API and frontend

- Add Task model to Prisma schema
- Create tasks module with CRUD operations
- Add tasks page in frontend with React Query hooks
- Support create, toggle, and delete tasks

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

Or manually:

```bash
git add .
git commit -m "feat: add tasks module with API and frontend"
```

## What's Next?

Congratulations! 🎉 You've successfully:

- ✅ Created a SaaSFoundry project
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

**Check database**: `docker compose -f docker-compose.dev-services.yml ps` **Check logs**: `docker compose -f docker-compose.dev-services.yml logs db`

### Frontend Won't Start

**Check API is running**: curl http://localhost:3000/api/health **Clear cache**: `rm -rf apps/web/.vite`

### Database Migration Fails

**Reset database**:

```bash
docker compose -f docker-compose.dev-services.yml down -v
docker compose -f docker-compose.dev-services.yml up -d
npm run db:update:dev
```

### Port Already in Use

Change ports in:

- API: `apps/api/src/main.ts` (default 3000)
- Web: `apps/web/vite.config.ts` (default 5173)
