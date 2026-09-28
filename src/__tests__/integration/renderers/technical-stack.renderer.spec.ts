import { access, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import shelljs from 'shelljs'

import * as storageInstaller from '../../../installers/storage.installer'
import { renderTechnicalStack, withTemporaryTechnicalStack } from '../../../renderers/technical-stack.renderer'
import type { Answers, ProjectPorts } from '../../../types'

const ports: ProjectPorts = { db: 5435, api: 3500, web: 5173 }

function config(isMonorepo = true): Answers {
  return {
    profile: 'stack',
    projectName: 'renderer-test',
    projectDescription: 'Technical renderer test',
    isMonorepo,
    setupRepo: 'local',
    mainBranch: 'main',
    backendRepoUrl: '',
    frontendRepoUrl: '',
    dbSetup: 'manual',
    initDb: false,
    emailService: 'none',
    s3Setup: 'manual',
    includeAnalytics: false,
    includePwa: false
  }
}

describe('technical stack renderer', () => {
  let targetDir: string
  let shellSpy: jest.SpyInstance

  beforeEach(async () => {
    targetDir = join(tmpdir(), `sf-technical-renderer-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(targetDir, { recursive: true })
    shellSpy = jest.spyOn(shelljs, 'exec')
  })

  afterEach(async () => {
    shellSpy.mockRestore()
    await rm(targetDir, { recursive: true, force: true })
  })

  it('renders into an explicit directory without changing cwd or running external commands', async () => {
    const cwd = process.cwd()
    const candidate = await renderTechnicalStack({ targetDir, config: config(true), ports })

    expect(process.cwd()).toBe(cwd)
    expect(candidate).toEqual({ rootDir: targetDir, apiPath: join(targetDir, 'apps/api'), webPath: join(targetDir, 'apps/web') })
    await expect(access(join(targetDir, 'apps/api/src/main.ts'))).resolves.toBeUndefined()
    await expect(access(join(targetDir, 'apps/web/src/main.tsx'))).resolves.toBeUndefined()
    await expect(access(join(targetDir, 'package.json'))).resolves.toBeUndefined()
    expect(shellSpy).not.toHaveBeenCalled()
  })

  it('renders the multirepo layout with no Git repository or installed dependencies', async () => {
    await renderTechnicalStack({ targetDir, config: config(false), ports })

    await expect(access(join(targetDir, 'apps/renderer-test-api/package.json'))).resolves.toBeUndefined()
    await expect(access(join(targetDir, 'apps/renderer-test-web/package.json'))).resolves.toBeUndefined()
    await expect(access(join(targetDir, 'apps/renderer-test-api/.git'))).rejects.toThrow()
    await expect(access(join(targetDir, 'apps/renderer-test-web/node_modules'))).rejects.toThrow()
    expect(shellSpy).not.toHaveBeenCalled()
  })

  it('renders requested development services as part of the same candidate', async () => {
    const dockerConfig = config(false)
    dockerConfig.dbSetup = 'docker'
    dockerConfig.dbCredentials = {
      host: 'localhost',
      port: '5435',
      user: 'db_dev_user',
      password: 'db_dev_password',
      database: 'db_dev',
      dbType: 'postgresql'
    }

    const candidate = await renderTechnicalStack({ targetDir, config: dockerConfig, ports })

    await expect(access(join(candidate.apiPath, 'docker-compose.dev-services.yml'))).resolves.toBeUndefined()
    expect(shellSpy).not.toHaveBeenCalled()
  })

  it('keeps storage rendering scoped to the explicit target directory', async () => {
    const storageSpy = jest.spyOn(storageInstaller, 'installStorageModule')
    const storageConfig = config(false)
    storageConfig.s3Setup = 'docker'

    try {
      const candidate = await renderTechnicalStack({ targetDir, config: storageConfig, ports })

      expect(storageSpy).toHaveBeenCalledWith(expect.objectContaining({ webPath: join(targetDir, 'apps/renderer-test-web') }))
      expect(await readFile(join(candidate.webPath, '.env'), 'utf8')).toContain('VITE_STORAGE_ENABLED="true"')
      expect(shellSpy).not.toHaveBeenCalled()
    } finally {
      storageSpy.mockRestore()
    }
  })

  it('always removes a secure temporary candidate after success', async () => {
    let candidatePath = ''
    await withTemporaryTechnicalStack({ config: config(false), ports }, async (candidate) => {
      candidatePath = candidate.rootDir
      await expect(access(candidate.apiPath)).resolves.toBeUndefined()
    })

    await expect(access(candidatePath)).rejects.toThrow()
  })

  it('removes a secure temporary candidate when inspection fails', async () => {
    let candidatePath = ''
    await expect(
      withTemporaryTechnicalStack({ config: config(false), ports }, async (candidate) => {
        candidatePath = candidate.rootDir
        throw new Error('inspection failed')
      })
    ).rejects.toThrow('inspection failed')

    await expect(access(candidatePath)).rejects.toThrow()
  })
})
