import { spawnSync } from '../../helpers/bounded-child'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as ts from 'typescript'

import { depositStorageSharedConfig } from '../../../installers/storage.installer'

/**
 * #981 — the web dev server could not import a named export of `@<project>/shared-config`.
 *
 * The package is compiled to CommonJS for the API, and Vite serves a linked workspace package as
 * source instead of bundling it: the browser was handed `exports.X = …` and
 * `__exportStar(require('./storage'), exports)` and refused the first named import with
 * "does not provide an export named …". That includes `SHARED_CONFIG_PLACEHOLDER`, which the
 * package declares itself, so it was never the `export *` alone.
 *
 * The fix is the package's `exports` map: bundlers (which set the `browser` condition) read the
 * TypeScript source, Node and the type-checker keep reading `dist/`. These guards read the
 * template, then let Node's own resolver walk a fixture built from it, with the conditions Vite
 * sets and with the ones the API runs under.
 */

const REPO = resolve(__dirname, '../../../..')
const SCAFFOLDS = resolve(REPO, 'scaffolds')
const PACKAGE_TEMPLATE = resolve(SCAFFOLDS, 'overlays/monorepo/root/packages/shared-config')
const PROJECT = 'fixture'
const PACKAGE_NAME = `@${PROJECT}/shared-config`

const readJson = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf8'))

describe('monorepo shared-config package template (#981)', () => {
  const manifest = readJson(resolve(PACKAGE_TEMPLATE, 'package.json'))
  // A template without the map must fail the assertions below, not crash the suite.
  const exportsMap = (manifest.exports ?? {}) as Record<string, unknown>
  const root = (exportsMap['.'] ?? {}) as Record<string, string>

  it('maps the root entry to the source for bundlers, and to the build for everyone else', () => {
    // Order is the contract: TypeScript and Node take the first condition that matches.
    expect(Object.keys(root)).toEqual(['types', 'browser', 'default'])
    expect(root).toEqual({ types: './dist/index.d.ts', browser: './src/index.ts', default: './dist/index.js' })
  })

  it('keeps main and types for the resolvers that do not read exports', () => {
    // The API compiles with `moduleResolution: node`, which ignores `exports`.
    expect(manifest.main).toBe(root.default)
    expect(manifest.types).toBe(root.types)
  })

  it('never routes an import or require condition to the source', () => {
    // Node ESM would load a `.ts` file the day the API moves to ESM (NestJS 12).
    expect(Object.keys(root)).not.toContain('import')
    expect(Object.keys(root)).not.toContain('require')
    expect(JSON.stringify(exportsMap)).not.toMatch(/"(import|require)"/)
  })

  it('still exposes package.json, and nothing else, to deep imports', () => {
    expect(Object.keys(exportsMap).sort()).toEqual(['.', './package.json'])
    expect(exportsMap['./package.json']).toBe('./package.json')
  })

  it('points the browser entry at a source file the template carries', () => {
    expect(root.browser).toBeDefined()
    expect(existsSync(resolve(PACKAGE_TEMPLATE, root.browser ?? 'missing'))).toBe(true)
  })

  it('keeps compiling to CommonJS, which the API requires', () => {
    const tsconfig = readJson(resolve(PACKAGE_TEMPLATE, 'tsconfig.json')) as { compilerOptions: Record<string, unknown> }
    expect(tsconfig.compilerOptions.module).toBe('commonjs')
    expect(tsconfig.compilerOptions.outDir).toBe('./dist')
    expect(manifest.type).toBeUndefined()
  })

  it('does not pre-bundle the package in the web Vite config', () => {
    // `optimizeDeps.include` avoids the error but freezes a copy of the constants until the dev
    // server restarts with `--force`: an edit to shared-config would not reach the browser.
    const viteConfig = readFileSync(resolve(SCAFFOLDS, 'blueprints/web/vite.config.ts'), 'utf8')
    expect(viteConfig).not.toMatch(/optimizeDeps[\s\S]*shared-config/)
  })

  it('leaves the multirepo topology without a shared-config package', () => {
    for (const overlay of ['overlays/multirepo/web', 'overlays/multirepo/api']) {
      expect(existsSync(resolve(SCAFFOLDS, overlay, 'packages'))).toBe(false)
    }
  })

  it('documents the entries and the reason in the package README', () => {
    const readme = readFileSync(resolve(PACKAGE_TEMPLATE, 'README.md'), 'utf8')
    expect(readme).toContain('`browser`')
    expect(readme).toContain('src/index.ts')
    expect(readme).toContain('dist/index.js')
    expect(readme).toContain('does not provide an export named')
    expect(readme).toContain('optimizeDeps.include')
  })
})

