# Module System

SaaSFoundry's module system lets you add features to projects during or after creation.

## Overview

Modules are optional features that can be added:

- 📧 **Email** - MailerSend integration for transactional emails
- 📦 **Storage** - S3-compatible storage for file uploads
- 📊 **Analytics** - Umami analytics for user tracking

## Adding Modules

### During Project Creation

```bash
sf new
# Interactive prompts include module selection
? Email service: MailerSend
? S3 storage: Docker (local development)
? Analytics: Yes, include Umami
```

### After Project Creation

```bash
cd my-project
sf update
# Select modules to add
? Which modules to add:
  ❯ ◯ Email (MailerSend)
    ◯ Storage (S3)
    ◯ Analytics (Umami)
```

## Available Modules

### Email Module

**Provider:** MailerSend
**Affects:** API only

Features:
- ✅ Transactional emails (welcome, password reset, invites)
- ✅ Template support
- ✅ Multi-sender configuration
- ✅ Test mode for development

Setup:
```bash
sf update
# Select "Email (MailerSend)"
# Configure API key and sender email
```

See: [Email Module Guide](/modules/email)

### Storage Module

**Provider:** S3-compatible (AWS S3, MinIO, etc.)
**Affects:** API + Web

Features:
- ✅ File uploads (images, documents)
- ✅ Presigned URLs for secure access
- ✅ Organization-scoped buckets
- ✅ Local Docker setup for development

Setup:
```bash
sf update
# Select "Storage (S3)"
# Choose: Manual, Docker, or Credentials
```

See: [Storage Module Guide](/modules/storage)

### Analytics Module

**Provider:** Umami
**Affects:** Web only

Features:
- ✅ Privacy-focused analytics
- ✅ No cookies required
- ✅ GDPR compliant
- ✅ Self-hostable

Setup:
```bash
sf update
# Select "Analytics (Umami)"
# Configure website ID and URL
```

See: [Analytics Module Guide](/modules/analytics)

## How Modules Work

### Blueprint + Overlay Pattern

SaaSFoundry uses a two-layer approach:

1. **Blueprints** - Base project templates with TODO markers
2. **Overlays** - Module source code that activates markers

Example:

**Blueprint (before module):**
```typescript
// TODO mailer-service-active: import { EmailService } from './email.service'

export class AuthService {
  // TODO mailer-service-active: constructor(private emailService: EmailService) {}
}
```

**After installing Email module:**
```typescript
import { EmailService } from './email.service'

export class AuthService {
  constructor(private emailService: EmailService) {}
}
```

### Installer Process

When you add a module, the installer:

1. **Copies overlay files** - Module source code
2. **Uncomments TODO markers** - Activates module code
3. **Updates dependencies** - Adds npm packages
4. **Configures environment** - Updates `.env` files
5. **Updates manifest** - Records module in `.saasfoundry.json`

### Manifest Tracking

Installed modules are tracked in `.saasfoundry.json`:

```json
{
  "modules": {
    "emailService": "mailersend",
    "s3Setup": "docker",
    "includeAnalytics": true
  }
}
```

## Module Updates

SaaSFoundry can update module code when the CLI is upgraded:

```bash
sf update
# Detects version mismatch
# Offers to update module code
? Update Email module to latest version? Yes
```

The update system uses **three-way merge**:

1. **Base** - Original generated code (from manifest hash)
2. **Current** - Your modified code
3. **Target** - New template code

**Merge strategies:**
- ✅ **Auto-update** - File untouched, template changed
- ⚠️ **Conflict** - Both modified, saved as `.saasfoundry.new`
- ⏭️ **Skip** - File modified, template unchanged

## Adding Custom Modules

You can create custom modules by:

1. Creating overlay files in `scaffolds/overlays/modules/`
2. Creating installer in `src/installers/`
3. Adding TODO markers in blueprints
4. Updating types and prompts

See: [CLAUDE.md - Adding a New Module](/contributing/development#adding-modules)

## Best Practices

1. **Add modules early** - Easier to integrate before writing code
2. **Use Docker for development** - Storage and database
3. **Test in production mode** - Some modules behave differently
4. **Keep .env in sync** - Manual configuration may drift

## Next Steps

- [Email Module](/modules/email) - Detailed email setup
- [Storage Module](/modules/storage) - S3 configuration
- [Analytics Module](/modules/analytics) - Umami setup
