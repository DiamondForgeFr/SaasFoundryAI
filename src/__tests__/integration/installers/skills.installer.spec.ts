import { copy } from 'fs-extra'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { tmpdir } from 'os'

import { installSkills } from '../../../installers/skills.installer'
import { blueprintsPath, overlaysPath } from '../../../types'
import { expectFileExists } from '../../helpers/assertions'

describe('installSkills (integration)', () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-skills-test-${Date.now()}`)
    originalCwd = process.cwd()
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  describe('multirepo mode', () => {
    let apiPath: string
    let webPath: string

    beforeEach(async () => {
      apiPath = join(tempDir, 'apps/test-project-api')
      webPath = join(tempDir, 'apps/test-project-web')

      // Copy blueprints
      await copy(resolve(blueprintsPath, 'api'), apiPath)
      await copy(resolve(blueprintsPath, 'web'), webPath)
    })

    it('should install core skills in both API and Web apps', async () => {
      await installSkills({
        isMonorepo: false,
        apiPath,
        webPath,
        projectName: 'test-project',
        version: '1.0.0-beta'
      })

      // Check that core skills directories exist in both apps
      await expectFileExists(join(apiPath, '.claude/skills'))
      await expectFileExists(join(webPath, '.claude/skills'))
    })

    it('should install the sf-integration-rules skill with all sub-guides in both apps', async () => {
      await installSkills({
        isMonorepo: false,
        apiPath,
        webPath,
        projectName: 'test-project',
        version: '1.0.0-beta'
      })

      for (const appPath of [apiPath, webPath]) {
        await expectFileExists(join(appPath, '.claude/skills/sf-integration-rules/SKILL.md'))
        await expectFileExists(join(appPath, '.claude/skills/sf-integration-rules/backend.md'))
        await expectFileExists(join(appPath, '.claude/skills/sf-integration-rules/frontend.md'))
        await expectFileExists(join(appPath, '.claude/skills/sf-integration-rules/topology.md'))
      }
    })

    it('should install shared claude docs in both API and Web apps', async () => {
      await installSkills({
        isMonorepo: false,
        apiPath,
        webPath,
        projectName: 'test-project',
        version: '1.0.0-beta'
      })

      await expectFileExists(join(apiPath, '.claude/docs/manifest-schema.md'))
      await expectFileExists(join(webPath, '.claude/docs/manifest-schema.md'))
    })

    it('should install optional skills in both API and Web apps when selected', async () => {
      await installSkills({
        isMonorepo: false,
        apiPath,
        webPath,
        projectName: 'test-project',
        version: '1.0.0-beta',
        advancedSkills: ['context7']
      })

      await expectFileExists(join(apiPath, '.claude/skills/sf-tool-context7'))
      await expectFileExists(join(webPath, '.claude/skills/sf-tool-context7'))
    })

    it('should replace CLAUDE.md placeholders with project name, version and main branch', async () => {
      await writeFile(join(apiPath, 'CLAUDE.md'), '# {{PROJECT_NAME}} v{{VERSION}}\n- Main branch: `{{MAIN_BRANCH}}`\n')

      await installSkills({
        isMonorepo: false,
        apiPath,
        webPath,
        projectName: 'my-app',
        version: '2.0.0',
        mainBranch: 'master'
      })

      const apiClaudeMd = await readFile(join(apiPath, 'CLAUDE.md'), 'utf8')
      expect(apiClaudeMd).toContain('# my-app v2.0.0')
      expect(apiClaudeMd).toContain('- Main branch: `master`')
      expect(apiClaudeMd).not.toContain('{{')
    })

    it('should not install optional skills when none selected', async () => {
      await installSkills({
        isMonorepo: false,
        apiPath,
        webPath,
        projectName: 'test-project',
        version: '1.0.0-beta',
        advancedSkills: []
      })

      // Core skills should exist, but optional ones should not
      await expectFileExists(join(apiPath, '.claude/skills'))
    })
  })

  describe('monorepo mode', () => {
    beforeEach(async () => {
      // Copy monorepo root overlay
      await copy(resolve(overlaysPath, 'monorepo/root'), tempDir, { overwrite: true })

      // Create apps directories
      const apiPath = join(tempDir, 'apps/api')
      const webPath = join(tempDir, 'apps/web')
      await copy(resolve(blueprintsPath, 'api'), apiPath)
      await copy(resolve(blueprintsPath, 'web'), webPath)

      process.chdir(tempDir)
    })

    it('should install skills at root only (centralized)', async () => {
      await installSkills({
        isMonorepo: true,
        apiPath: 'apps/api',
        webPath: 'apps/web',
        projectName: 'test-project',
        version: '1.0.0-beta'
      })

      // Root should have skills
      await expectFileExists(join(tempDir, '.claude/skills'))
    })

    it('should install the sf-integration-rules skill with all sub-guides at root', async () => {
      await installSkills({
        isMonorepo: true,
        apiPath: 'apps/api',
        webPath: 'apps/web',
        projectName: 'test-project',
        version: '1.0.0-beta'
      })

      await expectFileExists(join(tempDir, '.claude/skills/sf-integration-rules/SKILL.md'))
      await expectFileExists(join(tempDir, '.claude/skills/sf-integration-rules/backend.md'))
      await expectFileExists(join(tempDir, '.claude/skills/sf-integration-rules/frontend.md'))
      await expectFileExists(join(tempDir, '.claude/skills/sf-integration-rules/topology.md'))
    })

    it('should install shared claude docs at root for monorepo', async () => {
      await installSkills({
        isMonorepo: true,
        apiPath: 'apps/api',
        webPath: 'apps/web',
        projectName: 'test-project',
        version: '1.0.0-beta'
      })

      await expectFileExists(join(tempDir, '.claude/docs/manifest-schema.md'))
      await expectFileExists(join(tempDir, '.claude/docs/github-labels.md'))
      await expectFileExists(join(tempDir, '.claude/docs/exit-codes.md'))
      await expectFileExists(join(tempDir, '.claude/docs/architecture-skills.md'))
    })

    it('should install optional skills at root for monorepo', async () => {
      await installSkills({
        isMonorepo: true,
        apiPath: 'apps/api',
        webPath: 'apps/web',
        projectName: 'test-project',
        version: '1.0.0-beta',
        advancedSkills: ['context7', 'figma']
      })

      await expectFileExists(join(tempDir, '.claude/skills/sf-tool-context7'))
      await expectFileExists(join(tempDir, '.claude/skills/sf-tool-figma'))
    })
  })
})
