# SaaSFoundry

CLI tool that scaffolds production-ready SaaS projects (NestJS + React + PostgreSQL + Docker).

## Tech Stack

- **CLI**: Node.js, Commander, Inquirer, TypeScript
- **Generated Backend**: NestJS 11, Prisma 7 (driver adapters + PrismaPg), PostgreSQL 16, JWT + Passport, Zod 4
- **Generated Frontend**: React 19, React Router v7, Vite 7, TailwindCSS 4, Radix UI (unified), ShadCN UI, React Query, React Hook Form + Zod 4, i18next
- **Infra**: Docker multi-stage builds, Nginx, `saasfoundry-network`

## Project Structure

```
src/
├── commands/         # CLI commands (new.ts, update.ts, workflow.ts)
├── prompts/          # Inquirer prompt definitions (project.prompts.ts, update.prompts.ts, workflow.prompts.ts)
├── builders/         # Project scaffolding builders (api, web, monorepo, dev-services, db, s3)
├── installers/       # Reusable module installers (email, storage, analytics)
├── runners/          # Post-setup runners (database, s3, server, terminal)
├── types.ts          # All interfaces and path constants
├── utils.ts          # Utility functions
└── index.ts          # CLI entrypoint (Commander)
scaffolds/
├── blueprints/       # Base templates (api/, web/, db/, s3/)
└── overlays/         # Topology overrides + optional module overlays
    ├── monorepo/     # Monorepo-specific overrides (root/, api/, web/)
    ├── multirepo/    # Multirepo-specific overrides (api/, web/)
    └── modules/      # Optional feature modules (email/, storage/, analytics/)
bin/                  # CLI entrypoint (sf.js)
scripts/              # Version management (tag-manager.sh)
```

## CLI Commands

- `sf new` — Create a new SaaSFoundry project (src/commands/new.ts)
- `sf update` — Add modules to an existing project (src/commands/update.ts)
- `sf workflow` — Manage workflow configuration and AI rules (src/commands/workflow.ts)

### Dev Commands

- `npm run build` - Compile CLI
- `npm run dev` - Watch mode for CLI development
- `npm run format` - Prettier
- `npm run lint` - ESLint
- `npm run test:full` - Format + Lint + Type-check + Tests

### Generated API Commands

- `npm run dev` - NestJS watch mode
- `npm run test:unit` / `npm run test:e2e` - Tests
- `npm run test:full` - Format + Lint + Type-check + Tests
- `npm run db:update:dev` - Update dev database schema

### Generated Frontend Commands

- `npm run dev` - Vite dev server (port 5173)
- `npm run test:e2e` - Playwright tests
- `npm run test:full` - Format + Lint + Type-check + E2E

## Git Workflow

- Main branch: `master`
- **ALWAYS** use conventional commits: `<type>(#<ticket>): <description>`
- Types: feat, fix, docs, style, refactor, perf, test, chore, ci, build, revert
- Scope (ticket number) is required by commitlint
- Max header length: 100 characters
- Husky enforces commit format and pre-push checks
- RC branches (`rc-*`) trigger automated version management

## Code Conventions

### Backend (scaffolds/blueprints/api/)

- Module pattern: `module.ts`, `controller.ts`, `service.ts`, `dto/*.dto.ts`, `tests/unit/*.spec.ts`, `tests/e2e/*.spec.ts`
- Path aliases: `@modules/*`, `@common/*`, `@configs/*`, `@/*`
- Prisma multi-file schemas in `prisma/schema/`
- Validation with class-validator + class-transformer
- Logging with Winston (daily rotation)

### Frontend (scaffolds/blueprints/web/)

- Pages in `src/pages/private/` and `src/pages/public/`
- Lazy-loaded routes with code splitting
- API hooks in `src/hooks/api/`
- UI components in `src/components/ui/` (ShadCN)
- Translations in `src/locales/` (YAML format)
- Path alias: `@/*` → `./src/*`

## Docker

- Dev database: `docker-compose.db.yml` (port 5435, in-memory tmpfs)
- External network: `docker network create saasfoundry-network`
- API health check: `GET /api/health`

## Important Context

- This is a **scaffold/generator** CLI — the code in `scaffolds/` is template code, not application code
- **NEVER** modify scaffold templates without considering the impact on generated projects
- Current version: 1.0.0-beta (npm package `saasfoundry`)
- Node.js >= 20.19.0 required (Prisma 7 + Vite 7)

---

## Module Architecture (CRITICAL — Read when modifying SaaSFoundry)

