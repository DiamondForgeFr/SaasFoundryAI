import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

import { ESLint } from 'eslint'

import { TEST_OUTPUT_PRETTIER_IGNORES } from '../../../builders/impact-validation'

const ROOT = resolve(__dirname, '../../../..')

/**
 * #1092 — the generated ESLint configs ignored `dist` and `node_modules` only. After a Playwright
 * run, `playwright-report/trace/` holds multi-megabyte minified trace-viewer bundles, and a coverage
 * run leaves `coverage/lcov-report/*.js`: `npm run lint` linted them and ran for 10 to 20 minutes.
 * Every output the generated test and build scripts write must stay out of lint.
 */
const WEB_OUTPUTS = ['test-results', 'playwright-report', 'blob-report', 'playwright/.cache', 'coverage', '.nyc_output', 'dev-dist', 'dist']
const API_OUTPUTS = ['coverage', 'coverage-e2e', '.nyc_output', 'test-results', 'dist', 'build']
const SHARED_PACKAGE_OUTPUTS = ['coverage', '.nyc_output', 'test-results', 'dist']

const CONFIGS: Array<[string, string[]]> = [
  ['scaffolds/blueprints/web/eslint.config.mjs', WEB_OUTPUTS],
  ['scaffolds/blueprints/api/eslint.config.mjs', API_OUTPUTS],
  ['scaffolds/overlays/monorepo/root/eslint.config.base.mjs', SHARED_PACKAGE_OUTPUTS]
]

/** The global `ignores` entry of a generated flat config: the first object whose only key is `ignores`. */
function globalIgnores(path: string): string[] {
  const source = readFileSync(resolve(ROOT, path), 'utf8')
  const block = /\{\s*(?:\/\/[^\n]*\n\s*)*ignores:\s*\[([\s\S]*?)\]\s*\}/.exec(source)
  if (!block) throw new Error(`${path} has no global ignores entry`)
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
}

describe('generated ESLint configs ignore test and tool outputs (#1092)', () => {
  describe.each(CONFIGS)('%s', (path, outputs) => {
    it('lists every output the generated scripts write', () => {
      expect(globalIgnores(path)).toEqual(expect.arrayContaining(outputs))
    })

    // The entries are bare names: prove ESLint reads them as directories at the app root, files
    // deep inside included, and still lints the sources.
    it('makes ESLint skip the files inside those outputs, not the sources', async () => {
      const cwd = resolve(ROOT, 'scaffolds/blueprints/web')
      const eslint = new ESLint({ cwd, overrideConfigFile: true, overrideConfig: [{ ignores: globalIgnores(path) }, { files: ['**/*.{js,ts,tsx}'] }] })

      for (const output of outputs) expect(await eslint.isPathIgnored(join(cwd, output, 'trace/assets/index-Bx3k.js'))).toBe(true)
      expect(await eslint.isPathIgnored(join(cwd, 'src/main.ts'))).toBe(false)
      expect(await eslint.isPathIgnored(join(cwd, 'tests/e2e/specs/auth.spec.ts'))).toBe(false)
    })
  })

  it('keeps the shared packages on the base config', () => {
    for (const pkg of ['shared-types', 'shared-config', 'shared-validation']) {
      expect(readFileSync(resolve(ROOT, `scaffolds/overlays/monorepo/root/packages/${pkg}/eslint.config.mjs`), 'utf8')).toContain("from '../../eslint.config.base.mjs'")
    }
  })
})

describe('generated Prettier and Git ignores cover the same outputs (#1092)', () => {
  it('keeps the outputs out of the format check, at any depth', () => {
    expect([...TEST_OUTPUT_PRETTIER_IGNORES]).toEqual(
      expect.arrayContaining([...new Set([...WEB_OUTPUTS, ...API_OUTPUTS].filter((output) => !['dist', 'build'].includes(output)))].map((output) => `**/${output}/`))
    )
  })

  // In a monorepo, `turbo run format` runs `prettier --write .` inside each app, where the root
  // ignore files do not apply: it rewrote the Playwright report bundles
  it.each([
    ['scaffolds/overlays/monorepo/web/.prettierignore', WEB_OUTPUTS],
    ['scaffolds/overlays/monorepo/api/.prettierignore', API_OUTPUTS]
  ])('%s keeps them out of the app-level format', (path, outputs) => {
    expect(readFileSync(resolve(ROOT, path), 'utf8').split('\n')).toEqual(expect.arrayContaining(outputs.map((output) => `${output}/`)))
  })

  it.each([
    ['scaffolds/overlays/monorepo/root/gitignore', ['coverage/', 'coverage-e2e/', '.nyc_output/', 'test-results/', 'playwright-report/', 'blob-report/', 'dev-dist/']],
    ['scaffolds/overlays/multirepo/api/gitignore', ['/coverage', '/coverage-e2e', '/.nyc_output', '/test-results']],
    ['scaffolds/overlays/multirepo/web/gitignore', ['/test-results/', '/playwright-report/', '/blob-report/', '/coverage/', '/.nyc_output/', '/dev-dist/']]
  ])('%s keeps them out of the repository', (path, entries) => {
    expect(readFileSync(resolve(ROOT, path), 'utf8').split('\n')).toEqual(expect.arrayContaining(entries))
  })

  // The web blueprint used to ship a stale `playwright-report/index.html` and `test-results/`
  // into every generated project
  it('ships no test output in the web blueprint', () => {
    for (const output of WEB_OUTPUTS) expect(existsSync(resolve(ROOT, 'scaffolds/blueprints/web', output))).toBe(false)
  })
})
