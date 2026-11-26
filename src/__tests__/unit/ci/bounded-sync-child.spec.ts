import childProcess from 'child_process'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'
import ts from 'typescript'

import { CHILD_KILL_SIGNAL, boundedOptions, execFileSync, execSync, spawnSync } from '../../helpers/bounded-child'

const REPO_ROOT = resolve(__dirname, '../../../..')
const TESTS_ROOT = join(REPO_ROOT, 'src/__tests__')
const HELPER = join(TESTS_ROOT, 'helpers/bounded-child.ts')

const SYNC_CALLS = new Set(['execFileSync', 'execSync', 'spawnSync'])
const CHILD_PROCESS = new Set(['child_process', 'node:child_process'])

const isChildProcess = (node: ts.Node | undefined): boolean => !!node && ts.isStringLiteralLike(node) && CHILD_PROCESS.has(node.text)

/** `require('child_process')` or `jest.requireActual('child_process')`. */
function isChildProcessRequire(node: ts.Node | undefined): boolean {
  if (!node || !ts.isCallExpression(node)) return false
  const callee = node.expression.getText()
  return (callee === 'require' || callee === 'jest.requireActual') && isChildProcess(node.arguments[0])
}

/** The names a `jest.mock('child_process', factory)` replaces; all three when it automocks the module. */
function mockedNames(file: ts.SourceFile): Set<string> {
  const mocked = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ['jest.mock', 'jest.doMock'].includes(node.expression.getText()) && isChildProcess(node.arguments[0])) {
      const factory = node.arguments[1]
      if (!factory) for (const name of SYNC_CALLS) mocked.add(name)
      else {
        const collect = (inner: ts.Node): void => {
          if ((ts.isPropertyAssignment(inner) || ts.isShorthandPropertyAssignment(inner) || ts.isMethodDeclaration(inner)) && SYNC_CALLS.has(inner.name.getText())) mocked.add(inner.name.getText())
          ts.forEachChild(inner, collect)
        }
        collect(factory)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return mocked
}

/**
 * Every synchronous child process a source starts straight from `child_process`, with no bound: a named import, a
 * `require` destructuring, or a call through the module object (`childProcess.spawnSync(…)`). A name the file mocks
 * with `jest.mock('child_process', …)` starts no process and is left alone; a spy (`jest.spyOn(childProcess, 'spawnSync')`)
 * names the function as a string and is not a call.
 */
function unboundedSyncChildren(source: string, fileName = 'source.ts'): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const mocked = mockedNames(file)
  const modules = new Set<string>()
  const offences: string[] = []
  const report = (node: ts.Node, name: string, how: string) => {
    if (mocked.has(name)) return
    offences.push(`${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: ${name} ${how}`)
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && isChildProcess(node.moduleSpecifier) && node.importClause && !node.importClause.isTypeOnly) {
      const clause = node.importClause
      if (clause.name) modules.add(clause.name.text)
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) modules.add(clause.namedBindings.name.text)
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          const name = (element.propertyName ?? element.name).text
          if (!element.isTypeOnly && SYNC_CALLS.has(name)) report(element, name, 'imported from child_process')
        }
      }
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && isChildProcess(node.moduleReference.expression)) modules.add(node.name.text)
    if (ts.isVariableDeclaration(node) && isChildProcessRequire(node.initializer)) {
      if (ts.isIdentifier(node.name)) modules.add(node.name.text)
      else if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const name = (element.propertyName ?? element.name).getText()
          if (SYNC_CALLS.has(name)) report(element, name, 'destructured from require(child_process)')
        }
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && SYNC_CALLS.has(node.expression.name.text)) {
      const target = node.expression.expression
      if ((ts.isIdentifier(target) && modules.has(target.text)) || isChildProcessRequire(target)) report(node, node.expression.name.text, 'called on child_process')
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return offences
}

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === 'fixtures' || entry === 'node_modules' ? [] : sources(path)
    return entry.endsWith('.ts') ? [path] : []
  })

