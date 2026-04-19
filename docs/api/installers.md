# Installers

**Installers** are the optional module wiring. Where a [builder](/api/builders) copies a blueprint, an installer reaches into the already-copied files and flips a feature from `dormant` to `active` — uncommenting markers, patching imports, writing credentials, registering providers.

All installers live in `src/installers/`. They are called from `src/commands/new.ts` (fresh projects) and `src/commands/update.ts` (existing projects gaining a new module).

## Why the marker pattern

Every optional module lands in the blueprint in a "dormant" state: the code that would call `MailerSendService.sendEmail()`, `S3Client.putObject()`, or `Umami.track()` is present but commented out with a well-known marker like `// TODO mailer-service-active:`.

The installer's job is to **remove the markers**. That makes installation idempotent, greppable, and trivially reversible — anyone can see at a glance which optional features a generated project has enabled by grepping for live code paths vs marker comments.

---

## Module installers

### `installEmailModule`

```typescript
async function installEmailModule(params: InstallEmailModuleParams): Promise<void>
```

Wires MailerSend into the API app's auth / invitation / env flows.

**What it does:**

- Copies `overlays/modules/email/services/mailersend.service.ts` to `apps/api/src/modules/email/services/`
- Uncomments `// TODO mailer-service-active:` markers across `auth.service.ts`, `invitation.service.ts`, `env.service.ts`, `email.service.ts`
- Registers `MailerSendService` as a provider in `email.module.ts`
- Renames `email.service.disabled-spec.ts` → `email.service.spec.ts` (re-enabling the E2E test)
- Writes `MAILERSEND_API_KEY`, `MAILERSEND_SENDER_EMAIL`, `MAILERSEND_SENDER_NAME` into `apps/api/.env`, `.env.test` (fake test key), and `.github/workflows/deployment.yml`

See [Email Module](/modules/email) for the full feature walkthrough.

### `installStorageModule`

```typescript
async function installStorageModule(params: InstallStorageModuleParams): Promise<void>
```

Enables AWS S3 storage on both the API and Web apps.

**What it does:**

- Copies `overlays/modules/storage/` into `apps/api/src/modules/storage/`
- Adds `@aws-sdk/client-s3` and `@types/multer` to the API's `package.json` (and runs `npm install` unless inside a monorepo — monorepo installs happen once at the root)
- Uncomments `// TODO storage-service-active:` markers in `env.service.ts`, `app.module.ts`, `org.module.ts`, `org.controller.ts`, `org.service.ts`
- Writes `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION` into API `.env` / `.env.test`
- Flips `VITE_STORAGE_ENABLED=true` in the Web `.env`

See [Storage Module](/modules/storage) for the walkthrough.

### `installAnalyticsModule`

```typescript
async function installAnalyticsModule(params: InstallAnalyticsModuleParams): Promise<void>
```

Enables Umami analytics in the Web app.

**What it does:**

- Copies `overlays/modules/analytics/` to `apps/web/src/lib/analytics/`
- Uncomments `// TODO monitoring-active:` markers in `main.tsx`
- Uncomments `VITE_ANALYTICS_URL` and `VITE_ANALYTICS_WEBSITE_ID` in the Web `.env`

See [Analytics Module](/modules/analytics) for the walkthrough.

---

## Skill installers

Skills do not participate in the marker pattern — they are self-contained files under `.claude/skills/`. The installers copy them in and do light placeholder substitution.

### `installCoreSkills`

```typescript
async function installCoreSkills(params: InstallSkillsParams): Promise<void>
```

Always installed. Copies the seven core skills from `scaffolds/skills-templates/core/` to `.claude/skills/`:

- `sf-git-commit`, `sf-git-create-pr`, `sf-git-fix-pr-comments`, `sf-git-merge`
- `sf-utils-fix-errors`, `sf-utils-fix-grammar`
- (the workflow skill is installed separately — see `installWorkflowSkill`)

For **multirepo** projects the copy happens in both `apps/api/.claude/skills/` and `apps/web/.claude/skills/`. For **monorepo** projects a single copy lives at the root `.claude/skills/`.

### `installOptionalSkills`

```typescript
async function installOptionalSkills(params: InstallSkillsParams): Promise<void>
```

Copies **only** the skills listed in `answers.advancedSkills` from `scaffolds/skills-templates/optional/`. Current optional skills:

- `sf-tool-context7` (public API, no credentials)
- `sf-tool-atlassian` (authenticated)
- `sf-tool-notion` (authenticated)
- `sf-tool-figma` (authenticated)

Skips silently when the list is empty. Placement is the same as `installCoreSkills` (per-app in multirepo, root in monorepo).

### `installToolSkill`

```typescript
async function installToolSkill(params: InstallToolSkillParams): Promise<void>
```

Used for **workflow-tool** skills — the skill `sf-workflow` uses to talk to your board. Copies the template from `scaffolds/skills-templates/tools/<tool>/` to `.claude/skills/sf-tool-<tool>/` and, if credentials are provided, writes them to `~/.claude/credentials/<tool>/<account>.env` (not to the skill directory itself — see [Tool Skills](/skills/tool-skills) for the multi-account model).

Only `tool: 'github-projects'` ships today. The Jira, Notion, Linear and ClickUp adapters follow the same shape; see the [roadmap](https://github.com/AGachet/SaaSFoundry/issues).

### `installWorkflowSkill`

```typescript
async function installWorkflowSkill(params: InstallWorkflowSkillParams): Promise<void>
```

Installs the orchestration `sf-workflow` skill.

**What it does:**

- Copies `scaffolds/skills-templates/workflow/` to `.claude/skills/sf-workflow/`
- Substitutes `{{WORKFLOW_NAME}}`, `{{TOOL}}`, `{{STATUSES_LIST}}` in the skill's `SKILL.md` from `answers.workflow`
- Injects a workflow section into the generated `CLAUDE.md`, between `## Git Workflow` and `## Development Commands` (or appended if the markers are absent)

### `installSkills`

```typescript
async function installSkills(params: InstallSkillsParams): Promise<void>
```

Convenience orchestrator: calls `installCoreSkills` + `installOptionalSkills`, then substitutes `{{PROJECT_NAME}}` and `{{VERSION}}` inside each `CLAUDE.md`. Used by `new.ts` so the two skill installers run in a known order with consistent post-processing.

---

## Shared conventions

Match these patterns if you add a new installer:

- **Idempotency**: re-running an installer must be safe. The regex-based uncomment pattern (`replace(/^\/\/ TODO marker: /gm, '')`) is idempotent because already-uncommented lines don't match the regex.
- **Marker naming**: `// TODO <short-feature>-active:` — one marker prefix per module. Makes the blueprint greppable.
- **`.env` writes**: always write to all three files — `.env`, `.env.test` (with a deterministic fake key so tests stay offline), and `.github/workflows/deployment.yml` (as a GitHub Actions secret reference). Missing one breaks CI or E2E later.
- **Monorepo awareness**: read `params.isMonorepo` to decide whether to operate per-app or at the root. Most installers flip just one path; skill installers flip placement.
- **No npm install in monorepo mode**: if the root workspace is going to `npm install` at the end, adding a dep from a sub-package is enough. Only multirepo installers run `npm install` themselves.

## Next steps

- [Builders](/api/builders) — the phase before installers.
- [Runners](/api/runners) — the phase after installers (Docker up, dev servers).
- [Module System](/guide/module-system) — conceptual overview of how installers compose.
