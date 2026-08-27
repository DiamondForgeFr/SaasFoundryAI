import { mkdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import shelljs from 'shelljs'

import { createWebApp } from '../../../builders/web.builder'
import { webParams } from '../../helpers/fixtures'
import { expectFileExists, expectFileContains, expectNoTodoMarkers, expectTodoMarkersPresent } from '../../helpers/assertions'

describe('createWebApp (integration)', () => {
  let tempDir: string
  let originalCwd: string
  let shellSpy: jest.SpyInstance

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-web-builder-test-${Date.now()}`)
    originalCwd = process.cwd()
    await mkdir(join(tempDir, 'apps'), { recursive: true })
    process.chdir(tempDir)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shellSpy = jest.spyOn(shelljs, 'exec').mockImplementation((() => ({ code: 0, stdout: '10.0.0', stderr: '' })) as any)
  })

  afterEach(async () => {
    shellSpy.mockRestore()
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  // ── Multirepo Tests ─────────────────────────────────────────

  describe('multirepo', () => {
    it('should create Web app in multirepo layout', async () => {
      const result = await createWebApp(webParams())

      expect(result).toBe(true)
      await expectFileExists(join(tempDir, 'apps/test-project-web/src/main.tsx'))
    })

    it('should update package.json with project name', async () => {
      await createWebApp(webParams())

      const pkg = JSON.parse(await readFile(join(tempDir, 'apps/test-project-web/package.json'), 'utf8'))
      expect(pkg.name).toBe('test-project-web')
    })

    it('should call git init for multirepo', async () => {
      await createWebApp(webParams())

      expect(shellSpy).toHaveBeenCalledWith(expect.stringContaining('git init'), expect.anything())
    })
  })

  // ── Monorepo Tests ──────────────────────────────────────────

  describe('monorepo', () => {
    it('should create Web app in monorepo layout (apps/web)', async () => {
      const result = await createWebApp(webParams({ isMonorepo: true }))

      expect(result).toBe(true)
      await expectFileExists(join(tempDir, 'apps/web/src/main.tsx'))
    })

    it('should NOT call git init for monorepo', async () => {
      await createWebApp(webParams({ isMonorepo: true }))

      const gitCalls = shellSpy.mock.calls.filter((call: string[]) => typeof call[0] === 'string' && call[0].includes('git init'))
      expect(gitCalls).toHaveLength(0)
    })

    it('should NOT call npm install for monorepo', async () => {
      await createWebApp(webParams({ isMonorepo: true }))

      const npmCalls = shellSpy.mock.calls.filter((call: string[]) => typeof call[0] === 'string' && call[0].includes('npm install'))
      expect(npmCalls).toHaveLength(0)
    })
  })

  // ── Analytics Module Integration ────────────────────────────

  describe('analytics module', () => {
    it('should keep monitoring TODO markers when includeAnalytics is false', async () => {
      await createWebApp(webParams({ includeAnalytics: false }))

      await expectTodoMarkersPresent(join(tempDir, 'apps/test-project-web/src/main.tsx'), 'monitoring-active')
    })

    it('should activate analytics when includeAnalytics is true', async () => {
      await createWebApp(webParams({ includeAnalytics: true }))

      await expectNoTodoMarkers(join(tempDir, 'apps/test-project-web/src/main.tsx'), 'monitoring-active')
      await expectFileExists(join(tempDir, 'apps/test-project-web/src/lib/analytics'))
    })
  })

  // ── Storage flag ────────────────────────────────────────────

  describe('storage flag in .env', () => {
    it('should keep VITE_STORAGE_ENABLED="false" when s3Setup is manual', async () => {
      await createWebApp(webParams({ s3Setup: 'manual' }))

      await expectFileContains(join(tempDir, 'apps/test-project-web/.env'), 'VITE_STORAGE_ENABLED="false"')
    })

    it('should set VITE_STORAGE_ENABLED="true" when s3Setup is docker', async () => {
      await createWebApp(webParams({ s3Setup: 'docker' }))

      await expectFileContains(join(tempDir, 'apps/test-project-web/.env'), 'VITE_STORAGE_ENABLED="true"')
    })

    it('should set VITE_STORAGE_ENABLED="true" when s3Setup is credentials', async () => {
      await createWebApp(webParams({ s3Setup: 'credentials' }))

      await expectFileContains(join(tempDir, 'apps/test-project-web/.env'), 'VITE_STORAGE_ENABLED="true"')
    })
  })

  // ── Parameterized Matrix ────────────────────────────────────

  describe.each([
    { structure: 'multirepo' as const, isMonorepo: false },
    { structure: 'monorepo' as const, isMonorepo: true }
  ])('$structure × analytics variations', ({ isMonorepo }) => {
    describe.each([{ includeAnalytics: false }, { includeAnalytics: true }])('includeAnalytics=$includeAnalytics', ({ includeAnalytics }) => {
      it('should create Web app successfully', async () => {
        const result = await createWebApp(webParams({ isMonorepo, includeAnalytics }))

        expect(result).toBe(true)
      })
    })
  })
})
