import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runDraftFromCodebase } from '../../../srs/bin/draft-from-codebase'
import { DocContextFinding, EndpointFinding, EntityFinding, ScannerFinding, TestFinding, UiFlowFinding } from '../../../srs/scanners/types'

interface CodebaseOutput {
  source: 'codebase'
  findings: ScannerFinding[]
}

const seed = (absPath: string, content: string): void => {
  mkdirSync(join(absPath, '..'), { recursive: true })
  writeFileSync(absPath, content)
}

const buildCompositeMonorepo = (root: string): void => {
  // ─── api ────────────────────────────────────────────────────────────────
  // auth module: controller + service + unit spec + e2e spec
  mkdirSync(join(root, 'api', 'src', 'modules', 'auth', 'tests', 'unit'), { recursive: true })
  mkdirSync(join(root, 'api', 'src', 'modules', 'auth', 'tests', 'e2e'), { recursive: true })
  seed(
    join(root, 'api', 'src', 'modules', 'auth', 'auth.controller.ts'),
    `
    import { Controller, Post, Get, Body } from '@nestjs/common'

    @Controller('auth')
    export class AuthController {
      @Post('signin')
      signIn(@Body() dto: SignInDto) {}

      @Post('signup')
      signUp(@Body() dto: SignUpDto) {}

      @Get('me')
      me() {}
    }
    `
  )
  seed(
    join(root, 'api', 'src', 'modules', 'auth', 'tests', 'unit', 'auth.service.spec.ts'),
    `
    describe('AuthService', () => {
      it('hashes passwords with bcrypt', () => {})
      it('rejects expired refresh tokens', () => {})
    })
    `
  )
  seed(
    join(root, 'api', 'src', 'modules', 'auth', 'tests', 'e2e', 'signin.e2e.ts'),
    `
    describe('POST /auth/signin', () => {
      it('returns 200 + session cookie on valid credentials', () => {})
      it('returns 401 on invalid credentials', () => {})
    })
    `
  )

  // storage module: controller + unit spec
  mkdirSync(join(root, 'api', 'src', 'modules', 'storage', 'tests', 'unit'), { recursive: true })
  seed(
    join(root, 'api', 'src', 'modules', 'storage', 'storage.controller.ts'),
    `
    import { Controller, Post, Get, Delete } from '@nestjs/common'

    @Controller('storage')
    export class StorageController {
      @Post('upload')
      upload() {}

      @Get(':id')
      download() {}

      @Delete(':id')
      remove() {}
    }
    `
  )
  seed(
    join(root, 'api', 'src', 'modules', 'storage', 'tests', 'unit', 'storage.service.spec.ts'),
    `
    describe('StorageService', () => {
      it('uploads to S3 and returns a signed URL', () => {})
    })
    `
  )

  // Prisma multi-file schemas
  mkdirSync(join(root, 'api', 'prisma', 'schema'), { recursive: true })
  seed(
    join(root, 'api', 'prisma', 'schema', 'auth.prisma'),
    `
    model User {
      id           String   @id @default(cuid())
      email        String   @unique
      passwordHash String
      createdAt    DateTime @default(now())
      sessions     Session[]
    }

    model Session {
      id        String   @id @default(cuid())
      userId    String
      user      User     @relation(fields: [userId], references: [id])
      expiresAt DateTime
    }
    `
  )
  seed(
    join(root, 'api', 'prisma', 'schema', 'storage.prisma'),
    `
    model File {
      id        String   @id @default(cuid())
      key       String   @unique
      size      Int
      ownerId   String
    }
    `
  )

  // ─── web ────────────────────────────────────────────────────────────────
  mkdirSync(join(root, 'web', 'src', 'router'), { recursive: true })
  seed(
    join(root, 'web', 'src', 'router', 'routes.tsx'),
    `
    export const routes = [
      { path: '/signin', element: LazyRouteElement(SignInPage) },
      { path: '/signup', element: LazyRouteElement(SignUpPage) },
      { path: '/files', element: LazyRouteElement(FilesPage) }
    ]
    `
  )
  mkdirSync(join(root, 'web', 'src', 'pages', 'public'), { recursive: true })
  mkdirSync(join(root, 'web', 'src', 'pages', 'private'), { recursive: true })
  seed(
    join(root, 'web', 'src', 'pages', 'public', 'SignInPage.tsx'),
    `
    export function SignInPage() {
      return (
        <form>
          <input name="email" />
          <input name="password" type="password" />
          <button type="submit">Sign in</button>
        </form>
      )
    }
    `
  )
  seed(
    join(root, 'web', 'src', 'pages', 'public', 'SignUpPage.tsx'),
    `
    export function SignUpPage() {
      return (
        <form>
          <input name="email" />
          <input name="password" type="password" />
        </form>
      )
    }
    `
  )
  seed(
    join(root, 'web', 'src', 'pages', 'private', 'FilesPage.tsx'),
    `
    export function FilesPage() {
      return <div>files</div>
    }
    `
  )
  seed(
    join(root, 'web', 'src', 'pages', 'public', 'SignInPage.spec.tsx'),
    `
    describe('SignInPage', () => {
      it('submits credentials to /auth/signin', () => {})
    })
    `
  )

  // ─── docs ───────────────────────────────────────────────────────────────
  seed(
    join(root, 'README.md'),
    `# Composite SaaS
A SaaS platform with auth and file storage modules.

## Features
Sign in, sign up, upload files.
`
  )
  seed(
    join(root, 'CLAUDE.md'),
    `# AI rules
Follow the workflow in .claude/skills/sf-workflow/.
`
  )
  mkdirSync(join(root, 'docs'), { recursive: true })
  seed(
    join(root, 'docs', 'auth.md'),
    `# Authentication
Email + password sign-in with refresh tokens.

## Security
Passwords are hashed with bcrypt.
`
  )
  seed(join(root, 'api', 'README.md'), `# API\nBackend service.`)
  seed(join(root, 'web', 'README.md'), `# Web\nFrontend app.`)
}