SaaSFoundry uses a **module system** that allows features to be added during initial project generation (`sf new`) OR later via `sf update`. Understanding this architecture is essential when adding
new modules or modifying existing ones.

### How Modules Work

Each module follows the same pattern:

1. **Blueprint code** contains TODO markers (commented-out code) in `scaffolds/blueprints/`
2. **Overlay files** provide the module's source code in `scaffolds/overlays/modules/`
3. **Installers** (`src/installers/`) contain the logic to activate a module (copy overlays, uncomment markers, update env vars)
4. **Builders** (`src/builders/`) call installers during `sf new`
5. **Update command** (`src/commands/update.ts`) calls the same installers during `sf update`

### TODO Marker Pattern

Blueprint files use TODO markers to hold module-specific code in a disabled state:

```typescript
// In blueprint source files:
// TODO mailer-service-active: import { EmailService } from './email.service'
// TODO storage-service-active: import { StorageModule } from '@modules/storage/storage.module'
// TODO monitoring-active: import { initAnalytics } from '@/lib/analytics/analytics'
```

When a module is installed, the installer removes the `// TODO <marker>: ` prefix, activating the code:

```typescript
// After installation:
import { EmailService } from './email.service'
```

**Marker naming convention**: `// TODO <module-name>-active: `

### Current Modules

| Module               | Installer                               | Marker                   | Overlay Path                  | Affects   |
| -------------------- | --------------------------------------- | ------------------------ | ----------------------------- | --------- |
| **MailerSend Email** | `src/installers/email.installer.ts`     | `mailer-service-active`  | `overlays/modules/email/`     | API only  |
| **S3 Storage**       | `src/installers/storage.installer.ts`   | `storage-service-active` | `overlays/modules/storage/`   | API + Web |
| **Umami Analytics**  | `src/installers/analytics.installer.ts` | `monitoring-active`      | `overlays/modules/analytics/` | Web only  |

### Module Installer Responsibilities

Each installer in `src/installers/` is **fully self-contained** and handles:

1. **Copy overlay files** — Copy module source code from `scaffolds/overlays/modules/` to the target app
2. **Uncomment TODO markers** — Remove `// TODO <marker>: ` prefixes in blueprint files
3. **Update imports/providers** — Register the module in NestJS modules, update imports
4. **Add dependencies** — Modify `package.json` to add required npm packages
5. **Update .env files** — Uncomment and set environment variables in `.env` and `.env.test`
6. **Update CI/CD** — Modify GitHub Actions deployment files if needed

### Manifest (.saasfoundry.json)

Generated projects carry a `.saasfoundry.json` manifest at the project root:

```json
{
  "version": "1.0.0-beta",
  "generatedAt": "2026-03-22T...",
  "structure": "monorepo",
  "projectName": "my-project",
  "modules": {
    "emailService": "none",
    "s3Setup": "manual",
    "dbSetup": "docker",
    "includeAnalytics": false
  },
  "fileHashes": {
    "apps/api/package.json": "abc123...",
    "apps/api/src/main.ts": "def456...",
    "apps/web/src/main.tsx": "ghi789..."
  }
}
```

- **version**: SaaSFoundry CLI version used to generate the project
- **structure**: `monorepo` or `multirepo`
- **modules**: Records which modules are installed and their configuration
- **fileHashes**: SHA-256 hashes of all generated files (for three-way merge during updates)
- **No secrets are stored** — only module choices (none/mailersend, manual/docker/credentials, true/false)

The manifest is:

- Created during `sf new` (in `src/commands/new.ts`) with file hashes computed via `computeFileHashes()`
- Read and updated during `sf update` (in `src/commands/update.ts`)
- Defined by `SaaSFoundryManifest` interface in `src/types.ts`

### Template Update System (Three-Way Merge)

When a user runs `sf update` and their project version differs from the CLI version, the update command performs a **three-way file comparison**:

1. **Regenerate** the project in a temp directory using the current CLI with the same options from the manifest (side effects like npm install and git init are disabled)
2. **Compare** three versions of each file:
   - **Base**: Hash stored in manifest (what was originally generated)
   - **Current**: Hash of the user's current file
   - **Target**: Hash from the regenerated project (what the new CLI produces)
3. **Apply** changes based on the comparison:

| Base vs Current           | Base vs Target               | Action                                                      |
| ------------------------- | ---------------------------- | ----------------------------------------------------------- |
| Same (untouched)          | Different (template changed) | **Auto-update** — safe to replace                           |
| Different (user modified) | Same (template unchanged)    | **Skip** — user's changes are preserved                     |
| Different                 | Different                    | **Conflict** — save as `.saasfoundry.new` for manual review |
| Same                      | Same                         | **Skip** — nothing changed                                  |

