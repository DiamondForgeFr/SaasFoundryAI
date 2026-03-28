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
export interface WorkflowConfig {
  tool: 'github-projects' | 'jira' | 'notion' | 'linear' | 'none'
  projectUrl?: string
  workingBranch?: string
  prTargetBranch?: string
  requireCodeReview?: boolean
  statuses?: {
    backlog?: string
    ready?: string
    inProgress?: string
    inReview?: string
    done?: string
  }
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
}

// Paths
export const blueprintsPath = resolve(__dirname, '../scaffolds/blueprints')
export const overlaysPath = resolve(__dirname, '../scaffolds/overlays')
