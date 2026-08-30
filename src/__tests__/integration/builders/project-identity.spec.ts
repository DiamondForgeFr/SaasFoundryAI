import { mkdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import shelljs from 'shelljs'

import glob from 'glob'

import { createApiApp } from '../../../builders/api.builder'
import { createDevServicesCompose } from '../../../builders/dev-services.builder'
import { createWebApp } from '../../../builders/web.builder'
import { applyProjectIdentity } from '../../../utils'
import { apiParams, webParams } from '../../helpers/fixtures'

/**
 * #606 — nginx proxied to a host called `saasfoundry-api`, which no generated project
 * creates. The renaming was done by hand at fourteen sites across six builders, each
 * covering a different subset, and `nginx.conf` was in none of them.
 *
 * A build could not see it: the file is served by a container, and the proxy only fails
 * when the two containers actually run. So the guard below is a text one — it asks the
 * generated tree whether any scaffold-owned name survived, which is the question the
 * fourteen partial lists could not answer.
 */

describe('applyProjectIdentity', () => {
  it('renames a scaffold resource to the project', () => {
    expect(applyProjectIdentity('http://saasfoundry-api:3500', 'acme')).toBe('http://acme-api:3500')
  })

  it('renames every resource kind the blueprints declare', () => {
    const names = ['saasfoundry-network', 'saasfoundry-api', 'saasfoundry-web', 'saasfoundry-db-test', 'saasfoundry-s3-init', 'saasfoundry-db-dev']

    expect(applyProjectIdentity(names.join(' '), 'acme')).toBe('acme-network acme-api acme-web acme-db-test acme-s3-init acme-db-dev')
  })

  /**
   * The hyphen is what separates a resource name from a mention of the tool. Without it,
   * this rule would rewrite the manifest filename and the package name.
   */
  it.each(['.saasfoundry.json', 'saasfoundryai-cli', 'https://github.com/agachet/saasfoundry.git', 'saasfoundry'])('leaves %s alone', (text) => {
    expect(applyProjectIdentity(text, 'acme')).toBe(text)
  })
})

describe('no scaffold-owned name survives generation (#606)', () => {
  let tempDir: string
  let originalCwd: string
  let shellSpy: jest.SpyInstance

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-identity-${Date.now()}`)
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

  it('the API container name nginx dials is the one the API compose declares', async () => {
    await createApiApp(apiParams())
    await createWebApp(webParams())

    const nginx = await readFile(join(tempDir, 'apps/test-project-web/nginx.conf'), 'utf8')
    const apiCompose = await readFile(join(tempDir, 'apps/test-project-api/docker-compose.yml'), 'utf8')

    expect(nginx).toContain('proxy_pass http://test-project-api:')
    expect(apiCompose).toContain('container_name: test-project-api')
    expect(nginx).not.toContain('saasfoundry')
  })

  it('leaves no saasfoundry-<name> anywhere in the generated tree', async () => {
    await createApiApp(apiParams())
    await createWebApp(webParams())
    await createDevServicesCompose({
      apiPath: 'apps/test-project-api',
      projectName: 'test-project',
      dbSetup: 'docker',
      dbCredentials: { host: 'localhost', port: '5435', user: 'u', password: 'p', database: 'd', dbType: 'postgresql' },
      s3Setup: 'docker',
      s3Credentials: { endpoint: '', accessKey: 'k', secretKey: 's', bucket: 'my-own-bucket', region: 'r' }
    })

    const files = glob.sync('apps/**/*', { cwd: tempDir, nodir: true, ignore: ['**/node_modules/**', '**/.git/**'] })
    const survivors: string[] = []

    for (const relative of files) {
      let content: string
      try {
        content = await readFile(join(tempDir, relative), 'utf8')
      } catch {
        continue // binary or unreadable — not our concern
      }
      for (const match of content.match(/saasfoundry-[a-z0-9-]+/g) ?? []) survivors.push(`${relative}: ${match}`)
    }

    expect(files.length).toBeGreaterThan(50)
    expect(survivors).toEqual([])
  })

  it('keeps a bucket the user named, rather than renaming it to the project', async () => {
    await createDevServicesCompose({
      apiPath: 'apps',
      projectName: 'test-project',
      dbSetup: 'manual',
      s3Setup: 'docker',
      s3Credentials: { endpoint: '', accessKey: 'k', secretKey: 's', bucket: 'my-own-bucket', region: 'r' }
    })

    const compose = await readFile(join(tempDir, 'apps/docker-compose.dev-services.yml'), 'utf8')

    // The bucket comes from credentials, not from the project name — the one thing the
    // generic rename must not touch.
    expect(compose).toContain('myminio/my-own-bucket')
    expect(compose).not.toContain('test-project-uploads')
  })
})