**Files excluded from hash tracking** (in `src/utils.ts` → `HASH_IGNORE_PATTERNS`):

- `node_modules/`, `.git/`, `dist/`, `build/`, `.turbo/`, `coverage/`
- `.env`, `.env.test` (contain secrets)
- `package-lock.json`, `.saasfoundry.json`, `.DS_Store`

**Key implementation files:**

- `src/utils.ts` → `computeFileHashes()`, `hashFileContent()`
- `src/commands/update.ts` → `regenerateInTempDir()`, `computeFileUpdates()`, `applyFileUpdates()`

### Files Affected by Each Module

#### Email Module (MailerSend)

| File (in API app)                                             | Change                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------ |
| `src/modules/email/services/mailersend.service.ts`            | **Copied** from overlay                                |
| `src/modules/auth/services/auth.service.ts`                   | TODO markers uncommented                               |
| `src/modules/invitation/services/invitation.service.ts`       | TODO markers uncommented                               |
| `src/configs/env/services/env.service.ts`                     | TODO markers uncommented                               |
| `src/modules/email/services/email.service.ts`                 | All comments uncommented, console.logs removed         |
| `src/modules/email/email.module.ts`                           | MailerSendService import + provider added              |
| `src/modules/email/tests/unit/email.service.disabled-spec.ts` | Renamed to `.spec.ts`                                  |
| `.env`                                                        | `MAILERSEND_*` vars uncommented + set                  |
| `.env.test`                                                   | `MAILERSEND_*` vars uncommented + set with test values |
| `.github/workflows/deployment.yml`                            | `MAILERSEND_*` env vars added                          |

#### Storage Module (S3)

| File (in API app)                                                  | Change                                         |
| ------------------------------------------------------------------ | ---------------------------------------------- |
| `src/modules/storage/`                                             | **Copied** from overlay (entire directory)     |
| `src/configs/env/services/env.service.ts`                          | TODO markers uncommented                       |
| `src/app.module.ts`                                                | TODO markers uncommented                       |
| `src/modules/organizations/organizations.module.ts`                | TODO markers uncommented                       |
| `src/modules/organizations/controllers/organization.controller.ts` | TODO markers uncommented                       |
| `src/modules/organizations/services/organization.service.ts`       | TODO markers uncommented                       |
| `package.json`                                                     | `@aws-sdk/client-s3` + `@types/multer` added   |
| `.env`                                                             | `S3_*` vars uncommented + set                  |
| `.env.test`                                                        | `S3_*` vars uncommented + set with test values |

| File (in Web app) | Change                                 |
| ----------------- | -------------------------------------- |
| `.env`            | `VITE_STORAGE_ENABLED` set to `"true"` |

#### Analytics Module (Umami)

| File (in Web app)    | Change                                                         |
| -------------------- | -------------------------------------------------------------- |
| `src/lib/analytics/` | **Copied** from overlay                                        |
| `src/main.tsx`       | TODO markers uncommented (import + initAnalytics call)         |
| `.env`               | `VITE_ANALYTICS_URL` + `VITE_ANALYTICS_WEBSITE_ID` uncommented |

### Adding a New Module — Checklist

When adding a new optional module to SaaSFoundry, follow these steps:

1. **Create overlay files** in `scaffolds/overlays/modules/<module-name>/`

   - These are the module's source files that get copied to the target app

2. **Add TODO markers** in blueprint files (`scaffolds/blueprints/api/` or `web/`)

   - Use pattern: `// TODO <module-name>-active: <code>`
   - Add markers for imports, function calls, module registrations

3. **Add env vars** (commented out) in blueprint `.env` and `.env.test` files

   - Pattern: `# VAR_NAME="default_value"`

4. **Create installer** in `src/installers/<module-name>.installer.ts`

   - Export a single `install<ModuleName>Module(params)` function
   - Handle: copy overlays, uncomment markers, update env files, add dependencies
   - Must be fully self-contained (callable from both `sf new` and `sf update`)

5. **Update types** in `src/types.ts`

   - Add module option to `Answers` interface
   - Add module option to relevant `Create*Params` interface
   - Add module field to `SaaSFoundryManifest.modules`

6. **Update prompts** in `src/prompts/project.prompts.ts`

   - Add prompt for the new module during `sf new`

