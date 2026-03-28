# sf new

Create a new SaaSFoundry project with interactive prompts.

## Usage

```bash
sf new
```

The command will guide you through an interactive setup process to configure your project.

## Interactive Options

### 1. Project Name

```
? What is the name of your project?
```

- **Format**: Lowercase letters, numbers, and hyphens only
- **Example**: `my-saas-app`, `acme-platform`, `startup-mvp`
- **Used for**: Directory name, package names, default email domains

### 2. Project Description

```
? What is the description of your project?
```

- **Default**: `{projectName} is just an amazing SaaSFoundry project`
- **Used for**: package.json description, README
- **Optional**: Can be updated later

### 3. Main Branch Name

```
? Which main branch name do you prefer?
```

**Options**:
- `main` (modern standard)
- `master` (traditional)

**Recommendation**: Use `main` for new projects (GitHub default since 2020).

### 4. Project Structure

```
? How would you like to structure your project?
```

**Options**:

#### Monorepo (Recommended)
- ✅ Single Git repository
- ✅ Turborepo for build orchestration
- ✅ Shared tooling (ESLint, Prettier, TypeScript configs)
- ✅ Centralized skills and workflows
- ✅ Easier dependency management
- ✅ Better for small-medium teams

**Structure**:
```
my-saas-app/
├── apps/
│   ├── api/          # NestJS backend
│   └── web/          # React frontend
├── packages/         # Shared packages (future)
├── .claude/          # Shared Claude Code skills
└── turbo.json        # Turborepo config
```

#### Multirepo
- ✅ Separate repositories for API and Web
- ✅ Independent versioning
- ✅ Independent deployments
- ✅ Better for large teams with separate ownership
- ❌ More complex dependency management
- ❌ Duplicate tooling configuration

**Structure**:
```
my-saas-app-api/      # Backend repo
my-saas-app-web/      # Frontend repo
```

**When to use Multirepo**:
- Large team with separate backend/frontend teams
- Different release cycles for API and Web
- Microservices architecture planned

### 5. Git Repository

**For Monorepo**:
```
? Do you have already a remote repository?
```

**For Multirepo**:
```
? Do you have already remote repositories?
```

**Options**:
- `Not yet, just setup on local` - Initialize local Git only
- `Yes, I'll give you the link(s)` - Connect to existing remote(s)

If connecting to existing:
- **Monorepo**: Enter single Git URL
- **Multirepo**: Enter separate URLs for API and Web repos

### 6. Database Setup

```
? Do you want to set up a development database with Docker?
```

**Options**:

#### Docker (Recommended for Development)
- ✅ PostgreSQL 16 in Docker container
- ✅ Automatic setup via `docker-compose.dev-services.yml`
- ✅ Isolated from system
- ✅ Easy reset/cleanup
- ✅ Same environment for all devs
- **Requires**: Docker Desktop installed

**Configuration**:
- Database: `db_dev` (customizable)
- User: `db_dev_user` (customizable)
- Password: `db_dev_password` (customizable)
- Port: `5435` (to avoid conflicts with system PostgreSQL)

#### Connect to Existing Database
- ✅ Use your own PostgreSQL or SQL Server
- ✅ Production-like environment
- **Requires**: Database credentials

**Prompted for**:
- Database type (PostgreSQL / SQL Server)
- Host
- Port
- User
- Password
- Database name

#### Manual (Setup Later)
- ✅ Skip database setup
- ✅ Configure later manually
- **Use when**: Testing CLI, custom database setup

### 7. Email Service

```
? For your transactional emails, which service would you like to set up?
```

**Options**:

#### None (Email Logic Only)
- ✅ Email service structure generated
- ✅ Logic for account creation, password reset
- ❌ Emails won't be sent (console.log only)
- **Use when**: Testing, will implement custom provider

#### MailerSend (Recommended)
- ✅ Free tier: 3,000 emails/month
- ✅ Easy setup
- ✅ Email verification included
- ✅ Analytics dashboard
- **Requires**: MailerSend account (free)

**Configuration** (if selected):
- API Key
- Sender Email (e.g., `noreply@myapp.com`)
- Sender Name (e.g., `MyApp Team`)

**Process**:
1. CLI opens MailerSend signup page
2. Create account and get API key
3. Enter credentials in CLI
4. Ready to send emails!

### 8. S3 Storage

