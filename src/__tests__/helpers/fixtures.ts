import { CreateApiAppParams, CreateWebAppParams, CreateMonorepoRootParams, CreateDevServicesParams, SaaSFoundryManifest, DbCredentials, S3Credentials } from '../../types'

// ── Default Values ──────────────────────────────────────────────

const DEFAULT_PROJECT_NAME = 'test-project'
const DEFAULT_PROJECT_DESCRIPTION = 'A test project'
const DEFAULT_MAIN_BRANCH = 'main'

const DEFAULT_DB_CREDENTIALS: DbCredentials = {
  host: 'localhost',
  port: '5435',
  user: 'db_dev_user',
  password: 'db_dev_password',
  database: 'db_dev',
  dbType: 'postgresql'
}

const DEFAULT_S3_CREDENTIALS: S3Credentials = {
  endpoint: 'http://localhost:9000',
  accessKey: 'minioadmin',
  secretKey: 'minioadmin',
  bucket: 'test-project-uploads',
  region: 'us-east-1'
}

// ── Param Factories ─────────────────────────────────────────────

export function apiParams(overrides: Partial<CreateApiAppParams> = {}): CreateApiAppParams {
  return {
    isMonorepo: false,
    projectName: DEFAULT_PROJECT_NAME,
    projectDescription: DEFAULT_PROJECT_DESCRIPTION,
    backendRepoUrl: 'https://github.com/test/test-api.git',
    dbCredentials: DEFAULT_DB_CREDENTIALS,
    mainBranch: DEFAULT_MAIN_BRANCH,
    emailService: 'none',
    s3Setup: 'manual',
    ...overrides
  }
}

export function webParams(overrides: Partial<CreateWebAppParams> = {}): CreateWebAppParams {
  return {
    isMonorepo: false,
    projectName: DEFAULT_PROJECT_NAME,
    projectDescription: DEFAULT_PROJECT_DESCRIPTION,
    frontendRepoUrl: 'https://github.com/test/test-web.git',
    mainBranch: DEFAULT_MAIN_BRANCH,
    s3Setup: 'manual',
    includeAnalytics: false,
    includePwa: false,
    ...overrides
  }
}

export function monorepoRootParams(overrides: Partial<CreateMonorepoRootParams> = {}): CreateMonorepoRootParams {
  return {
    projectName: DEFAULT_PROJECT_NAME,
    projectDescription: DEFAULT_PROJECT_DESCRIPTION,
    monorepoUrl: 'https://github.com/test/test-mono.git',
    mainBranch: DEFAULT_MAIN_BRANCH,
    ...overrides
  }
}

export function devServicesParams(overrides: Partial<CreateDevServicesParams> = {}): CreateDevServicesParams {
  return {
    apiPath: `apps/${DEFAULT_PROJECT_NAME}-api`,
    projectName: DEFAULT_PROJECT_NAME,
    dbSetup: 'docker',
    dbCredentials: DEFAULT_DB_CREDENTIALS,
    s3Setup: 'manual',
    ...overrides
  }
}

export function manifestFixture(overrides: Partial<SaaSFoundryManifest> = {}): SaaSFoundryManifest {
  return {
    version: '1.0.0-beta',
    generatedAt: '2026-01-01T00:00:00.000Z',
    structure: 'monorepo',
    projectName: DEFAULT_PROJECT_NAME,
    modules: {
      email: { provider: 'none', version: 1 },
      s3Setup: 'manual',
      dbSetup: 'docker',
      includeAnalytics: false,
      advancedSkills: []
    },
    ...overrides
  }
}

// ── Re-exports ──────────────────────────────────────────────────

export { DEFAULT_PROJECT_NAME, DEFAULT_DB_CREDENTIALS, DEFAULT_S3_CREDENTIALS }
