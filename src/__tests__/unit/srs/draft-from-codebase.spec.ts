import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runDraftFromCodebase } from '../../../srs/bin/draft-from-codebase'

describe('runDraftFromCodebase', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-srs-codebase-'))
  })

  const writeManifest = (body: unknown): string => {
    const p = join(tmp, '.saasfoundry.json')
    writeFileSync(p, JSON.stringify(body))
    return p
  }

  it('emits an empty findings list on a bare project', async () => {
    const stdout: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })
    const manifestPath = writeManifest({ tools: { srs: { backend: 'notion' } } })

    const code = await runDraftFromCodebase({ scanPath: tmp, manifestPath })

    expect(code).toBe(0)
    const body = JSON.parse(stdout.join(''))
    expect(body.source).toBe('codebase')
    expect(body.findings).toEqual([])
  })

  it('returns 2 when --path points to a missing directory', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: { srs: { backend: 'notion' } } })

    const code = await runDraftFromCodebase({ scanPath: join(tmp, 'does-not-exist'), manifestPath })

    expect(code).toBe(2)
  })

  it('returns 2 when --path points to a file', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const filePath = join(tmp, 'not-a-dir.txt')
    writeFileSync(filePath, 'hello')
    const manifestPath = writeManifest({ tools: { srs: { backend: 'notion' } } })

    const code = await runDraftFromCodebase({ scanPath: filePath, manifestPath })

    expect(code).toBe(2)
  })

  it('returns 2 when the manifest JSON is malformed', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = join(tmp, '.saasfoundry.json')
    writeFileSync(manifestPath, '{ not valid json')

    const code = await runDraftFromCodebase({ scanPath: tmp, manifestPath })

    expect(code).toBe(2)
  })

  it('returns 3 when tools.srs.backend is missing', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: {} })

    const code = await runDraftFromCodebase({ scanPath: tmp, manifestPath })

    expect(code).toBe(3)
  })

  it('returns 4 when the backend is unknown', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const manifestPath = writeManifest({ tools: { srs: { backend: 'confluence' } } })

    const code = await runDraftFromCodebase({ scanPath: tmp, manifestPath })

    expect(code).toBe(4)
  })

  it('falls back to process.cwd() when scanPath is empty', async () => {
    const stdout: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })
    const originalCwd = process.cwd()
    process.chdir(tmp)
    try {
      const manifestPath = writeManifest({ tools: { srs: { backend: 'notion' } } })
      const code = await runDraftFromCodebase({ scanPath: '', manifestPath })
      expect(code).toBe(0)
      const body = JSON.parse(stdout.join(''))
      expect(body.findings).toEqual([])
    } finally {
      process.chdir(originalCwd)
    }
  })

  it('respects .gitignore when walking the scan tree', async () => {
    const stdout: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })
    mkdirSync(join(tmp, 'src'))
    writeFileSync(join(tmp, 'src', 'a.ts'), 'export const a = 1')
    writeFileSync(join(tmp, 'src', 'b.log'), 'ignored')
    writeFileSync(join(tmp, '.gitignore'), '*.log\n')
    const manifestPath = writeManifest({ tools: { srs: { backend: 'notion' } } })

    const code = await runDraftFromCodebase({ scanPath: tmp, manifestPath })

    expect(code).toBe(0)
    // No scanners registered yet, but the walker must run end-to-end without errors.
    const body = JSON.parse(stdout.join(''))
    expect(body.source).toBe('codebase')
    expect(body.findings).toEqual([])
  })

  it('excludes node_modules / dist / coverage / .git even without .gitignore', async () => {
    const stdout: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })
    for (const dir of ['node_modules', 'dist', 'coverage', '.git']) {
      mkdirSync(join(tmp, dir))
      writeFileSync(join(tmp, dir, 'blob.ts'), 'ignored')
    }
    const manifestPath = writeManifest({ tools: { srs: { backend: 'notion' } } })

    const code = await runDraftFromCodebase({ scanPath: tmp, manifestPath })

    expect(code).toBe(0)
    const body = JSON.parse(stdout.join(''))
    expect(body.findings).toEqual([])
  })

  it('emits endpoint + ui-flow findings for a monorepo scanned end-to-end', async () => {
    const stdout: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })
    // api/ side
    mkdirSync(join(tmp, 'api', 'src', 'modules', 'users'), { recursive: true })
    writeFileSync(
      join(tmp, 'api', 'src', 'modules', 'users', 'users.controller.ts'),
      `
      @Controller('users')
      export class UsersController {
        @Get()
        findAll() {}
      }
    `
    )
    // web/ side
    mkdirSync(join(tmp, 'web', 'src', 'router'), { recursive: true })
    writeFileSync(
      join(tmp, 'web', 'src', 'router', 'routes.tsx'),
      `
      export const routes = [
        { path: '/users', element: LazyRouteElement(UsersPage) }
      ]
    `
    )
    mkdirSync(join(tmp, 'web', 'src', 'pages', 'private'), { recursive: true })
    writeFileSync(
      join(tmp, 'web', 'src', 'pages', 'private', 'UsersPage.tsx'),
      `
      export function UsersPage() {
        return <div>users</div>
      }
    `
    )
    const manifestPath = writeManifest({ structure: 'monorepo', tools: { srs: { backend: 'notion' } } })

    const code = await runDraftFromCodebase({ scanPath: tmp, manifestPath })

    expect(code).toBe(0)
    const body = JSON.parse(stdout.join(''))
    const kinds = body.findings.map((f: { kind: string }) => f.kind).sort()
    expect(kinds).toEqual(['endpoint', 'ui-flow'])
    const endpoint = body.findings.find((f: { kind: string }) => f.kind === 'endpoint')
    expect(endpoint).toMatchObject({
      method: 'GET',
      path: '/users',
      area: 'users',
      file: 'api/src/modules/users/users.controller.ts'
    })
    const uiFlow = body.findings.find((f: { kind: string }) => f.kind === 'ui-flow')
    expect(uiFlow).toMatchObject({
      title: 'UsersPage (private/UsersPage)',
      route: '/users',
      linkedEndpointGuess: 'users'
    })
  })

  it('emits findings for a multirepo api at the scan root', async () => {
    const stdout: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })
    mkdirSync(join(tmp, 'src', 'modules', 'auth'), { recursive: true })
    writeFileSync(
      join(tmp, 'src', 'modules', 'auth', 'auth.controller.ts'),
      `
      @Controller('auth')
      export class AuthController {
        @Post('login')
        login() {}
      }
    `
    )
    const manifestPath = writeManifest({ structure: 'multirepo', tools: { srs: { backend: 'notion' } } })

    const code = await runDraftFromCodebase({ scanPath: tmp, manifestPath })

    expect(code).toBe(0)
    const body = JSON.parse(stdout.join(''))
    expect(body.findings).toHaveLength(1)
    expect(body.findings[0]).toMatchObject({
      kind: 'endpoint',
      method: 'POST',
      path: '/auth/login',
      area: 'auth'
    })
  })
})