```
? Do you want to set up object storage (S3) for file uploads?
```

**Options**:

#### Docker (MinIO - Recommended for Development)
- ✅ S3-compatible storage in Docker
- ✅ Free and local
- ✅ Same API as AWS S3
- ✅ Automatic setup
- **Requires**: Docker Desktop

**Configuration**:
- Endpoint: `http://localhost:9000`
- Access Key: `minioadmin` (customizable)
- Secret Key: `minioadmin` (customizable)
- Bucket: `{projectName}-uploads`

#### Connect to Existing S3
- ✅ Use AWS S3, Backblaze B2, DigitalOcean Spaces, etc.
- ✅ Production-ready
- **Requires**: S3 credentials

**Prompted for**:
- Endpoint (e.g., `s3.amazonaws.com`)
- Region
- Access Key ID
- Secret Access Key
- Bucket name
- Public URL (for direct file access)

#### Manual (Setup Later)
- ✅ Skip storage setup
- ✅ Storage module code still generated (disabled)
- **Use when**: Testing, custom storage solution

### 9. Analytics

```
? Do you want to include Umami analytics in your frontend?
```

**Options**:

#### Yes - Include Umami
- ✅ Privacy-focused analytics
- ✅ No cookies required
- ✅ GDPR compliant
- ✅ Self-hostable or cloud
- **Requires**: Umami instance URL + Website ID

**Configuration**:
- Analytics URL (e.g., `https://analytics.myapp.com`)
- Website ID (from Umami dashboard)

#### No
- Analytics module not included
- Can be added later with `sf update`

## Examples

### Minimal Setup (Testing)

```bash
sf new
# Project name: test-app
# Structure: Monorepo
# Repository: Local only
# Database: Manual
# Email: None
# S3: Manual
# Analytics: No
```

**Result**: Minimal project structure for testing CLI.

### Full Development Setup (Recommended)

```bash
sf new
# Project name: my-saas
# Structure: Monorepo
# Repository: Local only (add remote later)
# Database: Docker ✓
# Email: MailerSend ✓ (with credentials)
# S3: Docker (MinIO) ✓
# Analytics: Yes ✓ (with Umami URL)
```

**Result**: Complete development environment ready to code.

### Production-Ready Setup

```bash
sf new
# Project name: acme-platform
# Structure: Monorepo
# Repository: https://github.com/myorg/acme-platform.git
# Database: Connect to existing (PostgreSQL)
# Email: MailerSend (production credentials)
# S3: AWS S3 (production bucket)
# Analytics: Umami (self-hosted instance)
```

**Result**: Production-configured project.

## What Gets Generated?

### Monorepo Structure

```
my-saas/
├── apps/
│   ├── api/                    # NestJS 11 backend
│   │   ├── src/
│   │   │   ├── modules/        # Feature modules
│   │   │   │   ├── auth/       # JWT authentication
│   │   │   │   ├── users/      # User management
│   │   │   │   ├── organizations/
│   │   │   │   ├── invitation/
│   │   │   │   ├── email/      # Email service
│   │   │   │   └── storage/    # S3 storage (if enabled)
│   │   │   ├── configs/        # Environment config
│   │   │   └── common/         # Shared utilities
│   │   ├── prisma/             # Database schema
│   │   ├── tests/              # E2E tests
│   │   └── package.json
│   │
│   └── web/                    # React 19 frontend
│       ├── src/
│       │   ├── pages/          # Route pages
│       │   │   ├── private/    # Protected pages
│       │   │   └── public/     # Public pages (login, register)
│       │   ├── components/
│       │   │   ├── layout/
│       │   │   ├── nav/
│       │   │   └── ui/         # ShadCN components
│       │   ├── hooks/
│       │   │   └── api/        # React Query hooks
│       │   ├── router/         # React Router v7
│       │   ├── locales/        # i18n (EN/FR)
│       │   └── lib/
│       │       └── analytics/  # Umami (if enabled)
│       ├── tests/              # Playwright E2E
│       └── package.json
│
├── .claude/                    # Claude Code skills
│   └── skills/
│       ├── sf-git-commit/
│       ├── sf-git-create-pr/
│       ├── sf-utils-fix-errors/
│       └── sf-workflow-apex/
│
├── docker-compose.dev-services.yml  # Dev services (DB, MinIO)
├── .saasfoundry.json                # Project manifest
├── turbo.json                       # Turborepo config
├── package.json                     # Root package
└── README.md
```

