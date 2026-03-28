# sf update

Add modules to an existing SaaSFoundry project or update to latest template version.

## Usage

```bash
sf update
```

Runs in the current directory. Must be executed from a SaaSFoundry project root (where `.saasfoundry.json` exists).

## What It Does

The `sf update` command serves two purposes:

1. **Add Modules**: Install optional modules (email, storage, analytics) that weren't included during `sf new`
2. **Template Updates**: Apply template changes from newer SaaSFoundry versions (coming soon)

## Available Modules

### Email Service (MailerSend)

**What**: Transactional email service for account creation, password reset, invitations

**Affects**: API only

**Options**:
- **None**: Skip email setup (email logic stays disabled)
- **MailerSend**: Configure MailerSend API credentials

**What Gets Installed**:
- `src/modules/email/services/mailersend.service.ts`
- Email templates and logic activated
- Environment variables: `MAILERSEND_API_KEY`, `MAILERSEND_SENDER_EMAIL`, `MAILERSEND_SENDER_NAME`
- GitHub Actions deployment updated with secrets

**Example**:
```bash
sf update
# Select: Email Service (MailerSend)
# Choose: MailerSend
# Enter API key: your-api-key
# Enter sender email: noreply@myapp.com
# Enter sender name: MyApp Team
```

[Learn more](/modules/email)

### Storage (S3)

**What**: File upload and object storage with S3-compatible services

**Affects**: API + Web

**Options**:
- **Manual**: Skip storage setup
- **Docker (MinIO)**: S3-compatible storage in Docker
- **Credentials**: Connect to AWS S3, Backblaze B2, etc.

**What Gets Installed**:
- `apps/api/src/modules/storage/` - Complete storage module
- Multer file upload support
- Environment variables: `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_PUBLIC_URL`
- Dependencies: `@aws-sdk/client-s3`, `@types/multer`
- Frontend: Storage enabled flag in `.env`

**Example**:
```bash
sf update
# Select: Storage (S3)
# Choose: Docker (MinIO)
# Or: Credentials → enter S3 details
```

[Learn more](/modules/storage)

### Analytics (Umami)

**What**: Privacy-focused web analytics

**Affects**: Web only

**Options**:
- **Skip**: No analytics
- **Configure**: Enter Umami URL and Website ID

**What Gets Installed**:
- `apps/web/src/lib/analytics/` - Analytics module
- Auto-tracking on page views
- Custom event tracking helpers
- Environment variables: `VITE_ANALYTICS_URL`, `VITE_ANALYTICS_WEBSITE_ID`

**Example**:
```bash
sf update
# Select: Analytics (Umami)
# Enter analytics URL: https://analytics.myapp.com/script.js
# Enter website ID: abc123-def456
```

[Learn more](/modules/analytics)

## How It Works

### Module Detection

`sf update` reads `.saasfoundry.json` to determine:
- Which modules are already installed
- Which modules are available to add

**Example manifest**:
```json
{
  "version": "1.0.0-beta",
  "structure": "monorepo",
  "modules": {
    "emailService": "none",        // ← Can add MailerSend
    "s3Setup": "manual",            // ← Can add S3
    "dbSetup": "docker",
    "includeAnalytics": false       // ← Can add Umami
  }
}
```

### Interactive Selection

```bash
sf update

🔄 SaaSFoundry Update

Available modules to install:
  1. Email Service (MailerSend)
  2. Storage (S3)
  3. Analytics (Umami)

? Which modules would you like to add? (Space to select, Enter to confirm)
❯ ◉ Email Service (MailerSend)
  ◯ Storage (S3)
  ◉ Analytics (Umami)
```

### Module Installation

For each selected module, the installer:

1. **Copies overlay files** from `scaffolds/overlays/modules/` to your project
2. **Activates blueprint code** by uncommenting `// TODO module-active:` markers
3. **Updates environment files** (`.env`, `.env.test`)
4. **Installs dependencies** (`package.json` updated)
5. **Updates manifest** (`.saasfoundry.json` tracks installed modules)

**Example** (Email module):

Before:
```typescript
// TODO mailer-service-active: import { MailerSendService } from './mailersend.service'

export class EmailService {
  // TODO mailer-service-active: constructor(private readonly mailerSend: MailerSendService) {}

  async sendEmail(to: string, subject: string, html: string) {
    console.log('Email would be sent:', { to, subject })
    // TODO mailer-service-active: await this.mailerSend.send({ to, subject, html })
  }
}
```

