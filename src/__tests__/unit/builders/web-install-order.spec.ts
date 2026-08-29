import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * #608 — the PWA module was reported installed while its dependency never was.
 *
 * `createWebApp` ran `npm install` before the module installers, and `installPwaModule`
 * adds `vite-plugin-pwa` to package.json and its import to vite.config.ts. The generated
 * web app therefore carried a config importing a package nothing had installed, and
 * `npm run dev` died before Vite started. The manifest recorded `pwa: { version: 1 }`.
 *
 * The invariant is an ordering one, which a source read is the honest way to check: a test
 * that generated a project and inspected node_modules would be asserting that npm works.
 * What must hold is that nothing mutates package.json after the install that consumes it.
 */

const source = readFileSync(join(__dirname, '../../../builders/web.builder.ts'), 'utf8')

const positionOf = (needle: string): number => {
  const at = source.indexOf(needle)
  if (at === -1) throw new Error(`web.builder.ts no longer contains ${needle} — this guard needs updating, not deleting`)
  return at
}

describe('the web install runs after everything that can touch package.json (#608)', () => {
  const installAt = positionOf('npm install (web)')

  it.each([
    ['the analytics module', 'installAnalyticsModule('],
    ['the PWA module', 'installPwaModule('],
    ['the workflow artefacts', 'installWorkflowArtifacts(']
  ])('installs after %s has run', (_label, call) => {
    expect(positionOf(call)).toBeLessThan(installAt)
  })

  it('installs before the repository is initialised, so the commit carries a working tree', () => {
    expect(installAt).toBeLessThan(positionOf('git init (web)'))
  })

  it('is the only install in this builder — one final package.json, one install', () => {
    expect(source.match(/npm install --prefix/g)?.length).toBe(1)
  })
})

describe('the PWA installer declares a dependency it does not install itself', () => {
  const pwaInstaller = readFileSync(join(__dirname, '../../../installers/pwa.installer.ts'), 'utf8')

  it('adds vite-plugin-pwa to package.json', () => {
    expect(pwaInstaller).toContain("devDependencies['vite-plugin-pwa']")
  })

  it('imports it from vite.config.ts, which is what makes the ordering load-bearing', () => {
    expect(pwaInstaller).toContain("from 'vite-plugin-pwa'")
  })

  /**
   * Deliberate: the builder installs once at the end, so a module that adds a dependency
   * needs no install of its own. If this ever stops being true, the guard above is what
   * keeps the two from disagreeing.
   */
  it('runs no install of its own', () => {
    expect(pwaInstaller).not.toContain('npm install')
  })
})
