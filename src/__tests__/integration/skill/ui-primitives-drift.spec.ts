import { readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'

// Regression guard for #303: the canonical monorepo `packages/ui-primitives/src`
// and the multirepo-friendly blueprint `apps/web/src/components/ui/shadcn` must
// stay equivalent. They differ only by import paths (cn() and inter-primitive
// imports use `@/...` aliases in the blueprint vs relative paths in the
// package), so we normalize those before comparing.

const ROOT = resolve(__dirname, '../../../..')
const CANONICAL = join(ROOT, 'scaffolds/overlays/monorepo/root/packages/ui-primitives/src')
const BLUEPRINT = join(ROOT, 'scaffolds/blueprints/web/src/components/ui/shadcn')

function listTsxFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.tsx') && statSync(join(dir, f)).isFile())
    .sort()
}

function normalizeForBlueprint(canonical: string): string {
  return canonical
    .replace(/from '\.\/lib\/utils'/g, "from '@/utils/ui'")
    .replace(/from '\.\/hooks\/use-is-mobile'/g, "from '@/hooks/ui/useIsMobile'")
    .replace(/from '\.\/([a-z-]+)'/g, "from '@/components/ui/shadcn/$1'")
}

describe('ui-primitives drift guard (#303)', () => {
  const canonicalFiles = listTsxFiles(CANONICAL)

  it('canonical directory has the expected primitive set', () => {
    expect(canonicalFiles.length).toBeGreaterThanOrEqual(27)
    expect(canonicalFiles).toContain('button.tsx')
    expect(canonicalFiles).toContain('dialog.tsx')
    expect(canonicalFiles).toContain('sidebar.tsx')
  })

  it('blueprint shadcn/ ≡ canonical (same file list)', () => {
    expect(listTsxFiles(BLUEPRINT)).toEqual(canonicalFiles)
  })

  for (const fileName of listTsxFiles(CANONICAL)) {
    it(`${fileName} matches blueprint after import-path normalization`, () => {
      const canonical = readFileSync(join(CANONICAL, fileName), 'utf8')
      const blueprint = readFileSync(join(BLUEPRINT, fileName), 'utf8')
      expect(blueprint).toBe(normalizeForBlueprint(canonical))
    })
  }
})
