/**
 * Single source of truth for the SaaSFoundry module catalogue.
 *
 * Consumed by:
 * - `sf modules list|info|match` (direct)
 * - `sf update` via `getAvailableModules()` in `prompts/update.prompts.ts`
 * - The `tool-saasfoundry` Claude Code skill (via `--json` output)
 */

export type ModuleCategory = 'module' | 'skill' | 'structural'

export interface ModuleDefinition {
  /** Stable machine identifier used by `--add-modules` and `sf modules info`. */
  name: string
  /** Human-friendly display name (for tables, prompts). */
  displayName: string
  /** One-sentence description shown in prompts and `sf modules list`. */
  description: string
  /** `module` (addable via sf update), `skill` (advanced Claude skill), `structural` (baked into sf new). */
  category: ModuleCategory
  /** Keywords for intent matching (lower-case, single words preferred). */
  keywords: string[]
  /** What this module gives the generated project (services, UI, tables, …). */
  provides: string[]
  /** What users might otherwise custom-build — feeds the anti-reinvention guardrail. */
  alternatives: string[]
  /** First CLI version that shipped this module. */
  introducedInVersion: string
  /** Minimum CLI version required to install it. */
  minCliVersion: string
  /** Paths touched when installed — for dry-run previews. */
  filesAffected: string[]
  /** npm dependencies added to the generated project. */
  dependencies: string[]
  /** Set to `'scaffold'` when the module can only be chosen at `sf new` time. */
  installOnly?: 'scaffold'
}

