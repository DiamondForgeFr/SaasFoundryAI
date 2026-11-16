import { spawnSync } from 'node:child_process'
import { existsSync, globSync, statSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, matchesGlob } from 'node:path'

import { renderMonorepoRoot } from '../../../builders/monorepo.builder'
import { renderWebApp } from '../../../builders/web.builder'
import { monorepoRootParams, webParams } from '../../helpers/fixtures'

interface TurboTask {
  dependsOn?: string[]
  inputs?: string[]
  env?: string[]
  passThroughEnv?: string[]
}

/**
 * #1262 — the web `build` task inherited the root inputs (`src/**`, `tsconfig.json`, …), which
 * leave out files Vite reads: a change to `index.html`, `vite.config.ts`, `pwa.config.ts`,
 * `public/` or an env file reused a stale cached `dist/`, and since #979 `test:e2e` runs
 * against that build. The web package config now hashes `$TURBO_DEFAULT$` (every file Git does
 * not ignore) plus the gitignored env files, minus what the build never reads.
 */
describe('generated web build turbo inputs (#1262)', () => {
  let target: string

  beforeEach(async () => {
    target = await mkdtemp(join(tmpdir(), 'sf-web-turbo-inputs-'))
  })

  afterEach(async () => {
    await rm(target, { recursive: true, force: true })
  })

  const webPath = () => join(target, 'apps/web')

  async function render(includePwa: boolean): Promise<Record<string, TurboTask>> {
    await renderWebApp({ ...webParams({ isMonorepo: true, includePwa }), targetDir: target })
    await renderMonorepoRoot({ ...monorepoRootParams(), targetDir: target })
    const turbo = JSON.parse(await readFile(join(webPath(), 'turbo.json'), 'utf8')) as { extends: string[]; tasks: Record<string, TurboTask> }
    expect(turbo.extends).toEqual(['//'])
    return turbo.tasks
  }

  /** The files `$TURBO_DEFAULT$` leaves out: what the generated `.gitignore` ignores. */
  function gitIgnored(paths: string[]): Set<string> {
    expect(spawnSync('git', ['init', '-q'], { cwd: target }).status).toBe(0)
    const result = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: target, input: paths.join('\n'), encoding: 'utf8' })
    return new Set(result.stdout.split('\n').filter(Boolean))
  }

  /** Whether turbo hashes this package-relative file for the task, the way its inputs resolve. */
  function hashed(file: string, inputs: string[], ignored: Set<string>): boolean {
    const excluded = inputs.filter((input) => input.startsWith('!')).some((input) => matchesGlob(file, input.slice(1)))
    if (excluded) return false
    const explicit = inputs.filter((input) => !input.startsWith('!') && input !== '$TURBO_DEFAULT$').some((input) => matchesGlob(file, input))
    const byDefault = inputs.includes('$TURBO_DEFAULT$') && !ignored.has(`apps/web/${file}`)
    return explicit || byDefault
  }

  it.each([true, false])('hashes every file the web build reads (PWA %s)', async (includePwa) => {
    const tasks = await render(includePwa)
    const inputs = tasks.build.inputs ?? []

    const publicFiles = globSync('public/**/*', { cwd: webPath() }).filter((file) => statSync(join(webPath(), file)).isFile())
    expect(publicFiles.length).toBeGreaterThan(0)
    const read = ['index.html', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'package.json', 'src/main.tsx', '.env', '.env.test', ...publicFiles]
    if (includePwa) read.push('pwa.config.ts')
    for (const file of read) expect(existsSync(join(webPath(), file))).toBe(true)
    expect(existsSync(join(webPath(), 'pwa.config.ts'))).toBe(includePwa)

    const ignored = gitIgnored(read.map((file) => `apps/web/${file}`))
    // `.env` is gitignored, so `$TURBO_DEFAULT$` alone would miss it: it must be listed.
    expect(ignored.has('apps/web/.env')).toBe(true)
    expect(read.filter((file) => !hashed(file, inputs, ignored))).toEqual([])
    // Every env file Vite loads: `.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local`.
    for (const file of ['.env.local', '.env.production', '.env.test.local']) expect(hashed(file, inputs, ignored)).toBe(true)
    // `pwa.config.ts` is hashed by name the day the module is added, not only when it is on.
    expect(hashed('pwa.config.ts', inputs, ignored)).toBe(true)
  })

  it('leaves out what the build never reads, so editing a spec does not rebuild', async () => {
    const tasks = await render(true)
    const inputs = tasks.build.inputs ?? []
    const ignored = gitIgnored(['apps/web/tests/e2e/auth.spec.ts'])
    for (const file of ['tests/e2e/auth.spec.ts', 'playwright.config.ts', 'README.md', 'AGENTS.md']) expect(hashed(file, inputs, ignored)).toBe(false)
  })

  it('hashes and passes the VITE_* variables Vite inlines into the bundle', async () => {
    const tasks = await render(false)
    // Strict env mode strips undeclared variables: a CI-provided VITE_* never reached the build.
    expect(tasks.build.env).toEqual(expect.arrayContaining(['VITE_*']))
  })

  it('keeps the outputs and dependencies the web build inherits from the root task', async () => {
    const tasks = await render(false)
    expect(tasks.build.dependsOn).toBeUndefined()
    expect((tasks.build as { outputs?: string[] }).outputs).toBeUndefined()

    const root = JSON.parse(await readFile(join(target, 'turbo.json'), 'utf8')) as { tasks: Record<string, TurboTask & { outputs?: string[] }> }
    expect(root.tasks.build.dependsOn).toEqual(['^build'])
    expect(root.tasks.build.outputs).toEqual(['dist/**'])
    // The shared packages keep the root inputs: they build with `tsc` from `src/` alone.
    expect(root.tasks.build.inputs).toEqual(expect.arrayContaining(['src/**', 'package.json']))
    expect(root.tasks.build.inputs).not.toContain('$TURBO_DEFAULT$')
  })

  it('builds the web app before its own test:full runs the E2E suite', async () => {
    const tasks = await render(true)
    const { scripts } = JSON.parse(await readFile(join(webPath(), 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(scripts['test:full']).toMatch(/npm run build && npm run test:e2e$/)
    // Run through turbo, the task also needs the shared packages built, and Playwright's variables.
    expect(tasks['test:full'].dependsOn).toEqual(['^build'])
    expect(tasks['test:full'].passThroughEnv).toEqual(expect.arrayContaining(['PLAYWRIGHT_*']))
  })
})
