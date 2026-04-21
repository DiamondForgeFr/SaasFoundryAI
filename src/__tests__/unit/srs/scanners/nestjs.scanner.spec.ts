import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { extractEndpoints, nestjsScanner } from '../../../../srs/scanners/nestjs.scanner'
import { CodebaseScannerContext, EndpointFinding } from '../../../../srs/scanners/types'

function walkSync(root: string): string[] {
  const out: string[] = []
  const visit = (abs: string): void => {
    for (const entry of readdirSync(abs)) {
      const child = join(abs, entry)
      const st = statSync(child)
      if (st.isDirectory()) visit(child)
      else if (st.isFile()) out.push(relative(root, child).split('\\').join('/'))
    }
  }
  visit(root)
  return out
}

describe('extractEndpoints (pure)', () => {
  it('parses controller prefix as string literal', () => {
    const source = `
      @Controller('users')
      export class UsersController {
        @Get()
        findAll() {}

        @Post('invite')
        invite() {}
      }
    `
    const { prefix, endpoints } = extractEndpoints(source)
    expect(prefix).toBe('users')
    expect(endpoints).toEqual([
      { method: 'GET', subPath: '', methodName: 'findAll' },
      { method: 'POST', subPath: 'invite', methodName: 'invite' }
    ])
  })

  it('parses controller prefix given as { path: "..." }', () => {
    const source = `
      @Controller({ path: 'organizations', version: '1' })
      export class OrgsController {
        @Patch(':id')
        update() {}
      }
    `
    const { prefix, endpoints } = extractEndpoints(source)
    expect(prefix).toBe('organizations')
    expect(endpoints).toEqual([{ method: 'PATCH', subPath: ':id', methodName: 'update' }])
  })

  it('skips constructor and control-flow keywords', () => {
    const source = `
      @Controller('x')
      export class XController {
        constructor(private readonly svc: any) {}

        @Get()
        list() {
          if (true) return []
        }
      }
    `
    const { endpoints } = extractEndpoints(source)
    expect(endpoints).toEqual([{ method: 'GET', subPath: '', methodName: 'list' }])
  })
})

describe('nestjsScanner.collect', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-srs-nest-'))
  })

  const seedController = (dir: string, name: string, source: string): void => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, name), source)
  }

  it('emits endpoint findings with area + hasTests for a monorepo api/', async () => {
    const apiModuleDir = join(tmp, 'api', 'src', 'modules', 'users')
    seedController(
      apiModuleDir,
      'users.controller.ts',
      `
      @Controller('users')
      export class UsersController {
        @Get()
        findAll() {}
        @Post()
        create() {}
      }
    `
    )
    // A spec.ts alongside the controller signals hasTests=true
    writeFileSync(join(apiModuleDir, 'users.service.spec.ts'), 'describe("u", () => {})')

    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: walkSync(tmp),
      structure: 'monorepo',
      apiRoot: join(tmp, 'api')
    }

    const findings = (await nestjsScanner.collect(context)) as EndpointFinding[]

    expect(findings).toHaveLength(2)
    for (const f of findings) {
      expect(f.kind).toBe('endpoint')
      expect(f.area).toBe('users')
      expect(f.hasTests).toBe(true)
      expect(f.file).toBe('api/src/modules/users/users.controller.ts')
    }
    expect(findings.map((f) => `${f.method} ${f.path}`).sort()).toEqual(['GET /users', 'POST /users'])
  })

  it('emits findings for a multirepo layout (scanRoot-rooted api)', async () => {
    const apiModuleDir = join(tmp, 'src', 'modules', 'organizations')
    seedController(
      apiModuleDir,
      'organizations.controller.ts',
      `
      @Controller('organizations')
      export class OrgsController {
        @Patch(':id')
        update() {}
      }
    `
    )

    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: walkSync(tmp),
      structure: 'multirepo',
      apiRoot: tmp
    }

    const findings = (await nestjsScanner.collect(context)) as EndpointFinding[]

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      kind: 'endpoint',
      area: 'organizations',
      method: 'PATCH',
      path: '/organizations/:id',
      hasTests: false,
      file: 'src/modules/organizations/organizations.controller.ts'
    })
  })

  it('flags hasTests=false when no .spec.ts sits under the module', async () => {
    const apiModuleDir = join(tmp, 'api', 'src', 'modules', 'invitation')
    seedController(
      apiModuleDir,
      'invitation.controller.ts',
      `
      @Controller('invitation')
      export class InvitationController {
        @Post()
        create() {}
      }
    `
    )

    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: walkSync(tmp),
      structure: 'monorepo',
      apiRoot: join(tmp, 'api')
    }

    const findings = (await nestjsScanner.collect(context)) as EndpointFinding[]

    expect(findings).toHaveLength(1)
    expect(findings[0].hasTests).toBe(false)
  })

  it('returns [] when no controllers exist', async () => {
    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: [],
      structure: 'monorepo',
      apiRoot: join(tmp, 'api')
    }
    const findings = await nestjsScanner.collect(context)
    expect(findings).toEqual([])
  })

  it('ignores .spec.ts files even if they match the controller suffix', async () => {
    const apiModuleDir = join(tmp, 'api', 'src', 'modules', 'users')
    seedController(
      apiModuleDir,
      'users.controller.spec.ts',
      `
      @Controller('users')
      export class UsersController {
        @Get()
        findAll() {}
      }
    `
    )

    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: walkSync(tmp),
      structure: 'monorepo',
      apiRoot: join(tmp, 'api')
    }

    const findings = await nestjsScanner.collect(context)
    expect(findings).toEqual([])
  })
})
