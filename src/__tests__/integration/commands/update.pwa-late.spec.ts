import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import shelljs from 'shelljs'

import { updateCommand } from '../../../commands/update'
import { targetManifestVersion } from '../../../migrations/manifest/registry'
import { manifestSchemaUrl, type SaaSFoundryManifest } from '../../../types'
import { computeFileHashes, hashFileContent } from '../../../utils'
import { version as cliVersion } from '../../../../package.json'

jest.mock('../../../utils', () => ({
  ...jest.requireActual('../../../utils'),
  checkNodeVersion: jest.fn()
}))

jest.mock('ora', () => () => {
  const spinner: Record<string, unknown> = { text: '', succeed: jest.fn(), fail: jest.fn(), stop: jest.fn() }
  spinner.start = jest.fn(() => spinner)
  return spinner
})

describe('late PWA installation', () => {
  let root: string
  let originalCwd: string
  let shellSpy: jest.SpyInstance
  let logSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance
  let exitSpy: jest.SpyInstance

  beforeEach(async () => {
    root = join(tmpdir(), `sf-pwa-late-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    originalCwd = process.cwd()
    await mkdir(join(root, 'apps/web'), { recursive: true })
    process.chdir(root)
    shellSpy = jest.spyOn(shelljs, 'exec').mockImplementation((() => ({ code: 0, stdout: '', stderr: '' })) as never)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never)
  })

  afterEach(async () => {
    shellSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
    exitSpy.mockRestore()
    process.chdir(originalCwd)
    await rm(root, { recursive: true, force: true }).catch(() => {})
  })

  it('preserves text and binary collisions without claiming the module is installed', async () => {
    const packageJson = `${JSON.stringify({ name: 'web', devDependencies: {} }, null, 2)}\n`
    const viteConfig = "import { defineConfig, loadEnv } from 'vite'\n\nexport default defineConfig({ plugins: [] })\n"
    const indexHtml = '<html><head>\n  <meta name="viewport" content="width=device-width" />\n</head></html>\n'
    await writeFile('apps/web/package.json', packageJson)
    await writeFile('apps/web/vite.config.ts', viteConfig)
    await writeFile('apps/web/index.html', indexHtml)
    await writeFile('apps/web/pwa.config.ts', 'export const pwaOptions = { userOwned: true }\n')
    await mkdir('apps/web/public', { recursive: true })
    const userIcon = Buffer.from([0, 1, 2, 3, 4])
    await writeFile('apps/web/public/pwa-192x192.png', userIcon)

    const manifest: SaaSFoundryManifest = {
      $schema: manifestSchemaUrl,
      manifestVersion: targetManifestVersion(),
      version: cliVersion,
      generatedAt: new Date().toISOString(),
      structure: 'monorepo',
      projectName: 'late-pwa',
      mainBranch: 'main',
      modules: {
        email: { provider: 'none', version: 1 },
        s3Setup: 'manual',
        dbSetup: 'manual',
        includeAnalytics: false,
        advancedSkills: []
      },
      fileHashes: {
        'apps/web/package.json': hashFileContent(packageJson),
        'apps/web/vite.config.ts': hashFileContent(viteConfig),
        'apps/web/index.html': hashFileContent(indexHtml)
      },
      unmanagedPaths: ['apps/web/pwa.config.ts']
    }
    await writeFile('.saasfoundry.json', `${JSON.stringify(manifest, null, 2)}\n`)

    await expect(updateCommand({ nonInteractive: true, addModules: 'pwa' })).rejects.toThrow('process.exit(1)')

    expect(await readFile('apps/web/pwa.config.ts', 'utf8')).toBe('export const pwaOptions = { userOwned: true }\n')
    expect(await readFile('apps/web/pwa.config.ts.saasfoundry.new', 'utf8')).toContain('late-pwa')
    expect(await readFile('apps/web/public/pwa-192x192.png')).toEqual(userIcon)
    expect(await readFile('apps/web/public/pwa-192x192.png.saasfoundry.new')).toEqual(await readFile(resolve(__dirname, '../../../../scaffolds/overlays/modules/pwa/public/pwa-192x192.png')))
    expect(JSON.parse(await readFile('apps/web/package.json', 'utf8')).devDependencies['vite-plugin-pwa']).toBe('1.3.0')
    const saved = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    expect(saved.modules.pwa).toBeUndefined()
    expect(saved.unmanagedPaths).toContain('apps/web/pwa.config.ts')
    expect(saved.fileHashes['apps/web/pwa.config.ts']).toBeUndefined()
    expect(shellSpy).not.toHaveBeenCalled()
  })

  it('stamps the module and installs dependencies after a conflict-free apply', async () => {
    const packageJson = `${JSON.stringify({ name: 'web', devDependencies: {} }, null, 2)}\n`
    const viteConfig = "import { defineConfig, loadEnv } from 'vite'\n\nexport default defineConfig({ plugins: [] })\n"
    const indexHtml = '<html><head>\n  <meta name="viewport" content="width=device-width" />\n</head></html>\n'
    await writeFile('apps/web/package.json', packageJson)
    await writeFile('apps/web/vite.config.ts', viteConfig)
    await writeFile('apps/web/index.html', indexHtml)
    const manifest: SaaSFoundryManifest = {
      $schema: manifestSchemaUrl,
      manifestVersion: targetManifestVersion(),
      version: cliVersion,
      generatedAt: new Date().toISOString(),
      structure: 'monorepo',
      projectName: 'late-pwa',
      mainBranch: 'main',
      modules: { email: { provider: 'none', version: 1 }, s3Setup: 'manual', dbSetup: 'manual', includeAnalytics: false, advancedSkills: [] },
      fileHashes: {
        'apps/web/package.json': hashFileContent(packageJson),
        'apps/web/vite.config.ts': hashFileContent(viteConfig),
        'apps/web/index.html': hashFileContent(indexHtml)
      }
    }
    await writeFile('.saasfoundry.json', `${JSON.stringify(manifest, null, 2)}\n`)

    await updateCommand({ nonInteractive: true, addModules: 'pwa' })

    const saved = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    expect(saved.modules.pwa).toEqual({ version: 1 })
    expect(shellSpy).toHaveBeenCalledWith(expect.stringContaining('npm install'), expect.any(Object))
  })

  it('rejects a repository-controlled project name before deriving paths or running commands', async () => {
    const manifest: SaaSFoundryManifest = {
      $schema: manifestSchemaUrl,
      manifestVersion: targetManifestVersion(),
      version: cliVersion,
      generatedAt: new Date().toISOString(),
      structure: 'multirepo',
      projectName: 'unsafe;touch-pwned',
      mainBranch: 'main',
      modules: { email: { provider: 'none', version: 1 }, s3Setup: 'manual', dbSetup: 'manual', includeAnalytics: false, advancedSkills: [] },
      fileHashes: {}
    }
    await writeFile('.saasfoundry.json', `${JSON.stringify(manifest, null, 2)}\n`)

    await expect(updateCommand({ nonInteractive: true, addModules: 'pwa' })).rejects.toThrow(/Invalid project name/)
    expect(shellSpy).not.toHaveBeenCalled()
  })

  it('does not stamp PWA installed when the Vite registration cannot be applied', async () => {
    const packageJson = `${JSON.stringify({ name: 'web', devDependencies: {} }, null, 2)}\n`
    await writeFile('apps/web/package.json', packageJson)
    await writeFile('apps/web/vite.config.ts', 'import { defineConfig } from "vite"\nexport default defineConfig({ plugins: makePlugins() })\n')
    await writeFile('apps/web/index.html', '<html><head><meta name="viewport" content="width=device-width" /></head></html>\n')
    const manifest: SaaSFoundryManifest = {
      $schema: manifestSchemaUrl,
      manifestVersion: targetManifestVersion(),
      version: cliVersion,
      generatedAt: new Date().toISOString(),
      structure: 'monorepo',
      projectName: 'late-pwa',
      mainBranch: 'main',
      modules: { email: { provider: 'none', version: 1 }, s3Setup: 'manual', dbSetup: 'manual', includeAnalytics: false, advancedSkills: [] },
      fileHashes: await computeFileHashes('.')
    }
    await writeFile('.saasfoundry.json', `${JSON.stringify(manifest, null, 2)}\n`)

    await expect(updateCommand({ nonInteractive: true, addModules: 'pwa' })).rejects.toThrow('process.exit(1)')
    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/could not safely register VitePWA/) }))
    const saved = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    expect(saved.modules.pwa).toBeUndefined()
    expect(shellSpy).not.toHaveBeenCalled()
  })
})