7. **Call installer from builder** in `src/builders/api.builder.ts` or `web.builder.ts`

   - Conditionally call the installer based on user's choice

8. **Update `sf new` command** in `src/commands/new.ts`

   - Pass the new option to the builder
   - Include in manifest generation

9. **Update `sf update` support**

   - Add module detection in `src/prompts/update.prompts.ts` → `getAvailableModules()`
   - Add credential prompt function if the module needs configuration
   - Add installation block in `src/commands/update.ts`

10. **Update this CLAUDE.md**
    - Add module to "Current Modules" table
    - Add "Files Affected" section for the new module

---

## Skills Architecture (CRITICAL — Read when adding/modifying Skills)

SaaSFoundry integrates **Claude Code skills** into generated projects. All skills are prefixed with `sf-` to avoid conflicts with users' global skills.

### Skill Types & Classification

| Type                            | Location           | Credentials | Multi-Account | Examples                                                   |
| ------------------------------- | ------------------ | ----------- | ------------- | ---------------------------------------------------------- |
| **Core Skills**                 | `skills/`          | ❌ No       | ❌ No         | `sf-git-commit`, `sf-utils-fix-errors`, `sf-workflow-apex` |
| **Tool Skills (Public API)**    | `skills-optional/` | ❌ No       | ❌ No         | `sf-tool-context7`                                         |
| **Tool Skills (Auth Required)** | `skills-optional/` | ✅ Yes      | ✅ Yes        | `sf-tool-atlassian`, `sf-tool-notion`, `sf-tool-figma`     |

### Architecture Patterns

#### 1. Multirepo Structure

```
scaffolds/blueprints/api/.claude/
├── skills/              # 9 core skills (git, utils, workflow)
└── skills-optional/     # 4 tool skills (context7, atlassian, notion, figma)

scaffolds/blueprints/web/.claude/
├── skills/              # 9 core skills (same as API)
└── skills-optional/     # 4 tool skills (same as API)
```

#### 2. Monorepo Structure (Centralized)

```
scaffolds/overlays/monorepo/root/.claude/
├── skills/              # 9 core skills (shared by API + Web)
└── skills-optional/     # 4 tool skills (shared by API + Web)
```

**Important**: Monorepo uses centralized skills at the root to avoid duplication between apps/api and apps/web.

### Current Skills Inventory

#### Core Skills (9 total)

- `sf-git-commit` - Quick commit and push
- `sf-git-create-pr` - Create pull requests
- `sf-git-fix-pr-comments` - Implement PR feedback
- `sf-git-merge` - Intelligent branch merging
- `sf-utils-fix-errors` - Fix ESLint/TypeScript errors
- `sf-utils-fix-grammar` - Fix spelling/grammar
- `sf-utils-oneshot` - Ultra-fast feature implementation
- `sf-workflow-apex` - APEX methodology (with adversarial review)
- `sf-workflow-apex-free` - APEX methodology (without adversarial review)

#### Tool Skills (4 total)

- `sf-tool-context7` - Library documentation (free public API, no credentials)
- `sf-tool-atlassian` - Jira/Confluence integration (requires credentials)
- `sf-tool-notion` - Notion workspace integration (requires credentials)
- `sf-tool-figma` - Figma design system integration (requires credentials)

### Multi-Account Credential System

**Only applies to Tool Skills with authentication** (atlassian, notion, figma).

#### Architecture

- **Centralized storage**: `~/.claude/credentials/{tool}/{account}.env`
- **Project configuration**: `.saasfoundry.json` → `skillsAccounts: { tool: "account" }`
- **CLI management**: `sf tools` command (list, accounts, add, use, current)

#### Credential Loading (in CLI scripts)

Each tool skill's CLI script (`{tool}-cli.sh`) loads credentials in this order:

1. Check if in a SaaSFoundry project (`.saasfoundry.json` exists)
2. Read configured account from manifest → `skillsAccounts.{tool}`
3. Load from `~/.claude/credentials/{tool}/{account}.env`
4. Fallback to local `.env` file in skill directory
5. Error if no credentials found

#### Files Involved in Multi-Account System

