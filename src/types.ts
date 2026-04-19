import { resolve } from 'path'

export interface DbCredentials {
  host: string
  port: string
  user: string
  password: string
  database: string
  dbType: 'postgresql' | 'sql'
}

export interface S3Credentials {
  endpoint: string
  accessKey: string
  secretKey: string
  bucket: string
  region: string
}

export interface Answers {
  projectName: string
  projectDescription: string
  isMonorepo: boolean
  setupRepo: 'local' | 'create' | 'existing'
  gitProvider?: 'GitHub' | 'GitLab'
  mainBranch: 'main' | 'master'
  monorepoUrl?: string
  backendRepoUrl: string
  frontendRepoUrl?: string
  dbSetup: 'docker' | 'credentials' | 'manual'
  dbCredentials?: DbCredentials
  initDb: boolean
  emailService: 'none' | 'mailersend'
  mailersendApiKey?: string
  mailersendSenderEmail?: string
  mailersendSenderName?: string
  s3Setup: 'docker' | 'credentials' | 'manual'
  s3Credentials?: S3Credentials
  includeAnalytics: boolean
  advancedSkills?: string[]
  context7ApiKey?: string
  atlassianEmail?: string
  atlassianApiToken?: string
  atlassianSite?: string
  atlassianCloudId?: string
  notionApiToken?: string
  notionApiVersion?: string
  figmaApiToken?: string
  srsEnable?: boolean
  srsBackend?: 'notion'
  srsParentPageInput?: string
  srsBootstrap?: {
    rootPage: SrsPageRef
    categoryPage: SrsPageRef
  }
  workflow?: WorkflowConfig
  aiRules?: AIRules
}

export interface CreateApiAppParams {
  isMonorepo: boolean
  projectName: string
  projectDescription: string
  backendRepoUrl: string
  dbCredentials?: DbCredentials
  mainBranch: string
  emailService: 'none' | 'mailersend'
  mailersendApiKey?: string
  mailersendSenderEmail?: string
  mailersendSenderName?: string
  s3Setup: 'docker' | 'credentials' | 'manual'
  s3Credentials?: S3Credentials
  advancedSkills?: string[]
  context7ApiKey?: string
  atlassianEmail?: string
  atlassianApiToken?: string
  atlassianSite?: string
  atlassianCloudId?: string
  notionApiToken?: string
  notionApiVersion?: string
  figmaApiToken?: string
  workflow?: WorkflowConfig
  aiRules?: AIRules
}

export interface CreateWebAppParams {
  isMonorepo: boolean
  projectName: string
  projectDescription: string
  frontendRepoUrl: string
  mainBranch: string
  s3Setup: 'docker' | 'credentials' | 'manual'
  includeAnalytics: boolean
  advancedSkills?: string[]
  context7ApiKey?: string
  atlassianEmail?: string
  atlassianApiToken?: string
  atlassianSite?: string
  atlassianCloudId?: string
  notionApiToken?: string
  notionApiVersion?: string
  figmaApiToken?: string
  workflow?: WorkflowConfig
  aiRules?: AIRules
}

export interface CreateDbAppParams {
  isMonorepo: boolean
  projectName: string
  dbCredentials?: DbCredentials
}

export interface CreateS3AppParams {
  isMonorepo: boolean
  projectName: string
  s3Credentials?: S3Credentials
}

export interface CreateMonorepoRootParams {
  projectName: string
  projectDescription: string
  monorepoUrl?: string
  mainBranch: string
  workflow?: WorkflowConfig
  aiRules?: AIRules
}

export interface CreateDevServicesParams {
  apiPath: string
  projectName: string
  dbSetup: 'docker' | 'credentials' | 'manual'
  dbCredentials?: DbCredentials
  s3Setup: 'docker' | 'credentials' | 'manual'
  s3Credentials?: S3Credentials
}

// Workflow Configuration Interfaces
export type GitHubProjectColor = 'GRAY' | 'YELLOW' | 'BLUE' | 'PURPLE' | 'ORANGE' | 'PINK' | 'GREEN' | 'RED'

export interface WorkflowStatus {
  name: string
  description?: string
  color?: GitHubProjectColor
}

export interface WorkflowConfig {
  tool: 'github-projects' | 'jira' | 'notion' | 'linear' | 'none'
  projectUrl?: string
  workingBranch?: string
  prTargetBranch?: string
  requireCodeReview?: boolean
  statuses?: WorkflowStatus[]
  branchNaming?: {
    feature?: string
    fix?: string
    release?: string
  }
  commitFormat?: {
    pattern?: string
    requireTicket?: boolean
    types?: string[]
  }
  template?: string
  validated?: boolean
  lastValidated?: string
}

export interface AIRules {
  alwaysCreateBranchFromWorking?: boolean
  alwaysCreateTicketBeforeCode?: boolean
  autoUpdateTicketStatus?: boolean
  requireHumanCheckOnPushedBranch?: boolean
}

export interface WorkflowTemplate extends WorkflowConfig {
  name: string
  description?: string
  aiRules?: AIRules
}

export interface SrsPageRef {
  id: string
  url: string
  name: string
}

export interface SrsToolConfig {
  enabled: boolean
  backend: 'notion'
  rootPage?: SrsPageRef
  categories?: {
    userFlowsAndSpecifications?: SrsPageRef
  }
}

export interface ToolsConfig {
  srs?: SrsToolConfig
}

export interface SaaSFoundryManifest {
  version: string
  generatedAt: string
  structure: 'monorepo' | 'multirepo'
  projectName: string
  modules: {
    emailService: 'none' | 'mailersend'
    s3Setup: 'docker' | 'credentials' | 'manual'
    dbSetup: 'docker' | 'credentials' | 'manual'
    includeAnalytics: boolean
    advancedSkills: string[]
  }
  skillsAccounts?: Record<string, string>
  fileHashes?: Record<string, string>
  workflow?: WorkflowConfig
  aiRules?: AIRules
  tools?: ToolsConfig
}

// Paths
export const blueprintsPath = resolve(__dirname, '../scaffolds/blueprints')
export const overlaysPath = resolve(__dirname, '../scaffolds/overlays')
export const skillsTemplatesPath = resolve(__dirname, '../scaffolds/skills-templates')
