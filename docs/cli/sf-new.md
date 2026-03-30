# sf new

Create a new SaaSFoundry project with interactive prompts.

## Usage

```bash
sf new
```

## What It Does

The `sf new` command scaffolds a production-ready SaaS project with:

- **Full-stack setup**: NestJS API + React frontend
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: JWT + Passport
- **Modern tooling**: TypeScript, TailwindCSS, Vite
- **Project structure**: Monorepo or multirepo
- **Optional modules**: Email, storage, analytics
- **Workflow integration**: GitHub Projects, Jira, Notion, or Linear

## Interactive Prompts

### Basic Configuration

- Project name
- Project structure (monorepo/multirepo)
- Git repository initialization

### Optional Modules

- Email service (MailerSend)
- S3 storage (AWS/Minio/Wasabi)
- Analytics (Umami)

### Workflow & Project Management

During setup, SaaSFoundry **automatically detects available project management tools** based on:

1. **Credentials**: Scans `~/.claude/credentials/` for Jira, Notion, Linear
2. **GitHub CLI**: Checks `gh auth status` for GitHub Projects availability

**Auto-detected tools appear with a ✓ icon:**

```bash
🔍 Detecting available project management tools...

✅ Found credentials for:
  - github-projects (recommended)
  - jira
  - notion

? Choose your project management tool:
  ✓ GitHub Projects (built-in, authenticated) ← recommended
  ✓ Jira (Atlassian, credentials found)
  ✓ Notion (credentials found)
  Linear
  None (no project management integration)
```

#### GitHub Projects Auto-Creation

When you select GitHub Projects and `gh` is authenticated, you can create a new project automatically:

```bash
? Create a new GitHub Project automatically? Yes
? Project name: Development Board

🔨 Creating GitHub Project "Development Board"...
✅ Project created: https://github.com/orgs/myorg/projects/1
```

**Requirements:**

- `gh` CLI authenticated (`gh auth login`)
- Permission to create projects in your repository/org

**Benefits:**

- ✅ No manual project board setup
- ✅ Instant integration with your repository
- ✅ Automatic URL configuration

#### Other Tools Setup

For Jira, Notion, and Linear:

1. Configure credentials first: `sf tools add {tool} {account}`
2. Run `sf new` to see them in the auto-detection
3. Enter your project URL when prompted

**Learn more:**

- [Workflow System Guide](/guide/workflow-system)
- [sf workflow command](/cli/sf-workflow)

### Database Setup

- Docker (recommended for development)
- Manual (existing PostgreSQL instance)

## Examples

```bash
# Create a new project
sf new
```

```bash
# Follow the interactive prompts to configure your project
```

```bash
# Setup GitHub Projects with auto-creation
sf new
# Select: ✓ GitHub Projects (built-in, authenticated)
# Choose: Create a new GitHub Project automatically? Yes
```

```bash
# Use existing Jira project
sf new
# Select: ✓ Jira (Atlassian, credentials found)
# Enter: Jira project URL
```

## Post-Setup

After running `sf new`, your project includes:

- ✅ Configured workflow in `.saasfoundry-workflow.json`
- ✅ AI development rules in `.saasfoundry.json`
- ✅ Skills in `.claude/skills/` for git operations
- ✅ Pre-configured git hooks (Husky + Commitlint)
- ✅ Ready-to-use development environment

**Next steps:**

```bash
# Install dependencies
npm install

# Start development
npm run dev

# Validate workflow setup
sf workflow validate
```

## See Also

- [Getting Started](/getting-started/quick-start)
- [Workflow System](/guide/workflow-system)
- [sf workflow](/cli/sf-workflow)
- [sf update](/cli/sf-update)
- [Skills System](/guide/skills-system)
