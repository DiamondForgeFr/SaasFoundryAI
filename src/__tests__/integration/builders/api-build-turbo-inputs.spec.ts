import { existsSync, globSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, matchesGlob } from 'node:path'

import { renderApiApp } from '../../../builders/api.builder'
import { renderMonorepoRoot } from '../../../builders/monorepo.builder'
import { apiParams, monorepoRootParams } from '../../helpers/fixtures'

interface TurboTask {
  dependsOn?: string[]
  inputs?: string[]
  outputs?: string[]
}

/**
 * #1294 — the API `build` task inherited the root inputs (`src/**`, `tsconfig.json`,
 * `tsconfig.build.json`, `package.json`), which leave out files `nest build` reads: a change to
 * `nest-cli.json` (the Swagger plugin), `prisma.config.ts` (compiled with the project) or the
 * Prisma schema (it shapes the generated client the build type-checks against) reused a stale
 * cached `dist/`. The API package config now lists exactly what the build reads.
 */
describe('generated API build turbo inputs (#1294)', () => {
  let target: string

  beforeEach(async () => {
    target = await mkdtemp(join(tmpdir(), 'sf-api-turbo-inputs-'))
  })

  afterEach(async () => {
    await rm(target, { recursive: true, force: true })
  })

  const apiPath = (isMonorepo = true) => join(target, isMonorepo ? 'apps/api' : 'apps/test-project-api')

  async function render(): Promise<Record<string, TurboTask>> {
    await renderApiApp({ ...apiParams({ isMonorepo: true }), targetDir: target })
    await renderMonorepoRoot({ ...monorepoRootParams(), targetDir: target })
    const turbo = JSON.parse(await readFile(join(apiPath(), 'turbo.json'), 'utf8')) as { extends: string[]; tasks: Record<string, TurboTask> }
    expect(turbo.extends).toEqual(['//'])
    return turbo.tasks
  }

  /**
   * Whether turbo hashes this package-relative file for the task, the way its inputs resolve.
   * The API list is explicit: `$TURBO_DEFAULT$` would also hash what the build never reads
   * (`docs/`, `scripts/`, the Dockerfile, the Jest and ESLint configs), so it is not used.
   */
  function hashed(file: string, inputs: string[]): boolean {
    expect(inputs).not.toContain('$TURBO_DEFAULT$')
    const excluded = inputs.filter((input) => input.startsWith('!')).some((input) => matchesGlob(file, input.slice(1)))
    if (excluded) return false
    return inputs.filter((input) => !input.startsWith('!')).some((input) => matchesGlob(file, input))
  }

  /** The TypeScript files `nest build` compiles: every `.ts` file `tsconfig.build.json` does not exclude. */
  async function compiledFiles(): Promise<string[]> {
    const { exclude } = JSON.parse(await readFile(join(apiPath(), 'tsconfig.build.json'), 'utf8')) as { exclude: string[] }
    const excludedByTsc = (file: string) => exclude.some((pattern) => matchesGlob(file, pattern) || matchesGlob(file, `${pattern}/**`))
    return globSync('**/*.ts', { cwd: apiPath() }).filter((file) => !excludedByTsc(file))
  }

  it('hashes every file the API build reads', async () => {
    const tasks = await render()
    const inputs = tasks.build.inputs ?? []

    const compiled = await compiledFiles()
    // `prisma.config.ts` sits outside `src/`, and `src/configs/test/` is compiled too: only specs are excluded.
    expect(compiled).toEqual(expect.arrayContaining(['prisma.config.ts', 'src/main.ts']))
    expect(compiled.some((file) => file.startsWith('src/configs/test/'))).toBe(true)

    const schemaFiles = globSync('prisma/schema/**/*.prisma', { cwd: apiPath() })
    expect(schemaFiles).toEqual(expect.arrayContaining(['prisma/schema/schema.prisma']))

    // The Prisma client `prisma generate` writes under `src/`: gitignored, so absent from a fresh render.
    const read = [...compiled, ...schemaFiles, 'nest-cli.json', 'tsconfig.json', 'tsconfig.build.json', 'package.json', 'src/generated/prisma/client.ts']
    for (const file of read.filter((candidate) => !candidate.startsWith('src/generated/'))) expect(existsSync(join(apiPath(), file))).toBe(true)

    expect(read.filter((file) => !hashed(file, inputs))).toEqual([])
  })

  it('leaves out what the build never reads, so editing a spec does not rebuild', async () => {
    const tasks = await render()
    const inputs = tasks.build.inputs ?? []

    // Unit, e2e and disabled specs: `tsconfig.build.json` excludes `**/*spec.ts`, so `nest build` never compiles them.
    const specs = globSync('src/**/*spec.ts', { cwd: apiPath() })
    expect(specs).toEqual(
      expect.arrayContaining(['src/modules/auth/tests/unit/auth.service.spec.ts', 'src/modules/auth/tests/e2e/auth.e2e-spec.ts', 'src/modules/email/tests/unit/email.service.disabled-spec.ts'])
    )
    expect(specs.filter((file) => hashed(file, inputs))).toEqual([])
    expect((await compiledFiles()).filter((file) => specs.includes(file))).toEqual([])

    const unread = [
      'jest.config.js',
      'jest-e2e.config.js',
      'eslint.config.mjs',
      'Dockerfile',
      'README.md',
      'AGENTS.md',
      '.env.test',
      'scripts/update-db.sh',
      'prisma/sql/functions/check_role_grants.sql'
    ]
    for (const file of unread) expect(existsSync(join(apiPath(), file))).toBe(true)
    expect(unread.filter((file) => hashed(file, inputs))).toEqual([])
  })

  it('keeps the outputs and dependencies the API build inherits from the root task', async () => {
    const tasks = await render()
    expect(tasks.build.dependsOn).toBeUndefined()
    expect(tasks.build.outputs).toBeUndefined()

    const root = JSON.parse(await readFile(join(target, 'turbo.json'), 'utf8')) as { tasks: Record<string, TurboTask> }
    expect(root.tasks.build.dependsOn).toEqual(['^build'])
    expect(root.tasks.build.outputs).toEqual(['dist/**'])
    // The shared packages keep the root inputs: they build with `tsc` from `src/` alone.
    expect(root.tasks.build.inputs).toEqual(expect.arrayContaining(['src/**', 'package.json']))
    expect(root.tasks.build.inputs).not.toContain('$TURBO_DEFAULT$')
  })

  it('does not ship a turbo config with the standalone API, which has no turbo', async () => {
    await renderApiApp({ ...apiParams({ isMonorepo: false }), targetDir: target })

    expect(existsSync(join(apiPath(false), 'nest-cli.json'))).toBe(true)
    expect(existsSync(join(apiPath(false), 'turbo.json'))).toBe(false)
  })
})