### Environment Files

**API `.env`**:
```bash
# Database
DATABASE_URL="postgresql://user:pass@localhost:5435/db_dev"

# JWT
JWT_ACCESS_SECRET="generated-secret"
JWT_REFRESH_SECRET="generated-secret"

# Email (if MailerSend)
MAILERSEND_API_KEY="your-api-key"
MAILERSEND_SENDER_EMAIL="noreply@myapp.com"
MAILERSEND_SENDER_NAME="MyApp"

# S3 (if enabled)
S3_ENDPOINT="http://localhost:9000"
S3_REGION="us-east-1"
S3_ACCESS_KEY_ID="minioadmin"
S3_SECRET_ACCESS_KEY="minioadmin"
S3_BUCKET="myapp-uploads"
```

**Web `.env`**:
```bash
# API
VITE_API_URL="http://localhost:3000/api"

# Analytics (if enabled)
VITE_ANALYTICS_URL="https://analytics.myapp.com"
VITE_ANALYTICS_WEBSITE_ID="your-website-id"

# Storage (if enabled)
VITE_STORAGE_ENABLED="true"
```

## After Generation

### Start Development

**Monorepo**:
```bash
cd my-saas
npm install                # Install all dependencies
npm run dev                # Start API + Web in parallel
```

**Multirepo**:
```bash
# Backend
cd my-saas-api
npm install
npm run dev                # API: http://localhost:3000

# Frontend (separate terminal)
cd my-saas-web
npm install
npm run dev                # Web: http://localhost:5173
```

### Initialize Database

**If Docker**:
```bash
docker compose -f docker-compose.dev-services.yml up -d
npm run db:update:dev      # Run Prisma migrations
```

**If Manual/Credentials**:
```bash
# Ensure DATABASE_URL is correct in .env
npm run db:update:dev      # Run Prisma migrations
```

### Access Your App

- **Frontend**: http://localhost:5173
- **API**: http://localhost:3000
- **API Docs**: http://localhost:3000/api-docs (Swagger)
- **MinIO Console** (if Docker S3): http://localhost:9001

## Manifest File

After generation, `.saasfoundry.json` tracks your configuration:

```json
{
  "version": "1.0.0-beta",
  "generatedAt": "2026-03-28T...",
  "structure": "monorepo",
  "projectName": "my-saas",
  "modules": {
    "emailService": "mailersend",
    "s3Setup": "docker",
    "dbSetup": "docker",
    "includeAnalytics": true
  },
  "fileHashes": {
    "apps/api/package.json": "abc123...",
    ...
  }
}
```

**Purpose**:
- Track which modules are installed
- Enable `sf update` to add modules later
- Support three-way merge during template updates
- **No secrets stored** - only configuration choices

## Next Steps

After creating your project:

1. **Review generated code**: Understand the structure
2. **Configure .env files**: Add real credentials for production
3. **Run tests**: `npm run test:full` (monorepo) or `npm test` (multirepo)
4. **Start coding**: Add your business logic
5. **Use skills**: Try `/commit`, `/fix-errors`, `/pr` in Claude Code

## Related Commands

- [`sf update`](/cli/sf-update) - Add modules to existing project
- [`sf workflow`](/cli/sf-workflow) - Configure workflow system
- [`sf tools`](/cli/sf-tools) - Manage multi-account credentials

## Troubleshooting

### Docker Issues

**Problem**: `docker-compose.dev-services.yml: no such file`

**Solution**: You selected "Manual" for database/S3. Either:
- Use `npm run dev` (without Docker services)
- Re-run `sf update` to add Docker services

### Port Conflicts

**Problem**: `Port 3000 already in use`

**Solution**: Another app is using the port. Either:
- Stop the other app
- Change port in `apps/api/src/main.ts`

### Database Connection

**Problem**: `Can't reach database server`

**Solution**:
- If Docker: Run `docker compose -f docker-compose.dev-services.yml up -d`
- If Manual: Check DATABASE_URL in .env
- Ensure PostgreSQL is running and accessible

## See Also

- [Getting Started](/getting-started/quick-start) - Quick start guide
- [First Project](/getting-started/first-project) - Detailed walkthrough
- [Project Structure](/guide/project-structure) - Understanding the codebase
- [Module System](/guide/module-system) - How modules work
