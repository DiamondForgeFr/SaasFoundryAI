import { existsSync, readFileSync } from 'node:fs'
import { posix, resolve } from 'node:path'

/**
 * #1048 — the monorepo web stylesheet told Tailwind v4 to scan
 * `../../../node_modules/@<project>/ui-primitives/src`. That folder exists only when
 * `node_modules` is installed at the repository root. In a git worktree without one, Node still
 * resolves the package from a parent folder, but Tailwind scans nothing: the primitives' classes
 * (`w-(--sidebar-width-icon)`, ...) drop out of the CSS and the fixed sidebar covers the page.
 *
 * The `@source` now names the workspace folder, which every checkout carries. These guards read
 * the templates, so they run on every commit.
 */

const REPO = resolve(__dirname, '../../../..')
const SCAFFOLDS = resolve(REPO, 'scaffolds')
const MONOREPO_INDEX_CSS = resolve(SCAFFOLDS, 'overlays/monorepo/web/src/index.css')
const PRIMITIVES = resolve(SCAFFOLDS, 'overlays/monorepo/root/packages/ui-primitives')

/** The project-relative path of the overlay's `apps/web/src/index.css` in a generated monorepo. */
const GENERATED_INDEX_CSS_DIR = 'apps/web/src'
const EXPECTED_SOURCE = '../../../packages/ui-primitives/src'

const sourcesOf = (css: string): string[] => [...css.matchAll(/^@source\s+['"]([^'"]+)['"];/gm)].map((match) => match[1])

describe('monorepo web @source for the ui-primitives package (#1048)', () => {
  const css = readFileSync(MONOREPO_INDEX_CSS, 'utf8')

  it('points at the workspace folder', () => {
    expect(sourcesOf(css)).toEqual([EXPECTED_SOURCE])
  })

  it('never scans through node_modules, which a git worktree does not have at its root', () => {
    for (const source of sourcesOf(css)) expect(source).not.toContain('node_modules')
  })

  it('resolves to the primitives sources the monorepo builder deposits', () => {
    const resolved = posix.normalize(posix.join(GENERATED_INDEX_CSS_DIR, EXPECTED_SOURCE))
    expect(resolved).toBe('packages/ui-primitives/src')
    expect(existsSync(resolve(SCAFFOLDS, 'overlays/monorepo/root', resolved, 'index.ts'))).toBe(true)
  })

  it('also resolves inside the web Docker image, which copies packages/ next to apps/web', () => {
    const dockerfile = readFileSync(resolve(SCAFFOLDS, 'overlays/monorepo/web/Dockerfile'), 'utf8')
    expect(dockerfile).toMatch(/^WORKDIR \/app$/m)
    expect(dockerfile).toMatch(/^COPY packages \.\/packages$/m)
    expect(dockerfile).toMatch(/^COPY apps\/web\/ \.\/apps\/web\/$/m)
  })

  it('is the path the package documents to consumers', () => {
    for (const doc of [resolve(PRIMITIVES, 'README.md'), resolve(PRIMITIVES, 'src/theme.css')]) {
      const text = readFileSync(doc, 'utf8')
      expect(text).toMatch(/@source ['"]\.\.\/\.\.\/\.\.\/packages\/ui-primitives\/src['"]/)
      expect(text).not.toMatch(/@source ['"][^'"]*node_modules/)
    }
  })

  it('is the path the integration-rules skill teaches, in the template and the dogfood copies', () => {
    const copies = ['scaffolds/skills-templates/core/sf-integration-rules/frontend.md', '.claude/skills/sf-integration-rules/frontend.md', '.agents/skills/sf-integration-rules/frontend.md']
    for (const copy of copies) {
      const text = readFileSync(resolve(REPO, copy), 'utf8')
      expect(text).toContain(`@source '${EXPECTED_SOURCE}'`)
      expect(text).not.toMatch(/@source ['"][^'"]*node_modules/)
    }
  })

  it('leaves the multirepo stylesheet without a package @source: its primitives live in web/src', () => {
    const multirepoCss = readFileSync(resolve(SCAFFOLDS, 'blueprints/web/src/index.css'), 'utf8')
    expect(sourcesOf(multirepoCss)).toEqual([])
    expect(existsSync(resolve(SCAFFOLDS, 'blueprints/web/src/components/ui/shadcn'))).toBe(true)
  })
})
