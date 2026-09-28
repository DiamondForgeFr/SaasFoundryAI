import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { installWorkflowSkill } from '../../../installers/workflow-skill.installer'
import { WorkflowConfig } from '../../../types'
import { expectFileExists, expectFileContains } from '../../helpers/assertions'

describe('installWorkflowSkill (integration)', () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-workflow-skill-integ-${Date.now()}`)
    originalCwd = process.cwd()
    await mkdir(tempDir, { recursive: true })
    process.chdir(tempDir)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  const baseWorkflow: WorkflowConfig = {
    tool: 'github-projects',
    workingBranch: 'develop',
    prTargetBranch: 'master'
  }

  it('should copy workflow skill template to target path', async () => {
    await installWorkflowSkill({
      targetPath: tempDir,
      workflow: baseWorkflow
    })

    await expectFileExists(join(tempDir, '.claude/skills/sf-workflow/SKILL.md'))
    await expectFileExists(join(tempDir, '.claude/skills/sf-workflow/workflow-cli.sh'))
  })

  it('should replace {{WORKFLOW_NAME}} placeholder in SKILL.md', async () => {
    await installWorkflowSkill({
      targetPath: tempDir,
      workflow: { ...baseWorkflow, template: 'saasfoundry-ai' }
    })

    await expectFileContains(join(tempDir, '.claude/skills/sf-workflow/SKILL.md'), 'saasfoundry-ai')
  })

  it('should replace {{TOOL}} placeholder with display name', async () => {
    await installWorkflowSkill({
      targetPath: tempDir,
      workflow: baseWorkflow
    })

    await expectFileContains(join(tempDir, '.claude/skills/sf-workflow/SKILL.md'), 'GitHub Projects')
  })

  it('should inject workflow section into existing CLAUDE.md', async () => {
    // Create a CLAUDE.md with expected markers
    await writeFile(join(tempDir, 'CLAUDE.md'), '# Project\n\n## Git Workflow\n\nUse conventional commits.\n\n## Development Commands\n\nnpm run dev\n')

    await installWorkflowSkill({
      targetPath: tempDir,
      workflow: baseWorkflow,
      projectUrl: 'https://github.com/orgs/test/projects/1'
    })

    const claudeMd = await readFile(join(tempDir, 'CLAUDE.md'), 'utf8')
    expect(claudeMd).toContain('## Workflow System')
    expect(claudeMd).toContain('**Tool**: GitHub Projects')
    expect(claudeMd).toContain('**Working Branch**: `develop`')
    expect(claudeMd).toContain('**PR Target Branch**: `master`')
    expect(claudeMd).toContain('https://github.com/orgs/test/projects/1')
    // Should be injected before Development Commands
    expect(claudeMd.indexOf('## Workflow System')).toBeLessThan(claudeMd.indexOf('## Development Commands'))
  })

  it('should append workflow section when CLAUDE.md has no markers', async () => {
    await writeFile(join(tempDir, 'CLAUDE.md'), '# Project\n\nSome content.\n')

    await installWorkflowSkill({
      targetPath: tempDir,
      workflow: baseWorkflow
    })

    const claudeMd = await readFile(join(tempDir, 'CLAUDE.md'), 'utf8')
    expect(claudeMd).toContain('## Workflow System')
  })

  it('should skip CLAUDE.md injection when file does not exist', async () => {
    // Don't create CLAUDE.md
    await installWorkflowSkill({
      targetPath: tempDir,
      workflow: baseWorkflow
    })

    // Should still copy the skill template
    await expectFileExists(join(tempDir, '.claude/skills/sf-workflow/SKILL.md'))
  })

  it('should include branch naming in CLAUDE.md when configured', async () => {
    await writeFile(join(tempDir, 'CLAUDE.md'), '# Project\n\n## Git Workflow\n\nConventional.\n\n## Development Commands\n\nnpm run dev\n')

    await installWorkflowSkill({
      targetPath: tempDir,
      workflow: {
        ...baseWorkflow,
        branchNaming: {
          feature: 'feature/{ticket}-{description}',
          fix: 'fix/{ticket}-{description}',
          release: 'rc-{version}'
        }
      }
    })

    const claudeMd = await readFile(join(tempDir, 'CLAUDE.md'), 'utf8')
    expect(claudeMd).toContain('### Branch Naming')
    expect(claudeMd).toContain('feature/{ticket}-{description}')
    expect(claudeMd).toContain('fix/{ticket}-{description}')
    expect(claudeMd).toContain('rc-{version}')
  })

  it('should include commit format in CLAUDE.md when configured', async () => {
    await writeFile(join(tempDir, 'CLAUDE.md'), '# Project\n\n## Git Workflow\n\nConventional.\n\n## Development Commands\n\nnpm run dev\n')

    await installWorkflowSkill({
      targetPath: tempDir,
      workflow: {
        ...baseWorkflow,
        commitFormat: {
          pattern: '<type>(#<ticket>): <description>',
          requireTicket: true,
          types: ['feat', 'fix', 'docs', 'refactor', 'test', 'chore']
        }
      }
    })

    const claudeMd = await readFile(join(tempDir, 'CLAUDE.md'), 'utf8')
    expect(claudeMd).toContain('### Commit Format')
    expect(claudeMd).toContain('<type>(#<ticket>): <description>')
    expect(claudeMd).toContain('Ticket reference is required')
    expect(claudeMd).toContain('`feat`')
    expect(claudeMd).toContain('`chore`')
  })

  it('should handle jira tool display name', async () => {
    await installWorkflowSkill({
      targetPath: tempDir,
      workflow: { ...baseWorkflow, tool: 'jira' }
    })

    await expectFileContains(join(tempDir, '.claude/skills/sf-workflow/SKILL.md'), 'Jira')
  })

  it('should handle notion tool display name', async () => {
    await installWorkflowSkill({
      targetPath: tempDir,
      workflow: { ...baseWorkflow, tool: 'notion' as WorkflowConfig['tool'] }
    })

    await expectFileContains(join(tempDir, '.claude/skills/sf-workflow/SKILL.md'), 'Notion')
  })

  it('should handle linear tool display name', async () => {
    await installWorkflowSkill({
      targetPath: tempDir,
      workflow: { ...baseWorkflow, tool: 'linear' as WorkflowConfig['tool'] }
    })

    await expectFileContains(join(tempDir, '.claude/skills/sf-workflow/SKILL.md'), 'Linear')
  })
})
