# Types

Reference for the public TypeScript types exposed by the SaaSFoundry CLI source. All types live in `src/types.ts` and are the single source of truth for every command, builder, installer, and runner.

If you are writing a custom module installer or a new builder, start here — these are the shapes you will accept as input and the shapes the rest of the CLI expects.

## Credentials

Small, reusable bags of credentials passed around between the project prompts, builders, and dev-services generator.

```typescript
interface DbCredentials {
  host: string
  port: string
  user: string
  password: string
  database: string
  dbType: 'postgresql' | 'sql'
}

interface S3Credentials {
  endpoint: string
  accessKey: string
  secretKey: string
  bucket: string
  region: string
}
```

These are collected by `src/prompts/project.prompts.ts`, passed to the API/Web/DB/S3 builders, and end up in the generated `.env` files.

## Top-level answers

`Answers` is the complete result of `sf new`'s interactive prompts — the single struct that drives the whole scaffolding pipeline.

```typescript
interface Answers {
  // Project identity
  projectName: string
  projectDescription: string
  isMonorepo: boolean
  setupRepo: 'local' | 'create' | 'existing'
  gitProvider?: 'GitHub' | 'GitLab'
  mainBranch: 'main' | 'master'
  monorepoUrl?: string
  backendRepoUrl: string
  frontendRepoUrl?: string

  // Database
  dbSetup: 'docker' | 'credentials' | 'manual'
  dbCredentials?: DbCredentials
  initDb: boolean

  // Email module
  emailService: 'none' | 'mailersend'
  mailersendApiKey?: string
  mailersendSenderEmail?: string
  mailersendSenderName?: string

  // Storage module
  s3Setup: 'docker' | 'credentials' | 'manual'
  s3Credentials?: S3Credentials

  // Analytics
  includeAnalytics: boolean

  // Optional tool skills
  advancedSkills?: string[]
  context7ApiKey?: string
  atlassianEmail?: string
  atlassianApiToken?: string
  atlassianSite?: string
  atlassianCloudId?: string
  notionApiToken?: string
  notionApiVersion?: string
  figmaApiToken?: string

  // Workflow
  workflow?: WorkflowConfig
  aiRules?: AIRules
}
```

Anything marked optional can be omitted when the user chooses not to configure that area. Builders guard on the flag (e.g. `emailService === 'mailersend'` before reading `mailersendApiKey`), never on
the presence of the credential alone.

## Builder parameter types

Each builder takes a narrow subset of `Answers`. These exist so a builder can be called in isolation (tests, programmatic use) without having to fake the whole `Answers` object:

```typescript
interface CreateApiAppParams {
  /* subset of Answers focused on backend scaffolding */
}
interface CreateWebAppParams {
  /* subset of Answers focused on frontend scaffolding */
}
interface CreateDbAppParams {
  isMonorepo: boolean
  projectName: string
  dbCredentials?: DbCredentials
}
interface CreateS3AppParams {
  isMonorepo: boolean
  projectName: string
  s3Credentials?: S3Credentials
}
interface CreateMonorepoRootParams {
  projectName: string
  projectDescription: string
  monorepoUrl?: string
  mainBranch: string
  workflow?: WorkflowConfig
  aiRules?: AIRules
}
interface CreateDevServicesParams {
  apiPath: string
  projectName: string
  dbSetup: 'docker' | 'credentials' | 'manual'
  dbCredentials?: DbCredentials
  s3Setup: 'docker' | 'credentials' | 'manual'
  s3Credentials?: S3Credentials
}
```

See [Builders](/api/builders) for each function's behaviour.

## Workflow configuration

The workflow types mirror the shape of `.saasfoundry.json` — they are serialised into the generated project so that `sf-workflow` has everything it needs without the scaffolds hard-coding any value.

```typescript
type GitHubProjectColor = 'GRAY' | 'YELLOW' | 'BLUE' | 'PURPLE' | 'ORANGE' | 'PINK' | 'GREEN' | 'RED'

interface WorkflowStatus {
  name: string // e.g. "Human testing"
  description?: string
  color?: GitHubProjectColor
}

interface WorkflowConfig {
  tool: 'github-projects' | 'jira' | 'notion' | 'linear' | 'none'
  projectUrl?: string
  workingBranch?: string // e.g. "develop"
  prTargetBranch?: string // e.g. "master"
  requireCodeReview?: boolean
  statuses?: WorkflowStatus[]
  branchNaming?: {
    feature?: string // e.g. "feature/{N}-{description}"
    fix?: string
    release?: string
  }
  commitFormat?: {
    pattern?: string // e.g. "<type>(#<ticket>): <description>"
    requireTicket?: boolean
    types?: string[]
  }
  template?: string // saasfoundry-default | custom
  validated?: boolean
  lastValidated?: string // ISO timestamp
}

interface AIRules {
  alwaysCreateBranchFromWorking?: boolean
  alwaysCreateTicketBeforeCode?: boolean
  autoUpdateTicketStatus?: boolean
  requireHumanCheckOnPushedBranch?: boolean
}

interface WorkflowTemplate extends WorkflowConfig {
  name: string
  description?: string
  aiRules?: AIRules
}
```

::: info Adapter availability Only `tool: 'github-projects'` has a shipped adapter today. The other values in the union are present for forward-compatibility — they will light up as the Jira / Notion
/ Linear adapters land. See [GitHub Integration](/workflow/github-integration) for the reference implementation. :::

## Project manifest

Every generated project writes a `.saasfoundry.json` file at the root. Its shape:

```typescript
interface SaaSFoundryManifest {
  version: string // CLI version that generated the project
  generatedAt: string // ISO timestamp
  structure: 'monorepo' | 'multirepo'
  projectName: string
  modules: {
    emailService: 'none' | 'mailersend'
    s3Setup: 'docker' | 'credentials' | 'manual'
    dbSetup: 'docker' | 'credentials' | 'manual'
    includeAnalytics: boolean
    advancedSkills: string[]
  }
  skillsAccounts?: Record<string, string> // tool → active account name
  fileHashes?: Record<string, string> // used by `sf update` three-way merge
  workflow?: WorkflowConfig
  aiRules?: AIRules
}
```

`fileHashes` is the key to `sf update`'s safe propagation — if a file's current hash matches its previous scaffold hash, the file is user-untouched and safe to overwrite. If it has diverged,
`sf update` treats it as a merge conflict.

## Path constants

Three resolved paths are exported so every builder and installer agrees on where the scaffolds live:

```typescript
export const blueprintsPath = resolve(__dirname, '../scaffolds/blueprints')
export const overlaysPath = resolve(__dirname, '../scaffolds/overlays')
export const skillsTemplatesPath = resolve(__dirname, '../scaffolds/skills-templates')
```

- **`blueprintsPath`** — the base templates for each app (`api/`, `web/`, `db/`, `s3/`). Always copied.
- **`overlaysPath`** — topology-specific overrides (`monorepo/`, `multirepo/`) and optional module overlays (`modules/email/`, `modules/storage/`, `modules/analytics/`).
- **`skillsTemplatesPath`** — source for `.claude/skills/` installations (`core/`, `optional/`, `tools/`, `workflow/`).

## Next steps

- [Builders](/api/builders) — the scaffolding entry points that consume these types.
- [Installers](/api/installers) — how optional module types wire themselves into the generated project.
- [Runners](/api/runners) — post-setup orchestration (Docker, npm, terminal).
