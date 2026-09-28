import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

import { extractModels, modelToArea, parseFieldLine, prismaScanner } from '../../../../srs/scanners/prisma.scanner'
import { CodebaseScannerContext, EntityFinding } from '../../../../srs/scanners/types'

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

describe('parseFieldLine (pure)', () => {
  it('parses a scalar field with id attribute', () => {
    const parsed = parseFieldLine('  id String @id @default(cuid())')
    expect(parsed).toEqual({
      field: { name: 'id', type: 'String', isId: true },
      relationTarget: undefined
    })
  })

  it('flags optional scalar fields', () => {
    const parsed = parseFieldLine('  description String? @db.VarChar(255)')
    expect(parsed?.field).toEqual({ name: 'description', type: 'String', optional: true })
  })

  it('recognizes list relation fields', () => {
    const parsed = parseFieldLine('  users UserRoleLink[]')
    expect(parsed?.field).toEqual({ name: 'users', type: 'UserRoleLink[]' })
    expect(parsed?.relationTarget).toBe('UserRoleLink')
  })

  it('recognizes explicit @relation', () => {
    const parsed = parseFieldLine('  role Role @relation(fields: [roleId], references: [id])')
    expect(parsed?.field).toEqual({ name: 'role', type: 'Role' })
    expect(parsed?.relationTarget).toBe('Role')
  })

  it('skips directive lines, comments, and blanks', () => {
    expect(parseFieldLine('')).toBeUndefined()
    expect(parseFieldLine('  @@map("users")')).toBeUndefined()
    expect(parseFieldLine('  // hello')).toBeUndefined()
    expect(parseFieldLine('  /** block */')).toBeUndefined()
  })
})

describe('extractModels (pure)', () => {
  it('extracts multiple models with their fields + relations', () => {
    const source = `
      model User {
        id    String @id @default(cuid())
        email String @unique
        role  Role   @relation(fields: [roleId], references: [id])
        @@map("users")
      }

      model Role {
        id    Int    @id @default(autoincrement())
        name  String @unique
        users UserRoleLink[]
      }
    `
    const models = extractModels(source)
    expect(models.map((m) => m.model)).toEqual(['User', 'Role'])

    const user = models[0]
    expect(user.fields.map((f) => f.name)).toEqual(['id', 'email', 'role'])
    expect(user.relations).toEqual([{ field: 'role', target: 'Role' }])

    const role = models[1]
    expect(role.relations).toEqual([{ field: 'users', target: 'UserRoleLink' }])
  })
})

describe('modelToArea (pure)', () => {
  it('uses overrides for common auth/accounts/organizations models', () => {
    expect(modelToArea('User')).toBe('users')
    expect(modelToArea('Session')).toBe('auth')
    expect(modelToArea('Account')).toBe('accounts')
    expect(modelToArea('Invitation')).toBe('invitation')
    expect(modelToArea('File')).toBe('storage')
  })

  it('falls back to lowercased pluralized name', () => {
    expect(modelToArea('Widget')).toBe('widgets')
    expect(modelToArea('Settings')).toBe('settings')
  })
})

describe('prismaScanner.collect', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-srs-prisma-'))
  })

  const seedFile = (absPath: string, source: string): void => {
    mkdirSync(dirname(absPath), { recursive: true })
    writeFileSync(absPath, source)
  }

  it('emits entity findings for multi-file schemas', async () => {
    seedFile(
      join(tmp, 'api', 'prisma', 'schema', 'users.prisma'),
      `
      model User {
        id    String @id
        email String
      }
    `
    )
    seedFile(
      join(tmp, 'api', 'prisma', 'schema', 'accounts.prisma'),
      `
      model Account {
        id   String @id
        name String
      }
    `
    )

    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: walkSync(tmp),
      structure: 'monorepo',
      apiRoot: join(tmp, 'api')
    }

    const findings = (await prismaScanner.collect(context)) as EntityFinding[]

    expect(findings).toHaveLength(2)
    const byModel = Object.fromEntries(findings.map((f) => [f.model, f]))
    expect(byModel.User.area).toBe('users')
    expect(byModel.User.file).toBe('api/prisma/schema/users.prisma')
    expect(byModel.Account.area).toBe('accounts')
  })

  it('parses single-file schema.prisma', async () => {
    seedFile(
      join(tmp, 'prisma', 'schema.prisma'),
      `
      model Widget {
        id    String @id
        label String
      }
    `
    )

    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: walkSync(tmp),
      structure: 'multirepo',
      apiRoot: tmp
    }

    const findings = (await prismaScanner.collect(context)) as EntityFinding[]

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      kind: 'entity',
      model: 'Widget',
      area: 'widgets',
      file: 'prisma/schema.prisma'
    })
    expect(findings[0].fields.map((f) => f.name)).toEqual(['id', 'label'])
  })

  it('ignores enum blocks', async () => {
    seedFile(
      join(tmp, 'prisma', 'schema.prisma'),
      `
      enum Locale {
        EN
        FR
      }

      model User {
        id     String @id
        locale Locale @default(FR)
      }
    `
    )

    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: walkSync(tmp),
      structure: 'multirepo',
      apiRoot: tmp
    }

    const findings = (await prismaScanner.collect(context)) as EntityFinding[]
    expect(findings).toHaveLength(1)
    expect(findings[0].model).toBe('User')
    // `locale Locale` is a non-scalar reference — treated as a relation candidate.
    expect(findings[0].relations).toEqual([{ field: 'locale', target: 'Locale' }])
  })

  it('returns [] when no .prisma files exist', async () => {
    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: [],
      structure: 'monorepo'
    }
    const findings = await prismaScanner.collect(context)
    expect(findings).toEqual([])
  })
})
