import { readFileSync } from 'fs'
import { join } from 'path'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'

// Regression guard for #286: the JSON Schema is the single source of truth
// for `.saasfoundry.json`. If a canonical shape from manifest-schema.md stops
// validating, scaffolded projects break — IDEs surface red squiggles where
// none should appear, and downstream skill scripts that trusted schema-pinned
// fields face values they don't expect.

const SCHEMA_PATH = join(__dirname, '../../../../schemas/saasfoundry-manifest.schema.json')
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
const validate = ajv.compile(schema)

const baseManifest = {
  $schema: 'https://raw.githubusercontent.com/DiamondForgeFr/SaaSFoundry/master/schemas/saasfoundry-manifest.schema.json',
  version: '1.0.0-beta',
  generatedAt: '2026-04-25T00:00:00.000Z',
  structure: 'multirepo',
  projectName: 'demo'
}

describe('saasfoundry-manifest.schema.json — canonical shapes', () => {
  it('accepts a minimal manifest (only required fields)', () => {
    expect(validate({ version: '1.0.0', structure: 'cli', projectName: 'demo' })).toBe(true)
  })

  it('accepts the full canonical shape from manifest-schema.md', () => {
    const full = {
      ...baseManifest,
      modules: {
        emailService: 'mailersend',
        s3Setup: 'docker',
        dbSetup: 'credentials',
        includeAnalytics: true,
        advancedSkills: ['context7', 'notion']
      },
      skillsAccounts: { context7: 'demo-account' },
      fileHashes: { 'src/main.ts': 'abc123' },
      workflow: {
        tool: 'github-projects',
        template: 'SaaSFoundry AI',
        projectUrl: 'https://github.com/orgs/demo/projects/1',
        workingBranch: 'develop',
        prTargetBranch: 'develop',
        releaseBranch: 'master',
        requireCodeReview: true,
        branchNaming: { feature: 'feature/{N}-{description}', fix: 'fix/{N}-{description}', release: 'rc-{version}' },
        commitFormat: { pattern: '<type>(#<ticket>): <description>', requireTicket: true, types: ['feat', 'fix'] },
        statuses: [
          { name: 'Backlog', color: 'GRAY' },
          { name: 'In progress', color: 'BLUE' }
        ],
        validated: true,
        lastValidated: '2026-04-25T00:00:00.000Z'
      },
      aiRules: {
        alwaysCreateBranchFromWorking: true,
        alwaysCreateTicketBeforeCode: true,
        autoUpdateTicketStatus: false,
        requireHumanCheckOnPushedBranch: true
      },
      tools: {
        srs: {
          enabled: true,
          backend: 'notion',
          rootPage: { id: 'page-uuid', url: 'https://notion.so/x', name: 'My Epic' },
          scan: { exclude: ['scaffolds/', 'docs/'] }
        }
      }
    }
    expect(validate(full)).toBe(true)
  })

  it('accepts every structure enum value', () => {
    for (const structure of ['monorepo', 'multirepo', 'cli']) {
      expect(validate({ version: '1.0.0', structure, projectName: 'demo' })).toBe(true)
    }
  })

  it('accepts every workflow.tool enum value', () => {
    for (const tool of ['github-projects', 'jira', 'notion', 'linear', 'none']) {
      expect(validate({ ...baseManifest, workflow: { tool } })).toBe(true)
    }
  })
})

describe('saasfoundry-manifest.schema.json — rejection cases', () => {
  it('rejects a manifest missing a required root field', () => {
    expect(validate({ version: '1.0.0', structure: 'cli' })).toBe(false)
  })

  it('rejects an unknown structure value', () => {
    expect(validate({ version: '1.0.0', structure: 'desktop', projectName: 'demo' })).toBe(false)
  })

  it('rejects an unknown workflow.tool value', () => {
    expect(validate({ ...baseManifest, workflow: { tool: 'azure-devops' } })).toBe(false)
  })

  it('rejects an unknown workflow.statuses[].color value', () => {
    expect(validate({ ...baseManifest, workflow: { tool: 'github-projects', statuses: [{ name: 'Done', color: 'NEON' }] } })).toBe(false)
  })

  it('rejects a non-string tools.srs.backend (schema pins const "notion")', () => {
    // Guards the rationale for #291 — the bash script no longer needs a runtime
    // type check because non-string backend values are rejected at this layer.
    expect(validate({ ...baseManifest, tools: { srs: { enabled: true, backend: 42 } } })).toBe(false)
    expect(validate({ ...baseManifest, tools: { srs: { enabled: true, backend: 'jira' } } })).toBe(false)
  })

  it('rejects a typo in a top-level field (additionalProperties: false)', () => {
    expect(validate({ ...baseManifest, structuer: 'cli' })).toBe(false)
  })
})