// A synchronous child blocks the event loop, so Jest's timeout cannot stop it: one hung for 13 hours in the local CI (#1344).
describe('every synchronous child process of the specs is bounded (#1344)', () => {
  it('no spec or helper under src/__tests__ starts one straight from child_process', () => {
    const offences = sources(TESTS_ROOT)
      .filter((path) => path !== HELPER)
      .flatMap((path) => unboundedSyncChildren(readFileSync(path, 'utf8'), path).map((offence) => `${relative(REPO_ROOT, path)}:${offence}`))
    expect(offences).toEqual([])
  })

  describe('the guard', () => {
    it('refuses a named import, an alias, a require destructuring and a call on the module object', () => {
      expect(unboundedSyncChildren("import { execFile, execFileSync } from 'child_process'")).toEqual(['1: execFileSync imported from child_process'])
      expect(unboundedSyncChildren("import { execSync as run } from 'node:child_process'")).toEqual(['1: execSync imported from child_process'])
      expect(unboundedSyncChildren("const { spawnSync } = require('child_process')")).toEqual(['1: spawnSync destructured from require(child_process)'])
      expect(unboundedSyncChildren("import * as cp from 'child_process'\ncp.spawnSync('git', ['status'])")).toEqual(['2: spawnSync called on child_process'])
      expect(unboundedSyncChildren("import childProcess from 'child_process'\nchildProcess.execSync('ls')")).toEqual(['2: execSync called on child_process'])
      expect(unboundedSyncChildren("require('node:child_process').execFileSync('git')")).toEqual(['1: execFileSync called on child_process'])
    })

    it('lets through the bounded helper, the asynchronous calls, the types, a spy and a mocked name', () => {
      expect(unboundedSyncChildren("import { execFileSync, spawnSync } from '../../helpers/bounded-child'")).toEqual([])
      expect(unboundedSyncChildren("import { execFile, spawn, type SpawnSyncReturns } from 'node:child_process'")).toEqual([])
      expect(unboundedSyncChildren("import childProcess from 'child_process'\njest.spyOn(childProcess, 'spawnSync').mockReturnValue({} as never)")).toEqual([])
      expect(unboundedSyncChildren("import { execSync } from 'child_process'\njest.mock('child_process', () => ({ execSync: jest.fn() }))")).toEqual([])
      expect(unboundedSyncChildren("import { execSync } from 'child_process'\njest.mock('child_process')")).toEqual([])
      // a string that holds code is not code the spec runs
      expect(unboundedSyncChildren("const script = `import { execFileSync } from 'node:child_process'`")).toEqual([])
    })

    it('still refuses a name the mock leaves real', () => {
      const source = "import { execSync, spawnSync } from 'child_process'\njest.mock('child_process', () => ({ ...jest.requireActual('child_process'), execSync: jest.fn() }))"
      expect(unboundedSyncChildren(source)).toEqual(['1: spawnSync imported from child_process'])
    })
  })

  describe('the bounds', () => {
    const configured = (globalThis as { TEST_TIMEOUT?: unknown }).TEST_TIMEOUT
    afterEach(() => {
      ;(globalThis as { TEST_TIMEOUT?: unknown }).TEST_TIMEOUT = configured
      jest.restoreAllMocks()
    })

    it("default to the project's test budget and SIGKILL, and keep what the caller sets", () => {
      expect(boundedOptions()).toEqual({ timeout: configured, killSignal: 'SIGKILL' })
      expect(boundedOptions({ cwd: '/tmp', timeout: 0 })).toEqual({ cwd: '/tmp', timeout: configured, killSignal: 'SIGKILL' })
      expect(boundedOptions({ timeout: 1234, killSignal: 'SIGINT' as const })).toEqual({ timeout: 1234, killSignal: 'SIGINT' })
      ;(globalThis as { TEST_TIMEOUT?: unknown }).TEST_TIMEOUT = undefined
      expect(boundedOptions().timeout).toBe(60_000)
    })

    it('reach the child_process function a spec spies on, with the same arguments', () => {
      const spy = jest.spyOn(childProcess, 'execFileSync').mockReturnValue('spied')
      expect(execFileSync('git', ['status'], { encoding: 'utf8' })).toBe('spied')
      expect(spy).toHaveBeenCalledWith('git', ['status'], { encoding: 'utf8', timeout: configured, killSignal: CHILD_KILL_SIGNAL })
      execFileSync('git', { cwd: '/tmp' })
      expect(spy).toHaveBeenLastCalledWith('git', [], { cwd: '/tmp', timeout: configured, killSignal: CHILD_KILL_SIGNAL })
    })
  })

  // A child that never exits and ignores SIGTERM: the worst a stuck `git` can do.
  describe('a hanging child fails fast', () => {
    const HANG = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"
    const configured = (globalThis as { TEST_TIMEOUT?: unknown }).TEST_TIMEOUT
    afterEach(() => {
      ;(globalThis as { TEST_TIMEOUT?: unknown }).TEST_TIMEOUT = configured
    })

    const timed = <T>(run: () => T): { result?: T; error?: NodeJS.ErrnoException; elapsed: number } => {
      const started = Date.now()
      try {
        return { result: run(), elapsed: Date.now() - started }
      } catch (error) {
        return { error: error as NodeJS.ErrnoException, elapsed: Date.now() - started }
      }
    }

    it('execFileSync throws ETIMEDOUT once its timeout is spent', () => {
      const { error, elapsed } = timed(() => execFileSync(process.execPath, ['-e', HANG], { timeout: 500, stdio: 'pipe' }))
      expect(error?.code).toBe('ETIMEDOUT')
      expect(elapsed).toBeLessThan(10_000)
    })

    it('execSync throws ETIMEDOUT once its timeout is spent', () => {
      const { error, elapsed } = timed(() => execSync(`"${process.execPath}" -e "${HANG}"`, { timeout: 500, stdio: 'pipe' }))
      expect(error?.code).toBe('ETIMEDOUT')
      expect(elapsed).toBeLessThan(10_000)
    })

    it('spawnSync returns an ETIMEDOUT error, the child killed with SIGKILL', () => {
      const { result, elapsed } = timed(() => spawnSync(process.execPath, ['-e', HANG], { timeout: 500, encoding: 'utf8' }))
      expect((result?.error as NodeJS.ErrnoException | undefined)?.code).toBe('ETIMEDOUT')
      expect(result?.signal).toBe('SIGKILL')
      expect(elapsed).toBeLessThan(10_000)
    })

    it('a call that sets no timeout is bounded by the test budget all the same', () => {
      ;(globalThis as { TEST_TIMEOUT?: unknown }).TEST_TIMEOUT = 500
      const { result, elapsed } = timed(() => spawnSync(process.execPath, ['-e', HANG]))
      expect((result?.error as NodeJS.ErrnoException | undefined)?.code).toBe('ETIMEDOUT')
      expect(elapsed).toBeLessThan(10_000)
    })
  })
})