const writeManifest = (root: string, body: unknown): string => {
  const p = join(root, '.saasfoundry.json')
  writeFileSync(p, JSON.stringify(body))
  return p
}

describe('draft-from-codebase integration — composite monorepo fixture', () => {
  let tmp: string
  let output: CodebaseOutput
  let findings: ScannerFinding[]

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-srs-integration-'))
    buildCompositeMonorepo(tmp)
    const manifestPath = writeManifest(tmp, { structure: 'monorepo', tools: { srs: { backend: 'notion' } } })

    const stdout: string[] = []
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })
    const code = await runDraftFromCodebase({ scanPath: tmp, manifestPath })
    stdoutSpy.mockRestore()

    expect(code).toBe(0)
    output = JSON.parse(stdout.join('')) as CodebaseOutput
    findings = output.findings
  })

  it('emits all 5 finding kinds', () => {
    expect(output.source).toBe('codebase')
    const kinds = new Set(findings.map((f) => f.kind))
    expect(kinds).toEqual(new Set(['endpoint', 'ui-flow', 'entity', 'test', 'doc-context']))
  })

  it('discovers every declared REST endpoint across both modules', () => {
    const endpoints = findings.filter((f): f is EndpointFinding => f.kind === 'endpoint')
    const signatures = endpoints.map((e) => `${e.method} ${e.path}`).sort()
    expect(signatures).toEqual(['DELETE /storage/:id', 'GET /auth/me', 'GET /storage/:id', 'POST /auth/signin', 'POST /auth/signup', 'POST /storage/upload'])
    const areas = new Set(endpoints.map((e) => e.area))
    expect(areas).toEqual(new Set(['auth', 'storage']))
  })

  it('marks endpoints that have unit specs with hasTests=true', () => {
    const endpoints = findings.filter((f): f is EndpointFinding => f.kind === 'endpoint')
    const authEndpoints = endpoints.filter((e) => e.area === 'auth')
    expect(authEndpoints.every((e) => e.hasTests === true)).toBe(true)
    const storageEndpoints = endpoints.filter((e) => e.area === 'storage')
    expect(storageEndpoints.every((e) => e.hasTests === true)).toBe(true)
  })

  it('captures the 3 React pages with route + endpoint link guess', () => {
    const uiFlows = findings.filter((f): f is UiFlowFinding => f.kind === 'ui-flow')
    expect(uiFlows).toHaveLength(3)

    const byTitle = Object.fromEntries(uiFlows.map((f) => [f.title, f]))
    expect(byTitle['SignInPage (public/SignInPage)'].route).toBe('/signin')
    expect(byTitle['SignInPage (public/SignInPage)'].linkedEndpointGuess).toBe('signin')
    expect(byTitle['SignUpPage (public/SignUpPage)'].route).toBe('/signup')
    expect(byTitle['FilesPage (private/FilesPage)'].route).toBe('/files')
  })

  it('extracts Prisma entities with fields + relations and area heuristic', () => {
    const entities = findings.filter((f): f is EntityFinding => f.kind === 'entity')
    const byModel = Object.fromEntries(entities.map((e) => [e.model, e]))

    expect(Object.keys(byModel).sort()).toEqual(['File', 'Session', 'User'])

    expect(byModel.User.area).toBe('users')
    expect(byModel.User.fields.map((f) => f.name)).toEqual(['id', 'email', 'passwordHash', 'createdAt', 'sessions'])
    expect(byModel.User.relations).toEqual([{ field: 'sessions', target: 'Session' }])

    expect(byModel.Session.area).toBe('auth')
    expect(byModel.Session.relations).toEqual([{ field: 'user', target: 'User' }])

    expect(byModel.File.area).toBe('storage')
  })

  it('extracts test findings for unit + e2e + frontend specs with their it() titles', () => {
    const tests = findings.filter((f): f is TestFinding => f.kind === 'test')
    const byFile = Object.fromEntries(tests.map((t) => [t.file, t]))

    const authUnit = byFile['api/src/modules/auth/tests/unit/auth.service.spec.ts']
    expect(authUnit.describe).toBe('AuthService')
    expect(authUnit.cases).toEqual(['hashes passwords with bcrypt', 'rejects expired refresh tokens'])

    const authE2e = byFile['api/src/modules/auth/tests/e2e/signin.e2e.ts']
    expect(authE2e.describe).toBe('POST /auth/signin')
    expect(authE2e.area).toBe('auth')

    const pageSpec = byFile['web/src/pages/public/SignInPage.spec.tsx']
    expect(pageSpec).toBeDefined()
    expect(pageSpec.area).toBe('public/SignInPage')
  })

  it('discovers doc-context headings from README / CLAUDE / docs/ / nested READMEs', () => {
    const docs = findings.filter((f): f is DocContextFinding => f.kind === 'doc-context')
    const files = new Set(docs.map((d) => d.file))

    expect(files.has('README.md')).toBe(true)
    expect(files.has('CLAUDE.md')).toBe(true)
    expect(files.has('docs/auth.md')).toBe(true)
    expect(files.has('api/README.md')).toBe(true)
    expect(files.has('web/README.md')).toBe(true)

    const levels = new Set(docs.map((d) => d.headingLevel))
    expect(levels.has(1)).toBe(true)
    expect(levels.has(2)).toBe(true)

    for (const doc of docs) expect(doc.excerpt.length).toBeLessThanOrEqual(280)
  })

  it('overall shape is scanner-agnostic and stable for skill consumption', () => {
    for (const finding of findings) {
      expect(typeof finding.kind).toBe('string')
      expect(typeof finding.title).toBe('string')
    }
    expect(findings.length).toBeGreaterThanOrEqual(
      6 + // endpoints
        3 + // ui-flows
        3 + // entities
        3 + // tests (auth unit + auth e2e + web page spec + storage unit = 4 actually)
        5 // doc-context (at least 5 files, headings ≥ 5)
    )
  })
})