export const CATALOGUE: ModuleDefinition[] = [
  {
    name: 'email',
    displayName: 'MailerSend Email Service',
    description: 'Transactional emails (account creation, password reset, invitations) via MailerSend [free, 3000 emails/month]',
    category: 'module',
    keywords: ['email', 'mail', 'smtp', 'transactional', 'mailersend', 'notifications', 'invitations', 'password-reset'],
    provides: ['MailerSendService (NestJS)', 'Auth/invitation email flows', 'Test credentials in .env.test'],
    alternatives: ['Nodemailer', 'SendGrid', 'AWS SES', 'Postmark', 'Resend', 'custom SMTP integration'],
    introducedInVersion: '1.0.0-beta',
    minCliVersion: '1.0.0-beta',
    filesAffected: [
      'apps/api/src/modules/email/services/mailersend.service.ts',
      'apps/api/src/modules/email/email.module.ts',
      'apps/api/src/modules/auth/services/auth.service.ts',
      'apps/api/src/modules/invitation/services/invitation.service.ts',
      'apps/api/src/configs/env/services/env.service.ts',
      'apps/api/.env',
      'apps/api/.env.test',
      'apps/api/deployment.yml'
    ],
    dependencies: ['mailersend']
  },
  {
    name: 'storage',
    displayName: 'S3 Object Storage',
    description: 'File uploads (logos, documents) with S3-compatible storage (MinIO via Docker or existing server)',
    category: 'module',
    keywords: ['storage', 's3', 'files', 'upload', 'uploads', 'minio', 'object-storage', 'cdn', 'blob'],
    provides: ['StorageModule (NestJS)', 'Multer file-upload middleware', 'Org logo upload endpoint', 'MinIO docker-compose service (optional)'],
    alternatives: ['custom S3 wrapper', 'Cloudinary', 'local filesystem storage', 'Firebase Storage', 'Supabase Storage'],
    introducedInVersion: '1.0.0-beta',
    minCliVersion: '1.0.0-beta',
    filesAffected: [
      'apps/api/src/modules/storage/',
      'apps/api/src/modules/org/',
      'apps/api/src/configs/env/services/env.service.ts',
      'apps/api/src/app.module.ts',
      'apps/api/.env',
      'apps/api/.env.test',
      'apps/web/.env',
      'docker-compose.dev-services.yml'
    ],
    dependencies: ['@aws-sdk/client-s3', '@types/multer']
  },
  {
    name: 'analytics',
    displayName: 'Umami Analytics',
    description: 'Privacy-friendly anonymous user analytics (self-hosted, production only)',
    category: 'module',
    keywords: ['analytics', 'umami', 'tracking', 'metrics', 'privacy', 'stats', 'observability'],
    provides: ['Umami tracking script loader', 'Production-only initialization', 'VITE_ANALYTICS_* env vars'],
    alternatives: ['Google Analytics', 'Plausible', 'PostHog', 'Fathom', 'Matomo', 'custom tracking'],
    introducedInVersion: '1.0.0-beta',
    minCliVersion: '1.0.0-beta',
    filesAffected: ['apps/web/src/lib/analytics/', 'apps/web/src/main.tsx', 'apps/web/.env'],
    dependencies: []
  },
  {
    name: 'sf-skill-context7',
    displayName: 'Advanced Skill: Context7',
    description: 'Up-to-date library documentation (React, Vite, Prisma, etc.) [free, no credentials]',
    category: 'skill',
    keywords: ['context7', 'documentation', 'docs', 'libraries', 'reference', 'api-docs'],
    provides: ['Claude Code skill: tool-context7', 'Library documentation lookup via MCP'],
    alternatives: ['manual docs browsing', 'stale training data', 'devdocs.io'],
    introducedInVersion: '1.0.0-beta',
    minCliVersion: '1.0.0-beta',
    filesAffected: ['.claude/skills/tool-context7/', '.mcp.json'],
    dependencies: []
  },
  {
    name: 'sf-skill-atlassian',
    displayName: 'Advanced Skill: Atlassian',
    description: 'Jira/Confluence integration (tickets, wiki, sprints)',
    category: 'skill',
    keywords: ['atlassian', 'jira', 'confluence', 'tickets', 'issues', 'wiki', 'sprints', 'agile'],
    provides: ['Claude Code skill: tool-atlassian', 'Jira ticket queries & edits', 'Confluence page reads & writes'],
    alternatives: ['Jira REST API directly', 'manual ticket updates', 'jira-cli'],
    introducedInVersion: '1.0.0-beta',
    minCliVersion: '1.0.0-beta',
    filesAffected: ['.claude/skills/tool-atlassian/', '.mcp.json', '~/.claude/credentials/atlassian/'],
    dependencies: []
  },
  {
    name: 'sf-skill-notion',
    displayName: 'Advanced Skill: Notion',
    description: 'Notion workspace integration (pages, databases, views)',
    category: 'skill',
    keywords: ['notion', 'pages', 'databases', 'views', 'workspace', 'docs', 'wiki'],
    provides: ['Claude Code skill: tool-notion', 'Notion page/database CRUD', 'View management'],
    alternatives: ['Notion REST API directly', 'manual Notion UI'],
    introducedInVersion: '1.0.0-beta',
    minCliVersion: '1.0.0-beta',
    filesAffected: ['.claude/skills/tool-notion/', '.mcp.json', '~/.claude/credentials/notion/'],
    dependencies: []
  },
  {
    name: 'sf-skill-figma',
    displayName: 'Advanced Skill: Figma',
    description: 'Figma design system integration (designs, components)',
    category: 'skill',
    keywords: ['figma', 'design', 'design-system', 'components', 'ui', 'ux', 'mockups'],
    provides: ['Claude Code skill: tool-figma', 'Design context extraction', 'Code Connect mappings'],
    alternatives: ['Figma REST API directly', 'manual design-to-code translation'],
    introducedInVersion: '1.0.0-beta',
    minCliVersion: '1.0.0-beta',
    filesAffected: ['.claude/skills/tool-figma/', '.mcp.json', '~/.claude/credentials/figma/'],
    dependencies: []
  },
  {
    name: 'srs',
    displayName: 'SRS Centralisation (Notion)',
    description: 'Centralise Software Requirements Specifications in Notion — bootstraps a project root page where Epics are created as direct children (V1: Notion only)',
    category: 'module',
    keywords: ['srs', 'specifications', 'requirements', 'notion', 'docs', 'spec', 'user-flows', 'product'],
    provides: ['sf-srs Claude Code skill', 'Notion root page for the project SRS', '.saasfoundry.json → tools.srs config'],
    alternatives: ['manual Notion workspace curation', 'Confluence', 'local markdown under docs/'],
    introducedInVersion: '1.0.0-beta',
    minCliVersion: '1.0.0-beta',
    filesAffected: ['.claude/skills/sf-srs/', '.saasfoundry.json'],
    dependencies: []
  },
  {
    name: 'auth',
    displayName: 'Authentication & Authorization',
    description: 'JWT auth with email/password, roles, permissions, sessions, and invitation flow (shipped with sf new)',
    category: 'structural',
    keywords: ['auth', 'authentication', 'authorization', 'jwt', 'login', 'signup', 'roles', 'permissions', 'session'],
    provides: ['AuthModule (NestJS)', 'JWT + Passport strategies', 'Role/permission guards', 'Invitation flow', 'Login/signup UI pages'],
    alternatives: ['Auth0', 'Clerk', 'Supabase Auth', 'Firebase Auth', 'NextAuth.js', 'custom JWT'],
    introducedInVersion: '1.0.0-beta',
    minCliVersion: '1.0.0-beta',
    filesAffected: ['apps/api/src/modules/auth/', 'apps/web/src/pages/public/login*', 'apps/web/src/pages/public/sign-up*'],
    dependencies: ['@nestjs/passport', '@nestjs/jwt', 'passport', 'passport-jwt', 'bcrypt'],
    installOnly: 'scaffold'
  },
  {
    name: 'i18n',
    displayName: 'Internationalization',
    description: 'Multi-language support via i18next (YAML translations, language switcher) (shipped with sf new)',
    category: 'structural',
    keywords: ['i18n', 'internationalization', 'translations', 'locales', 'languages', 'i18next', 'l10n'],
    provides: ['i18next setup', 'YAML translation files', 'Language switcher component', 'Locale-aware routing'],
    alternatives: ['react-intl', 'lingui', 'custom translation map'],
    introducedInVersion: '1.0.0-beta',
    minCliVersion: '1.0.0-beta',
    filesAffected: ['apps/web/src/locales/', 'apps/web/src/i18n.ts', 'apps/web/src/components/language-switcher/'],
    dependencies: ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
    installOnly: 'scaffold'
  },
  {
    name: 'workflow-system',
    displayName: 'Workflow System (AI-driven)',
    description: 'Dogfooded Backlog → Ready → In Progress → AI Testing → Human Testing → In Review → Done workflow with GitHub Projects integration (shipped with sf new)',
    category: 'structural',
    keywords: ['workflow', 'ai', 'claude', 'github-projects', 'status', 'skill', 'tickets', 'agile'],
    provides: ['.claude/skills/sf-workflow/', '.claude/skills/sf-tool-github-projects/', 'Status transition helpers', 'Subtask creation CLI'],
    alternatives: ['raw GitHub Issues', 'Linear', 'Jira (with sf-skill-atlassian)', 'custom workflow tooling'],
    introducedInVersion: '1.0.0-beta',
    minCliVersion: '1.0.0-beta',
    filesAffected: ['.claude/skills/sf-workflow/', '.claude/skills/sf-tool-github-projects/', '.saasfoundry.json'],
    dependencies: [],
    installOnly: 'scaffold'
  }
]

/**
 * Look up a single module by its machine name.
 */
export function getModuleByName(name: string): ModuleDefinition | undefined {
  return CATALOGUE.find((m) => m.name === name)
}

/**
 * All module names — useful for validating `--add-modules` input.
 */
export function getAllModuleNames(): string[] {
  return CATALOGUE.map((m) => m.name)
}
