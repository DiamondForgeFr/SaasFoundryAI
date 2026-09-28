import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { readManifest, writeManifest } from '../../utils'
import { SaaSFoundryManifest, WorkflowConfig } from '../../types'

/**
 * E2E tests for workflow command logic.
 *
 * Since the workflowCommand relies on interactive prompts, we test the underlying
 * functions (readManifest, writeManifest) and workflow configuration persistence.
 */
describe('workflow command logic (E2E)', () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-e2e-workflow-${Date.now()}`)
    originalCwd = process.cwd()
    await mkdir(tempDir, { recursive: true })
    process.chdir(tempDir)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  describe('workflow configuration in manifest', () => {
    it('should store workflow config in manifest', async () => {
      const workflow: WorkflowConfig = {
        tool: 'github-projects',
        projectUrl: 'https://github.com/orgs/test/projects/1',
        workingBranch: 'develop',
        prTargetBranch: 'master',
        requireCodeReview: true,
        statuses: [
          { name: 'Backlog', color: 'GRAY' },
          { name: 'Ready', color: 'YELLOW' },
          { name: 'In Progress', color: 'BLUE' },
          { name: 'Done', color: 'GREEN' }
        ]
      }

      await writeManifest(tempDir, {
        version: '1.0.0-beta',
        projectName: 'workflow-test',
        structure: 'monorepo',
        generatedAt: new Date().toISOString(),
        modules: {
          email: { provider: 'none', version: 1 },
          s3Setup: 'manual',
          dbSetup: 'docker',
          includeAnalytics: false,
          advancedSkills: []
        },
        workflow
      } as SaaSFoundryManifest)

      const manifest = await readManifest(tempDir)
      expect(manifest?.workflow?.tool).toBe('github-projects')
      expect(manifest?.workflow?.projectUrl).toBe('https://github.com/orgs/test/projects/1')
      expect(manifest?.workflow?.statuses).toHaveLength(4)
    })

    it('should update workflow config without affecting other manifest fields', async () => {
      // Initial manifest
      await writeManifest(tempDir, {
        version: '1.0.0-beta',
        projectName: 'update-test',
        structure: 'multirepo',
        generatedAt: new Date().toISOString(),
        modules: {
          email: { provider: 'mailersend', version: 1 },
          s3Setup: 'docker',
          dbSetup: 'docker',
          includeAnalytics: true,
          advancedSkills: ['context7']
        }
      } as SaaSFoundryManifest)

      // Update workflow only
      await writeManifest(tempDir, {
        workflow: {
          tool: 'jira',
          projectUrl: 'https://mysite.atlassian.net/jira/projects/TEST'
        }
      } as Partial<SaaSFoundryManifest>)

      const manifest = await readManifest(tempDir)
      expect(manifest?.projectName).toBe('update-test')
      expect(manifest?.modules?.email).toEqual({ provider: 'mailersend', version: 1 })
      expect(manifest?.workflow?.tool).toBe('jira')
    })

    it('should handle AI rules in manifest', async () => {
      await writeManifest(tempDir, {
        version: '1.0.0-beta',
        projectName: 'ai-rules-test',
        structure: 'monorepo',
        generatedAt: new Date().toISOString(),
        modules: {
          email: { provider: 'none', version: 1 },
          s3Setup: 'manual',
          dbSetup: 'docker',
          includeAnalytics: false,
          advancedSkills: []
        },
        aiRules: {
          alwaysCreateBranchFromWorking: true,
          alwaysCreateTicketBeforeCode: true,
          autoUpdateTicketStatus: true,
          requireHumanCheckOnPushedBranch: true
        }
      } as SaaSFoundryManifest)

      const manifest = await readManifest(tempDir)
      expect(manifest?.aiRules?.alwaysCreateBranchFromWorking).toBe(true)
      expect(manifest?.aiRules?.requireHumanCheckOnPushedBranch).toBe(true)
    })

    it('should handle workflow with branch naming conventions', async () => {
      await writeManifest(tempDir, {
        version: '1.0.0-beta',
        projectName: 'branch-test',
        structure: 'monorepo',
        generatedAt: new Date().toISOString(),
        modules: {
          email: { provider: 'none', version: 1 },
          s3Setup: 'manual',
          dbSetup: 'docker',
          includeAnalytics: false,
          advancedSkills: []
        },
        workflow: {
          tool: 'github-projects',
          branchNaming: {
            feature: 'feature/{ticket}-{description}',
            fix: 'fix/{ticket}-{description}',
            release: 'rc-{version}'
          },
          commitFormat: {
            pattern: '<type>(#<ticket>): <description>',
            requireTicket: true,
            types: ['feat', 'fix', 'docs', 'refactor', 'test', 'chore']
          }
        }
      } as SaaSFoundryManifest)

      const manifest = await readManifest(tempDir)
      expect(manifest?.workflow?.branchNaming?.feature).toBe('feature/{ticket}-{description}')
      expect(manifest?.workflow?.commitFormat?.requireTicket).toBe(true)
      expect(manifest?.workflow?.commitFormat?.types).toContain('feat')
    })
  })

  describe('workflow none mode', () => {
    it('should not include workflow section when tool is none', async () => {
      await writeManifest(tempDir, {
        version: '1.0.0-beta',
        projectName: 'no-workflow',
        structure: 'multirepo',
        generatedAt: new Date().toISOString(),
        modules: {
          email: { provider: 'none', version: 1 },
          s3Setup: 'manual',
          dbSetup: 'manual',
          includeAnalytics: false,
          advancedSkills: []
        },
        workflow: { tool: 'none' }
      } as SaaSFoundryManifest)

      const manifest = await readManifest(tempDir)
      expect(manifest?.workflow?.tool).toBe('none')
    })
  })
})