describe('what each consumer resolves in a project generated with the storage module (#981)', () => {
  let projectRoot: string
  let apiDir: string

  beforeAll(async () => {
    projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'sf-shared-config-exports-')))
    apiDir = join(projectRoot, 'apps/api')
    const packageDir = join(projectRoot, 'packages/shared-config')

    // The package as `sf new` lays it down: the template with the placeholder substituted.
    mkdirSync(join(packageDir, 'src'), { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), readFileSync(resolve(PACKAGE_TEMPLATE, 'package.json'), 'utf8').replace(/\{\{PROJECT_NAME\}\}/g, PROJECT))
    writeFileSync(join(packageDir, 'src/index.ts'), readFileSync(resolve(PACKAGE_TEMPLATE, 'src/index.ts'), 'utf8'))

    // An organization controller with the storage module active, which the deposit gates on.
    const controllerDir = join(apiDir, 'src/modules/organizations/controllers')
    mkdirSync(controllerDir, { recursive: true })
    writeFileSync(
      join(controllerDir, 'organization.controller.ts'),
      [
        "import { FileInterceptor } from '@nestjs/platform-express'",
        '',
        'export const limits = { fileSize: 5 * 1024 * 1024 }',
        "const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']",
        ''
      ].join('\n')
    )
    await depositStorageSharedConfig({ apiPath: apiDir, projectName: PROJECT })

    // `tsc` with the package's tsconfig (module commonjs) writes dist/; transpile gives the same shape.
    mkdirSync(join(packageDir, 'dist'), { recursive: true })
    for (const file of ['index', 'storage']) {
      const source = readFileSync(join(packageDir, 'src', `${file}.ts`), 'utf8')
      const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } })
      writeFileSync(join(packageDir, 'dist', `${file}.js`), outputText)
    }

    // npm workspaces link the package into the root node_modules.
    mkdirSync(join(projectRoot, 'node_modules/@fixture'), { recursive: true })
    symlinkSync(packageDir, join(projectRoot, 'node_modules', PACKAGE_NAME), 'dir')
  })

  afterAll(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  /**
   * Node's own resolver, from the API folder, with the extra conditions a consumer sets.
   *
   * `-p` colours numbers and objects when FORCE_COLOR is set, which the local CI runner does and
   * a shell does not: the expression is printed as a string, and colour is switched off as well.
   */
  const node = (expression: string, conditions: string[] = []): string => {
    const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '0' }
    delete env.NO_COLOR // Node warns when both are set
    const result = spawnSync(process.execPath, [...conditions.map((condition) => `--conditions=${condition}`), '-p', `String(${expression})`], { cwd: apiDir, encoding: 'utf8', env })
    if (result.status !== 0) throw new Error(`node -p ${expression} failed:\n${result.stderr}`)
    return result.stdout.trim()
  }

  const resolveExpression = `require.resolve('${PACKAGE_NAME}')`

  it('has the storage deposit re-exported from the index, as it was when the bug was filed', () => {
    const index = readFileSync(join(projectRoot, 'packages/shared-config/src/index.ts'), 'utf8')
    expect(index).toContain("export * from './storage'")
    const dist = readFileSync(join(projectRoot, 'packages/shared-config/dist/index.js'), 'utf8')
    // CommonJS: a browser cannot link a named import against this, which is what Vite served.
    expect(dist).toContain('__exportStar(require("./storage"), exports)')
    expect(dist).not.toMatch(/^export /m)
  })

  it('resolves the build for the API and any Node code, so the API keeps working', () => {
    expect(node(resolveExpression)).toBe(join(projectRoot, 'packages/shared-config/dist/index.js'))
    const names = JSON.parse(node(`JSON.stringify(Object.keys(require('${PACKAGE_NAME}')).sort())`)) as string[]
    expect(names).toEqual(expect.arrayContaining(['SHARED_CONFIG_PLACEHOLDER', 'STORAGE_LOGO_ALLOWED_MIMES', 'STORAGE_LOGO_MAX_BYTES']))
    expect(node(`require('${PACKAGE_NAME}').STORAGE_LOGO_MAX_BYTES`)).toBe(String(5 * 1024 * 1024))
  })

  it('resolves the source for a bundler, which sets the browser condition', () => {
    const entry = node(resolveExpression, ['browser'])
    expect(entry).toBe(join(projectRoot, 'packages/shared-config/src/index.ts'))

    // What the dev server then serves is ES module source that declares every named export.
    const index = readFileSync(entry, 'utf8')
    expect(index).toMatch(/^export const SHARED_CONFIG_PLACEHOLDER\b/m)
    expect(index).toContain("export * from './storage'")
    const storage = readFileSync(join(projectRoot, 'packages/shared-config/src/storage.ts'), 'utf8')
    expect(storage).toMatch(/^export const STORAGE_LOGO_MAX_BYTES\b/m)
    expect(storage).toMatch(/^export const STORAGE_LOGO_ALLOWED_MIMES\b/m)
    for (const source of [index, storage]) {
      expect(source).not.toMatch(/\bexports\./)
      expect(source).not.toMatch(/\brequire\(/)
    }
  })

  it('resolves the package.json subpath it still exports', () => {
    expect(node(`require.resolve('${PACKAGE_NAME}/package.json')`)).toBe(join(projectRoot, 'packages/shared-config/package.json'))
  })
})