After `sf update` (Email module):
```typescript
import { MailerSendService } from './mailersend.service'

export class EmailService {
  constructor(private readonly mailerSend: MailerSendService) {}

  async sendEmail(to: string, subject: string, html: string) {
    await this.mailerSend.send({ to, subject, html })
  }
}
```

## Three-Way Merge System

When updating to a new SaaSFoundry template version, the system performs a **three-way file comparison** to safely apply changes.

### How It Works

For each file, compare three versions:

1. **Base**: Hash stored in `.saasfoundry.json` (what was originally generated)
2. **Current**: Hash of your modified file
3. **Target**: Hash from new template version

| Base vs Current | Base vs Target | Action |
|-----------------|----------------|--------|
| Same (untouched) | Different (template changed) | ✅ **Auto-update** - Safe to replace |
| Different (you modified) | Same (template unchanged) | ⏭️ **Skip** - Keep your changes |
| Different | Different | ⚠️ **Conflict** - Save as `.saasfoundry.new` |
| Same | Same | ⏭️ **Skip** - Nothing changed |

### Conflict Resolution

If you and the template both modified the same file:

```bash
⚠️  Conflict detected: apps/api/src/main.ts
    Saved new version as: apps/api/src/main.ts.saasfoundry.new

Review changes and manually merge:
  - Your version: apps/api/src/main.ts
  - New template: apps/api/src/main.ts.saasfoundry.new
```

**Resolution steps**:

1. Open both files
2. Compare changes (use `diff` or your IDE)
3. Manually merge important changes
4. Delete `.saasfoundry.new` file

**Example**:
```bash
# View differences
diff apps/api/src/main.ts apps/api/src/main.ts.saasfoundry.new

# Or use your IDE's diff tool
code --diff apps/api/src/main.ts apps/api/src/main.ts.saasfoundry.new
```

### Excluded Files

Some files are never updated automatically:

- `.env`, `.env.test` - Contain secrets
- `node_modules/`, `.git/`, `dist/`
- `.saasfoundry.json` - Manifest file
- `package-lock.json`, `pnpm-lock.yaml`

## Examples

### Add Email Service

```bash
cd my-saas-app
sf update

# Select: Email Service (MailerSend)
# Enter credentials
```

**Result**:
- MailerSend service installed
- Account creation emails work
- Password reset emails work
- Invitation emails work

**Test**:
```bash
# Register a new user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!",
    "firstName": "John",
    "lastName": "Doe",
    "organizationName": "ACME"
  }'

# Check email inbox for welcome email
```

### Add S3 Storage

```bash
cd my-saas-app
sf update

# Select: Storage (S3)
# Choose: Docker (MinIO)
```

**Result**:
- MinIO added to `docker-compose.dev-services.yml`
- Storage module activated
- File upload endpoint available
- Organization logo upload works

**Test**:
```bash
# Start MinIO
docker compose -f docker-compose.dev-services.yml up -d

# Upload file
curl -X POST http://localhost:3000/api/storage/upload \
  -H "Authorization: Bearer {token}" \
  -F "file=@logo.png"
```

### Add Analytics

```bash
cd my-saas-app
sf update

# Select: Analytics (Umami)
# Enter: Analytics URL and Website ID
```

**Result**:
- Umami tracking script added
- Page views tracked automatically
- Custom event tracking available

**Test**:
```bash
# Start app
npm run dev

# Open http://localhost:5173
# Navigate pages → Check Umami dashboard for page views
```

### Add Multiple Modules

```bash
sf update

# Select:
# ✓ Email Service (MailerSend)
# ✓ Storage (S3)
# ✓ Analytics (Umami)

# Enter credentials for each
```

**Result**: All modules installed in one run.

## Manifest File

After `sf update`, `.saasfoundry.json` is updated:

**Before**:
```json
{
  "version": "1.0.0-beta",
  "modules": {
    "emailService": "none",
    "s3Setup": "manual",
    "includeAnalytics": false
  }
}
```

**After** (added MailerSend + MinIO + Umami):
```json
{
  "version": "1.0.0-beta",
  "modules": {
    "emailService": "mailersend",
    "s3Setup": "docker",
    "includeAnalytics": true
  }
}
```

**Purpose**:
- Track installed modules
- Prevent duplicate installations
- Support template updates
- Three-way merge reference

