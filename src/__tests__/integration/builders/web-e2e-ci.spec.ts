import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { renderWebApp } from '../../../builders/web.builder'
import { overlaysPath } from '../../../types'
import { webParams } from '../../helpers/fixtures'

/**
 * #979 — the generated CI ran the web E2E suite red from the bootstrap commit:
 * 1. on CI, Playwright only serves `dist/` (`vite preview`), and nothing built it first;
 * 2. once built, the PWA service worker answered requests before `page.route` saw them,
 *    so WebKit's mocked auth specs reached the network.
 */
describe('generated web E2E on CI (#979)', () => {
  let target: string

  beforeEach(async () => {
    target = await mkdtemp(join(tmpdir(), 'sf-web-e2e-ci-'))
  })

  afterEach(async () => {
    await rm(target, { recursive: true, force: true })
  })

  const render = (isMonorepo: boolean, includePwa: boolean) => renderWebApp({ ...webParams({ isMonorepo, includePwa }), targetDir: target })
  const webPath = (isMonorepo: boolean) => join(target, isMonorepo ? 'apps/web' : 'apps/test-project-web')

  describe.each([
    ['monorepo', true],
    ['multirepo', false]
  ])('%s', (_topology, isMonorepo) => {
    it.each([true, false])('blocks service workers in every Playwright project (PWA %s)', async (includePwa) => {
      await render(isMonorepo, includePwa)

      const config = await readFile(join(webPath(isMonorepo), 'playwright.config.ts'), 'utf8')
      // In the shared `use` block, which every browser project inherits.
      const shared = config.slice(config.indexOf('  use: {'), config.indexOf('  projects: ['))
      expect(shared).toContain("serviceWorkers: 'block'")
      expect(existsSync(join(webPath(isMonorepo), 'pwa.config.ts'))).toBe(includePwa)
    })

    it('serves an existing build on CI, so the pipeline must build before Playwright', async () => {
      await render(isMonorepo, true)

      const config = await readFile(join(webPath(isMonorepo), 'playwright.config.ts'), 'utf8')
      expect(config).toMatch(/command: process\.env\.CI\s*\?\s*'npm run preview -- --mode test --strictPort'/)
    })
  })

  it('makes the monorepo web test:e2e task depend on the web build, not only on its dependencies', async () => {
    await render(true, true)

    const turbo = JSON.parse(await readFile(join(webPath(true), 'turbo.json'), 'utf8'))
    expect(turbo.extends).toEqual(['//'])
    expect(turbo.tasks['test:e2e'].dependsOn).toEqual(expect.arrayContaining(['^build', 'build']))

    // The package config extends a root task: the root must keep declaring it.
    const root = JSON.parse(await readFile(resolve(overlaysPath, 'monorepo/root/turbo.json'), 'utf8'))
    expect(root.tasks['test:e2e']).toBeDefined()
    expect(root.tasks.build).toBeDefined()
  })

  it('builds the standalone web app before its lifecycle lane runs the E2E suite', async () => {
    await render(false, true)

    const { scripts } = JSON.parse(await readFile(join(webPath(false), 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    const lane = scripts['test:impact:lifecycle']
    expect(lane).toMatch(/npm run build && .*npm run test:e2e/)
    expect(existsSync(join(webPath(false), 'turbo.json'))).toBe(false)
  })
})