| File                                                                            | Purpose                            | When to Modify                                        |
| ------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------- |
| `src/commands/tools.ts`                                                         | CLI command implementation         | Adding new tool with credentials                      |
| `src/prompts/skills.prompts.ts`                                                 | Credential collection prompts      | Adding new tool with credentials                      |
| `src/prompts/update.prompts.ts`                                                 | Update command credential flow     | Adding new tool with credentials                      |
| `src/types.ts` → `SaaSFoundryManifest.skillsAccounts`                           | Manifest type definition           | Adding new tool with credentials                      |
| `scaffolds/blueprints/api/.claude/skills-optional/sf-tool-{name}/{name}-cli.sh` | CLI script with credential loading | Adding new tool OR modifying credential loading logic |
| `scaffolds/blueprints/web/.claude/skills-optional/sf-tool-{name}/{name}-cli.sh` | Same as API (keep in sync)         | Same as API                                           |

### Skill Installation System

Skills are installed via `src/installers/skills.installer.ts`:

```typescript
export async function installSkills({
  isMonorepo,
  apiPath,
  webPath,
  selectedSkills,
  credentials
}) {
  if (isMonorepo) {
    // Install once at root (centralized)
    await installSkillsAtRoot({ ... })
  } else {
    // Install separately for API and Web
    await installSkillsForApp({ appPath: apiPath, ... })
    await installSkillsForApp({ appPath: webPath, ... })
  }
}
```

**Key points**:

- Core skills are ALWAYS installed
- Tool skills are OPTIONAL (user selects during `sf new` or `sf update`)
- Credentials are stored in skill's `.env` file during `sf new`
- Users can later switch accounts via `sf tools use`

### Adding a New Core Skill — Checklist

**Core skills** = methodology/utility skills with no external dependencies (e.g., git workflows, code quality, APEX)

1. **Create skill directory** in `scaffolds/blueprints/api/.claude/skills/sf-{skill-name}/`

   - `SKILL.md` - Skill documentation and instructions
   - Any supporting scripts/files

2. **Duplicate to Web blueprint** in `scaffolds/blueprints/web/.claude/skills/sf-{skill-name}/`

   - Identical structure (keep API and Web in sync)

3. **Add to monorepo overlay** in `scaffolds/overlays/monorepo/root/.claude/skills/sf-{skill-name}/`

   - Identical structure (for centralized monorepo)

4. **Update README.md**

   - Add skill to "Skills System" section
   - Document skill usage

5. **Update blueprint CLAUDE.md files**

   - Add skill to "Available Skills" section in both API and Web blueprints
   - Update skills priority section if needed

6. **Test**
   - Generate a multirepo project → verify skill in both api/.claude/ and web/.claude/
   - Generate a monorepo project → verify skill in root/.claude/
   - Test skill invocation in generated project

### Adding a New Tool Skill (Public API) — Checklist

**Tool skills with public API** = no credentials required (e.g., context7)

1. **Create skill directory** in `scaffolds/blueprints/api/.claude/skills-optional/sf-tool-{name}/`

   - `SKILL.md` - Skill documentation
   - `{name}-cli.sh` - CLI script (no credential loading needed)
   - `.env.example` - Empty or info message (no credentials needed)

2. **Duplicate to Web blueprint**

3. **Add to monorepo overlay**

4. **Update skill prompts** in `src/prompts/skills.prompts.ts`

   - Add to `promptAdvancedSkills()` choices
   - Add label `[free, no credentials]`
   - Create `prompt{Name}Credentials()` that returns empty object with info message

5. **Update update prompts** in `src/prompts/update.prompts.ts`

   - Add to skill descriptions in `getAvailableModules()`
   - Add label `[free, no credentials]`
   - Add case in `getSkillCredentials()` to return empty object

6. **Update skills installer** in `src/installers/skills.installer.ts`

   - Add skill to detection/installation logic if needed

7. **Update documentation**

   - README.md
   - Blueprint CLAUDE.md files

8. **Test**
   - Generate project with skill → verify no credentials prompted
   - Test CLI script works without `.env` file

### Adding a New Tool Skill (Auth Required) — Checklist

**Tool skills with authentication** = requires API tokens/credentials (e.g., atlassian, notion, figma)

1. **Create skill directory** in `scaffolds/blueprints/api/.claude/skills-optional/sf-tool-{name}/`

   - `SKILL.md` - Skill documentation
   - `{name}-cli.sh` - CLI script with multi-account credential loading
   - `.env.example` - Example credentials format

