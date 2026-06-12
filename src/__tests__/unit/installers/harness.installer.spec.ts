import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { installHarness, installWorkflowArtifacts } from '../../../installers/harness.installer'
import { WorkflowConfig } from '../../../types'
import { fileExists } from '../../../utils'

const WORKFLOW: WorkflowConfig = {
  tool: 'github-projects',
  workingBranch: 'develop',
  prTargetBranch: 'develop',
  statuses: [
    { name: 'Backlog', color: 'GRAY' },
    { name: 'Done', color: 'GREEN' }
  ]
}

describe('harness installer', () => {
  let dir: string

  beforeEach(async () => {
    dir = join(tmpdir(), `sf-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(dir, { recursive: true })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  describe('installWorkflowArtifacts', () => {
    it('is a no-op without a workflow or with tool none', async () => {
      await installWorkflowArtifacts({ targetPath: dir })
      await installWorkflowArtifacts({ targetPath: dir, workflow: { tool: 'none' } })

      expect(await fileExists(join(dir, '.claude', 'skills', 'sf-workflow'))).toBe(false)
    })

    it('deposits the workflow skill and the tool skill', async () => {
      await installWorkflowArtifacts({ targetPath: dir, workflow: WORKFLOW })

      expect(await fileExists(join(dir, '.claude', 'skills', 'sf-workflow', 'SKILL.md'))).toBe(true)
      expect(await fileExists(join(dir, '.claude', 'skills', 'sf-tool-github-projects'))).toBe(true)
    })
  })

  describe('installHarness', () => {
    const params = { projectName: 'notulias', version: '9.9.9', mainBranch: 'main' as const, workflow: WORKFLOW }

    it('deposits the full harness on a bare repository', async () => {
      await installHarness({ targetPath: dir, ...params })

      // CLAUDE.md from the harness template, placeholders resolved
      const claudeMd = await readFile(join(dir, 'CLAUDE.md'), 'utf8')
      expect(claudeMd).toContain('# notulias')
      expect(claudeMd).toContain('CLI v9.9.9')
      expect(claudeMd).not.toContain('{{')
      expect(claudeMd).toContain('## Workflow System')

      // Skills + docs + workflow artefacts
      expect(await fileExists(join(dir, '.claude', 'skills', 'sf-workflow', 'SKILL.md'))).toBe(true)
      expect(await fileExists(join(dir, '.claude', 'skills', 'sf-tool-github-projects'))).toBe(true)
      expect(await fileExists(join(dir, '.claude', 'docs'))).toBe(true)
      expect(await fileExists(join(dir, '.claude', 'skills', 'sf-integration-rules'))).toBe(true)

      // Claude Code hooks
      const settings = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf8'))
      expect(JSON.stringify(settings.hooks.SessionStart)).toContain('sf status --claude-friendly --no-network')
    })

    it('never overwrites an existing CLAUDE.md — only appends the workflow section', async () => {
      const userContent = '# My project\n\nMy own instructions, hands off.\n'
      await writeFile(join(dir, 'CLAUDE.md'), userContent)

      await installHarness({ targetPath: dir, ...params })

      const claudeMd = await readFile(join(dir, 'CLAUDE.md'), 'utf8')
      expect(claudeMd).toContain('My own instructions, hands off.')
      expect(claudeMd).toContain('## Workflow System')
      expect(claudeMd).not.toContain('{{PROJECT_NAME}}')
    })

    it('merges into an existing .claude/settings.json without clobbering it', async () => {
      await mkdir(join(dir, '.claude'), { recursive: true })
      await writeFile(join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(make test)'] } }))

      await installHarness({ targetPath: dir, ...params })

      const settings = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf8'))
      expect(settings.permissions).toEqual({ allow: ['Bash(make test)'] })
      expect(settings.hooks.SessionStart).toBeDefined()
    })

    it('installs optional skills when requested', async () => {
      await installHarness({ targetPath: dir, ...params, advancedSkills: ['context7'] })

      expect(await fileExists(join(dir, '.claude', 'skills', 'sf-tool-context7'))).toBe(true)
    })

    it('works without a workflow (skills-only harness)', async () => {
      await installHarness({ targetPath: dir, projectName: 'bare', version: '1.0.0' })

      expect(await fileExists(join(dir, '.claude', 'skills', 'sf-workflow'))).toBe(false)
      expect(await fileExists(join(dir, '.claude', 'docs'))).toBe(true)
      const claudeMd = await readFile(join(dir, 'CLAUDE.md'), 'utf8')
      expect(claudeMd).toContain('# bare')
    })
  })
})
