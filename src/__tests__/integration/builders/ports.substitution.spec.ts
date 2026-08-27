import { mkdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import shelljs from 'shelljs'

import { createApiApp } from '../../../builders/api.builder'
import { createDbApp } from '../../../builders/db.builder'
import { createMonorepoRoot } from '../../../builders/monorepo.builder'
import { createWebApp } from '../../../builders/web.builder'
import { apiParams, monorepoRootParams, webParams } from '../../helpers/fixtures'

/**
 * #584 — every generated file that names a port must name the one this project was given.
 *
 * The ports below are deliberately not the defaults. A substitution that was forgotten
 * shows up as a 3500 or a 5173 surviving into the output, which is what these tests look
 * for: asserting only the presence of the new port would pass on a file that carries both.
 */

const PORTS = { db: 5444, api: 3501, web: 5174 }

describe('the generated project carries the ports it was given (#584)', () => {
  let tempDir: string
  let originalCwd: string
  let shellSpy: jest.SpyInstance

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-ports-${Date.now()}`)
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

  const read = (relative: string) => readFile(join(tempDir, relative), 'utf8')

  describe('the API side', () => {
    const apiDir = 'apps/test-project-api'

    beforeEach(async () => {
      await createApiApp(apiParams({ ports: PORTS }))
    })

    it('serves on the chosen port and points at the chosen frontend', async () => {
      const env = await read(`${apiDir}/.env`)

      expect(env).toContain('PORT="3501"')
      expect(env).toContain('FRONTEND_URL="http://localhost:5174"')
      expect(env).not.toContain('PORT="3500"')
      expect(env).not.toContain('localhost:5173')
    })

    it('keeps the JWT secrets and the database URL it already wrote', async () => {
      const env = await read(`${apiDir}/.env`)

      expect(env).toMatch(/JWT_SECRET_AUTH="\w+"/)
      expect(env).toContain('@localhost:5435/db_dev')
    })

    it('carries the port into the test environment too', async () => {
      const envTest = await read(`${apiDir}/.env.test`)

      expect(envTest).toContain('PORT="3501"')
      expect(envTest).toContain('FRONTEND_URL="http://localhost:5174"')
    })

    it('publishes and listens on the same port in the compose', async () => {
      const compose = await read(`${apiDir}/docker-compose.yml`)

      // env_file puts PORT inside the container: a 3501:3500 mapping would publish a dead port.
      expect(compose).toContain("'${BACKEND_PORT:-3501}:3501'")
      expect(compose).toContain('http://localhost:3501/api/health')
      expect(compose).not.toContain('3500')
    })

    it('builds an image that listens on it', async () => {
      expect(await read(`${apiDir}/Dockerfile`)).toContain('ENV PORT=3501')
    })

    it('falls back to it when PORT is unset', async () => {
      const envService = await read(`${apiDir}/src/configs/env/services/env.service.ts`)

      expect(envService).toContain("PORT: z.string().default('3501')")
    })

    it('documents it', async () => {
      expect(await read(`${apiDir}/README.md`)).toContain('http://localhost:3501/api/docs')
    })

    it('deploys with it', async () => {
      const deployment = await read(`${apiDir}/.github/workflows/deployment.yml`)

      expect(deployment).toContain('PORT=\\"3501\\"')
      expect(deployment).toContain("'/ports:/,/3501/d'")
    })
  })

  describe('the web side', () => {
    const webDir = 'apps/test-project-web'

    beforeEach(async () => {
      await createWebApp(webParams({ ports: PORTS }))
    })

    it('calls the API on its chosen port', async () => {
      const env = await read(`${webDir}/.env`)

      expect(env).toContain('VITE_BASE_API_URL="http://localhost:3501"')
      expect(env).toContain('FRONTEND_PORT="5174"')
      expect(env).not.toContain('3500')
    })

    it('carries both into the test environment', async () => {
      const envTest = await read(`${webDir}/.env.test`)

      expect(envTest).toContain('VITE_BASE_API_URL="http://localhost:3501"')
      expect(envTest).toContain('FRONTEND_PORT="5174"')
    })

    it('tells Vite which port to serve on, and refuses to drift off it', async () => {
      const viteConfig = await read(`${webDir}/vite.config.ts`)

      expect(viteConfig).toContain('port: 5174')
      expect(viteConfig).toContain('strictPort: true')
      expect(viteConfig).toContain('clientPort: 5174')
      expect(viteConfig).not.toContain('5173')
    })

    it('runs its e2e debug server against it', async () => {
      const playwright = await read(`${webDir}/playwright.config.ts`)

      expect(playwright).toContain('http://localhost:5174')
      expect(playwright).not.toContain('localhost:5173')
    })

    it('proxies to the API container on its port', async () => {
      expect(await read(`${webDir}/nginx.conf`)).toContain(':3501;')
    })

    it('documents it for the AI', async () => {
      expect(await read(`${webDir}/CLAUDE.md`)).toContain('port 5174')
    })
  })

  describe('the database side', () => {
    it('publishes the chosen port, moving only the host side', async () => {
      await createDbApp({
        isMonorepo: false,
        projectName: 'test-project',
        dbCredentials: { host: 'localhost', port: '5444', user: 'u', password: 'p', database: 'd', dbType: 'postgresql' }
      })

      const compose = await read('apps/test-project-db/docker-compose.db.yml')

      expect(compose).toContain("'5444:5432'")
      expect(compose).not.toContain("'5435:5432'")
    })
  })

  describe('the monorepo root', () => {
    it('waits on the API port before starting Vite, and documents the right docs URL', async () => {
      await createWebApp(webParams({ isMonorepo: true, ports: PORTS }))
      await createMonorepoRoot(monorepoRootParams({ ports: PORTS }))

      const webPackageJson = await read('apps/web/package.json')
      expect(webPackageJson).toContain('tcp:3501')
      expect(webPackageJson).not.toContain('tcp:3500')

      expect(await read('CLAUDE.md')).toContain('http://localhost:3501/api/docs')
    })

    it('deploys the API with the same port', async () => {
      await createMonorepoRoot(monorepoRootParams({ ports: PORTS }))

      const deployment = await read('.github/workflows/deployment-api.yml')
      expect(deployment).toContain('PORT=\\"3501\\"')
      expect(deployment).toContain("'/ports:/,/3501/d'")
    })
  })

  describe('without a ports block', () => {
    it('writes exactly what it wrote before — the defaults a pre-#584 project runs on', async () => {
      await createApiApp(apiParams())
      await createWebApp(webParams())

      expect(await read('apps/test-project-api/.env')).toContain('PORT="3500"')
      expect(await read('apps/test-project-web/.env')).toContain('VITE_BASE_API_URL="http://localhost:3500"')
      expect(await read('apps/test-project-web/vite.config.ts')).toContain('port: 5173')
    })
  })
})
