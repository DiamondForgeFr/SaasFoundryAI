import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

import {
  extractCaseTitles,
  extractDescribeTitles,
  extractTestAreaFromPath,
  testsScanner
} from '../../../../srs/scanners/tests.scanner'
import { CodebaseScannerContext, TestFinding } from '../../../../srs/scanners/types'

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

describe('extractDescribeTitles (pure)', () => {
  it('collects every describe block title', () => {
    const source = `
      describe('top-level', () => {
        describe('nested', () => {
          it('works', () => {})
        })
      })
    `
    expect(extractDescribeTitles(source)).toEqual(['top-level', 'nested'])
  })
})

describe('extractCaseTitles (pure)', () => {
  it('collects it() and test() titles', () => {
    const source = `
      describe('AuthService', () => {
        it('signs in the user', () => {})
        test('signs out the user', () => {})
      })
    `
    expect(extractCaseTitles(source)).toEqual(['signs in the user', 'signs out the user'])
  })
})

describe('extractTestAreaFromPath (pure)', () => {
  it('derives area from src/modules/<area>/', () => {
    expect(extractTestAreaFromPath('api/src/modules/auth/tests/unit/auth.service.spec.ts')).toBe('auth')
  })

  it('derives two-segment area for src/pages/<area>/<page>.spec.tsx', () => {
    expect(extractTestAreaFromPath('web/src/pages/public/LoginPage.spec.tsx')).toBe('public/LoginPage')
  })

  it('falls back to filename stem when the path has no known marker', () => {
    expect(extractTestAreaFromPath('tests/smoke/utils.spec.ts')).toBe('utils')
    expect(extractTestAreaFromPath('util.e2e.ts')).toBe('util')
  })
})

describe('testsScanner.collect', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-srs-tests-'))
  })

  const seedFile = (absPath: string, source: string): void => {
    mkdirSync(dirname(absPath), { recursive: true })
    writeFileSync(absPath, source)
  }

  it('emits a test finding per spec file with titles', async () => {
    seedFile(
      join(tmp, 'api', 'src', 'modules', 'auth', 'tests', 'unit', 'auth.service.spec.ts'),
      `
      describe('AuthService', () => {
        it('signs in', () => {})
        it('signs out', () => {})
      })
    `
    )
    seedFile(
      join(tmp, 'api', 'src', 'modules', 'auth', 'tests', 'e2e', 'signin.e2e.ts'),
      `
      describe('POST /auth/signin', () => {
        it('returns 200 on valid credentials', () => {})
      })
    `
    )

    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: walkSync(tmp),
      structure: 'monorepo',
      apiRoot: join(tmp, 'api')
    }

    const findings = (await testsScanner.collect(context)) as TestFinding[]

    expect(findings).toHaveLength(2)
    const specFinding = findings.find((f) => f.file.endsWith('.spec.ts'))
    expect(specFinding).toMatchObject({
      kind: 'test',
      area: 'auth',
      describe: 'AuthService',
      cases: ['signs in', 'signs out']
    })
    const e2eFinding = findings.find((f) => f.file.endsWith('.e2e.ts'))
    expect(e2eFinding).toMatchObject({
      area: 'auth',
      describe: 'POST /auth/signin',
      cases: ['returns 200 on valid credentials']
    })
  })

  it('skips spec files that declare nothing', async () => {
    seedFile(join(tmp, 'src', 'empty.spec.ts'), `export const noop = () => {}`)

    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: walkSync(tmp)
    }

    const findings = await testsScanner.collect(context)
    expect(findings).toEqual([])
  })

  it('returns [] when no spec/e2e files exist', async () => {
    const context: CodebaseScannerContext = {
      scanRoot: tmp,
      files: []
    }
    const findings = await testsScanner.collect(context)
    expect(findings).toEqual([])
  })
})