2. **Implement multi-account credential loading** in `{name}-cli.sh`

   ```bash
   load_credentials() {
     local TOOL_NAME="{name}"
     local CREDENTIALS_DIR="$HOME/.claude/credentials/$TOOL_NAME"
     local MANIFEST_PATH=".saasfoundry.json"

     # Check for project-level account configuration
     if [[ -f "$MANIFEST_PATH" ]]; then
       ACCOUNT_NAME=$(python3 -c "...")
       if [[ -n "$ACCOUNT_NAME" ]]; then
         CREDENTIALS_FILE="$CREDENTIALS_DIR/$ACCOUNT_NAME.env"
         if [[ -f "$CREDENTIALS_FILE" ]]; then
           source "$CREDENTIALS_FILE"
           return
         fi
       fi
     fi

     # Fallback to local .env
     if [[ -f "$SCRIPT_DIR/.env" ]]; then
       source "$SCRIPT_DIR/.env"
     else
       echo "Error: No credentials found. Run: sf tools add {name} <account>" >&2
       exit 1
     fi
   }

   load_credentials
   ```

3. **Duplicate to Web blueprint** (keep CLI scripts in sync)

4. **Add to monorepo overlay**

5. **Add to tools command** in `src/commands/tools.ts`

   - Add `'{name}'` to `validTools` array in `addAccount()`
   - Add case in credential prompting switch
   - Tool will automatically appear in `sf tools list`

6. **Create credential prompt** in `src/prompts/skills.prompts.ts`

   - Create `prompt{Name}Credentials()` function
   - Opens browser to API token page
   - Prompts for all required credentials
   - Returns credential object

7. **Update skill selection prompts** in `src/prompts/skills.prompts.ts`

   - Add to `promptAdvancedSkills()` choices
   - Use clear description (no `[free]` label)

8. **Update update prompts** in `src/prompts/update.prompts.ts`

   - Add to skill descriptions in `getAvailableModules()`
   - Add case in `getSkillCredentials()` to call prompt function

9. **Update types** in `src/types.ts`

   - Add credential fields to `AdvancedSkillCredentials` interface
   - Example:
     ```typescript
     export interface AdvancedSkillCredentials {
       // ... existing
       {name}ApiToken?: string
       {name}OtherField?: string
     }
     ```

10. **Update skills installer** in `src/installers/skills.installer.ts`

    - Add credential writing logic for the new tool
    - Update `.env` file generation

11. **Update documentation**

    - README.md
    - Blueprint CLAUDE.md files
    - This CLAUDE.md (add to Current Skills Inventory)

12. **Test complete workflow**
    - `sf new` → select skill → verify credentials prompted
    - `sf update` → add skill → verify credentials prompted
    - `sf tools add {name} account1` → verify credentials prompted and saved
    - `sf tools use {name} account1` → verify manifest updated
    - Test CLI script reads from centralized credentials
    - Test CLI script falls back to local `.env`

### Modifying Existing Skills

#### When modifying a Core Skill:

1. Update in `scaffolds/blueprints/api/.claude/skills/`
2. Apply same changes to `scaffolds/blueprints/web/.claude/skills/`
3. Apply same changes to `scaffolds/overlays/monorepo/root/.claude/skills/`
4. Update documentation if behavior changed

#### When modifying a Tool Skill:

1. Update in `scaffolds/blueprints/api/.claude/skills-optional/`
2. Apply same changes to `scaffolds/blueprints/web/.claude/skills-optional/`
3. Apply same changes to `scaffolds/overlays/monorepo/root/.claude/skills-optional/`
4. If credential structure changed → update prompts and types
5. If CLI script changed → ensure credential loading logic stays consistent
6. Update documentation

### Important Considerations

**DO**:

- ✅ Always prefix skills with `sf-` to avoid global conflicts
- ✅ Keep API, Web, and Monorepo skills in sync
- ✅ Test both multirepo and monorepo generation
- ✅ Use multi-account system for tools requiring credentials
- ✅ Provide helpful error messages in CLI scripts
- ✅ Document skill purpose and usage in SKILL.md

**DON'T**:

- ❌ Never create skills without `sf-` prefix
- ❌ Don't add tools to multi-account system if they use public APIs
- ❌ Don't modify credential loading pattern without updating all tools
- ❌ Don't forget to update monorepo overlay when changing skills
- ❌ Don't hardcode credentials in skill files
- ❌ Don't ask for credentials for public/free APIs (like context7)

### Skills Priority in Generated Projects

Generated projects have this note in their CLAUDE.md:

```markdown
## 🎯 Skills Priority

**IMPORTANT**: Always prefer SaaSFoundry skills (prefix `sf-*`):

- ✅ Use `sf-git-commit` instead of `git-commit`
- ✅ Use `sf-utils-fix-errors` instead of `utils-fix-errors`
```

This ensures Claude uses project-specific skills over global ones when there are conflicts.