## Environment Variables

Modules add variables to `.env` files.

### Email (MailerSend)

**API `.env`**:
```env
# Email
MAILERSEND_API_KEY="your-api-key"
MAILERSEND_SENDER_EMAIL="noreply@myapp.com"
MAILERSEND_SENDER_NAME="MyApp Team"
```

### Storage (S3)

**API `.env`**:
```env
# S3 Storage
S3_ENDPOINT="http://localhost:9000"
S3_REGION="us-east-1"
S3_ACCESS_KEY_ID="minioadmin"
S3_SECRET_ACCESS_KEY="minioadmin"
S3_BUCKET="myapp-uploads"
S3_PUBLIC_URL="http://localhost:9000/myapp-uploads"
```

**Web `.env`**:
```env
VITE_STORAGE_ENABLED="true"
```

### Analytics (Umami)

**Web `.env`**:
```env
VITE_ANALYTICS_URL="https://analytics.myapp.com/script.js"
VITE_ANALYTICS_WEBSITE_ID="abc123-def456"
```

## Post-Installation

After adding modules:

### 1. Install Dependencies

**Monorepo**:
```bash
npm install  # Root
```

**Multirepo**:
```bash
cd api && npm install
cd ../web && npm install
```

### 2. Restart Dev Servers

```bash
# Stop current servers (Ctrl+C)

# Restart
npm run dev
```

### 3. Update Docker Services (if applicable)

```bash
# If added MinIO or database
docker compose -f docker-compose.dev-services.yml up -d
```

### 4. Test Modules

- **Email**: Register a new user, check inbox
- **Storage**: Upload a file via `/api/storage/upload`
- **Analytics**: Navigate pages, check Umami dashboard

## Troubleshooting

### Module Already Installed

```
⚠️  Email Service is already configured (mailersend)
    Skipping installation.
```

**Solution**: Module is already installed. To reconfigure, manually edit `.env` or reinstall project.

### Invalid Manifest

```
❌  Could not find .saasfoundry.json
    Are you in a SaaSFoundry project directory?
```

**Solution**: Run `sf update` from project root (where `.saasfoundry.json` exists).

### Dependency Installation Failed

```
❌  Failed to install dependencies
    Run 'npm install' manually
```

**Solution**:
```bash
npm install  # Manually install dependencies
```

### Docker Service Not Starting

```
❌  MinIO container failed to start
```

**Solution**:
```bash
# Check Docker is running
docker ps

# Check logs
docker compose -f docker-compose.dev-services.yml logs

# Restart services
docker compose -f docker-compose.dev-services.yml down
docker compose -f docker-compose.dev-services.yml up -d
```

## Best Practices

### 1. Add Modules Incrementally

Don't add all modules at once. Add and test one at a time:

```bash
# Step 1: Add email
sf update → Email Service → Test

# Step 2: Add storage
sf update → Storage → Test

# Step 3: Add analytics
sf update → Analytics → Test
```

### 2. Commit After Each Module

```bash
sf update  # Add email
git add .
git commit -m "feat: add MailerSend email service"

sf update  # Add storage
git add .
git commit -m "feat: add MinIO S3 storage"
```

### 3. Use Docker for Development

Choose Docker options for easier local setup:
- Database: Docker PostgreSQL
- Storage: Docker MinIO

Switch to production services later.

### 4. Test Before Production

Test modules in development before using production credentials:
- Email: Test with MailerSend sandbox
- Storage: Test with MinIO before AWS S3
- Analytics: Test with self-hosted Umami

## Version Updates

When a new SaaSFoundry version is released:

```bash
# Update CLI
npm install -g saasfoundry-cli@latest

# Update project templates
cd my-saas-app
sf update

# Three-way merge applies template changes
# Review any conflicts (.saasfoundry.new files)
```

## Related Commands

- [`sf new`](/cli/sf-new) - Create new project with modules
- [`sf workflow`](/cli/sf-workflow) - Configure workflow system
- [`sf tools`](/cli/sf-tools) - Manage credentials

## Next Steps

- [Module System](/guide/module-system) - How modules work
- [Email Module](/modules/email) - Email service details
- [Storage Module](/modules/storage) - S3 storage details
- [Analytics Module](/modules/analytics) - Umami analytics details

## See Also

- [First Project](/getting-started/first-project) - Complete tutorial
- [Project Structure](/guide/project-structure) - Understanding the codebase
