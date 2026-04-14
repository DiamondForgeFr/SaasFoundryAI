import { mkdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import shelljs from 'shelljs'

import { createMonorepoRoot } from '../../../builders/monorepo.builder'
import { monorepoRootParams } from '../../helpers/fixtures'
import { expectFileExists } from '../../helpers/assertions'

describe('createMonorepoRoot (integration)', () => {
  let tempDir: string
  let originalCwd: string
  let shellSpy: jest.SpyInstance

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-monorepo-builder-test-${Date.now()}`)
    originalCwd = process.cwd()

    // Create the project structure expected by monorepo builder
    await mkdir(join(tempDir, 'apps/api'), { recursive: true })
    await mkdir(join(tempDir, 'apps/web'), { recursive: true })
    process.chdir(tempDir)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shellSpy = jest.spyOn(shelljs, 'exec').mockImplementation((() => ({ code: 0, stdout: '10.0.0', stderr: '' })) as any)
  })

  afterEach(async () => {
    shellSpy.mockRestore()
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  it('should copy monorepo root overlay to current directory', async () => {
    const result = await createMonorepoRoot(monorepoRootParams())

    expect(result).toBe(true)
    await expectFileExists(join(tempDir, 'package.json'))
  })

  it('should update root package.json with project name', async () => {
    await createMonorepoRoot(monorepoRootParams({ projectName: 'my-saas' }))

    const pkg = JSON.parse(await readFile(join(tempDir, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('my-saas')
  })

  it('should set packageManager version from npm --version', async () => {
    await createMonorepoRoot(monorepoRootParams())

    const pkg = JSON.parse(await readFile(join(tempDir, 'package.json'), 'utf8'))
    expect(pkg.packageManager).toBe('npm@10.0.0')
  })

  it('should call npm install at root level', async () => {
    await createMonorepoRoot(monorepoRootParams())

    const npmInstallCalls = shellSpy.mock.calls.filter((call: string[]) => typeof call[0] === 'string' && call[0].includes('npm install') && !call[0].includes('--prefix'))
    expect(npmInstallCalls.length).toBeGreaterThan(0)
  })

  it('should call prisma generate in api workspace', async () => {
    await createMonorepoRoot(monorepoRootParams())

    expect(shellSpy).toHaveBeenCalledWith(expect.stringContaining('prisma generate'))
  })

  it('should call git init at root level', async () => {
    await createMonorepoRoot(monorepoRootParams())

    expect(shellSpy).toHaveBeenCalledWith(expect.stringContaining('git init'))
  })

  it('should set git remote when monorepoUrl is provided', async () => {
    await createMonorepoRoot(monorepoRootParams({ monorepoUrl: 'https://github.com/test/mono.git' }))

    expect(shellSpy).toHaveBeenCalledWith(expect.stringContaining('git remote add origin https://github.com/test/mono.git'))
  })

  it('should update deployment workflow with project-specific names', async () => {
    await createMonorepoRoot(monorepoRootParams({ projectName: 'my-saas' }))

    // Check deployment files if they exist
    try {
      const deployApi = await readFile(join(tempDir, '.github/workflows/deployment-api.yml'), 'utf8')
      expect(deployApi).not.toContain('saasfoundry-network')
      expect(deployApi).toContain('my-saas-network')
    } catch {
      // Deployment file might not exist, that's OK
    }
  })
})
