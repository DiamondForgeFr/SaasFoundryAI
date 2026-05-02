import { copy } from 'fs-extra'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import shelljs from 'shelljs'

import { computeFileUpdates } from '../../commands/update'
import { blueprintsPath, overlaysPath, SaaSFoundryManifest } from '../../types'
import { computeFileHashes, hashFileContent } from '../../utils'

/**
 * E2E tests for the update command logic.
 *
 * Since the actual updateCommand() relies on interactive prompts and process.exit(),
 * we test the key internal functions directly:
 * - computeFileUpdates (already unit-tested, but here with real file hashes)
 * - Module addition flow (using real installers)
 */
describe('update command logic (E2E)', () => {
  let tempDir: string
  let originalCwd: string
  let shellSpy: jest.SpyInstance

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-e2e-update-${Date.now()}`)
    originalCwd = process.cwd()
    await mkdir(tempDir, { recursive: true })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shellSpy = jest.spyOn(shelljs, 'exec').mockImplementation((() => ({ code: 0, stdout: '10.0.0', stderr: '' })) as any)
  })

  afterEach(async () => {
    shellSpy.mockRestore()
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  describe('three-way merge with real file hashes', () => {
    it('should detect files that need updating when template changes', async () => {
      // Setup: create a project dir with some files
      const projectDir = join(tempDir, 'project')
      await mkdir(projectDir, { recursive: true })

      // Create "base" files (what was originally generated)
      await writeFile(join(projectDir, 'unchanged.ts'), 'const a = 1')
      await writeFile(join(projectDir, 'will-change.ts'), 'const b = 2')
      await writeFile(join(projectDir, 'user-modified.ts'), 'const c = 3')

      const baseHashes = await computeFileHashes(projectDir)

      // Simulate user modifying a file
      await writeFile(join(projectDir, 'user-modified.ts'), 'const c = 3 // user change')
      const currentHashes = await computeFileHashes(projectDir)

      // Simulate template change (new CLI version produces different file)
      const targetHashes = { ...baseHashes }
      targetHashes['will-change.ts'] = hashFileContent('const b = 2 // template update')
      targetHashes['user-modified.ts'] = hashFileContent('const c = 3 // template change')
      targetHashes['new-file.ts'] = hashFileContent('// new in v2')

      const updates = computeFileUpdates(baseHashes, currentHashes, targetHashes)

      // will-change.ts: base unchanged by user, template changed → update
      const willChange = updates.find((u) => u.path === 'will-change.ts')
      expect(willChange?.action).toBe('update')

      // user-modified.ts: both changed → conflict
      const userModified = updates.find((u) => u.path === 'user-modified.ts')
      expect(userModified?.action).toBe('conflict')

      // new-file.ts: not in base, in target → add
      const newFile = updates.find((u) => u.path === 'new-file.ts')
      expect(newFile?.action).toBe('add')

      // unchanged.ts: same in base and target → skip
      expect(updates.find((u) => u.path === 'unchanged.ts')).toBeUndefined()
    })
  })

  describe('module addition flow', () => {
    it('should add email module to an existing project', async () => {
      // Setup: create a multirepo project from blueprints
      const projectDir = join(tempDir, 'existing-project')
      const apiPath = join(projectDir, 'apps/existing-project-api')
      const webPath = join(projectDir, 'apps/existing-project-web')

      await copy(resolve(blueprintsPath, 'api'), apiPath)
      await copy(resolve(overlaysPath, 'multirepo/api'), apiPath, { overwrite: true })
      await copy(resolve(blueprintsPath, 'web'), webPath)
      await copy(resolve(overlaysPath, 'multirepo/web'), webPath, { overwrite: true })

      // Create manifest
      const manifest: SaaSFoundryManifest = {
        version: '1.0.0-beta',
        generatedAt: new Date().toISOString(),
        structure: 'multirepo',
        projectName: 'existing-project',
        modules: {
          email: { provider: 'none', version: 1 },
          s3Setup: 'manual',
          dbSetup: 'docker',
          includeAnalytics: false,
          advancedSkills: []
        }
      }
      await writeFile(join(projectDir, '.saasfoundry.json'), JSON.stringify(manifest, null, 2))

      process.chdir(projectDir)

      // Import and run the email installer directly (as updateCommand would)
      const { installEmailModule } = await import('../../installers/email.installer')
      await installEmailModule({
        apiPath: 'apps/existing-project-api',
        isMonorepo: false,
        projectName: 'existing-project',
        mailersendApiKey: 'ms-update-key',
        mailersendSenderEmail: 'noreply@updated.com',
        mailersendSenderName: 'Updated'
      })

      // Verify email module was installed
      const emailService = await readFile(join(apiPath, 'src/modules/email/services/email.service.ts'), 'utf8')
      expect(emailService).not.toContain("console.log('html', html)")

      const envContent = await readFile(join(apiPath, '.env'), 'utf8')
      expect(envContent).toContain('MAILERSEND_API_KEY="ms-update-key"')
    })

    it('should add analytics module to an existing project', async () => {
      const projectDir = join(tempDir, 'analytics-project')
      const webPath = join(projectDir, 'apps/analytics-project-web')

      await copy(resolve(blueprintsPath, 'web'), webPath)
      await copy(resolve(overlaysPath, 'multirepo/web'), webPath, { overwrite: true })

      process.chdir(projectDir)

      const { installAnalyticsModule } = await import('../../installers/analytics.installer')
      await installAnalyticsModule({ webPath: 'apps/analytics-project-web' })

      const mainTsx = await readFile(join(webPath, 'src/main.tsx'), 'utf8')
      expect(mainTsx).toContain("import { initAnalytics } from '@/lib/analytics/analytics'")
      expect(mainTsx).not.toContain('// TODO monitoring-active:')
    })

    it('should add storage module to an existing project', async () => {
      const projectDir = join(tempDir, 'storage-project')
      const apiPath = join(projectDir, 'apps/storage-project-api')
      const webPath = join(projectDir, 'apps/storage-project-web')

      await copy(resolve(blueprintsPath, 'api'), apiPath)
      await copy(resolve(overlaysPath, 'multirepo/api'), apiPath, { overwrite: true })
      await copy(resolve(blueprintsPath, 'web'), webPath)
      await copy(resolve(overlaysPath, 'multirepo/web'), webPath, { overwrite: true })

      process.chdir(projectDir)

      const { installStorageModule } = await import('../../installers/storage.installer')
      await installStorageModule({
        apiPath: 'apps/storage-project-api',
        webPath: 'apps/storage-project-web',
        isMonorepo: false,
        projectName: 'storage-project',
        s3Setup: 'docker',
        skipNpmInstall: true
      })

      // Verify storage module installed
      const appModule = await readFile(join(apiPath, 'src/app.module.ts'), 'utf8')
      expect(appModule).not.toContain('// TODO storage-service-active:')

      const webEnv = await readFile(join(webPath, '.env'), 'utf8')
      expect(webEnv).toContain('VITE_STORAGE_ENABLED="true"')
    })
  })
})
