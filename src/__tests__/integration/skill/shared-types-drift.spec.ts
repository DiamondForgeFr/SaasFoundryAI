import { readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'

// Regression guard for #300: the three physical copies of `packages/shared-types`
// (canonical monorepo overlay + multirepo-friendly blueprint vendored copies for
// api and web) must stay byte-identical. Drift here = silent type divergence
// across topologies, which is exactly what shared-types is meant to prevent.

const ROOT = resolve(__dirname, '../../../..')
const CANONICAL = join(ROOT, 'scaffolds/overlays/monorepo/root/packages/shared-types/src')
const BLUEPRINT_API = join(ROOT, 'scaffolds/blueprints/api/src/shared-types')
const BLUEPRINT_WEB = join(ROOT, 'scaffolds/blueprints/web/src/shared-types')

function listTsFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && statSync(join(dir, f)).isFile())
    .sort()
}

describe('shared-types drift guard (#300)', () => {
  const canonicalFiles = listTsFiles(CANONICAL)

  it('canonical directory is non-empty', () => {
    expect(canonicalFiles.length).toBeGreaterThan(0)
  })

  it.each(['blueprints/api', 'blueprints/web'])('%s/src/shared-types ≡ canonical (same file list)', (location) => {
    const dir = location === 'blueprints/api' ? BLUEPRINT_API : BLUEPRINT_WEB
    expect(listTsFiles(dir)).toEqual(canonicalFiles)
  })

  for (const fileName of listTsFiles(CANONICAL)) {
    it(`${fileName} is byte-identical across all three copies`, () => {
      const canonical = readFileSync(join(CANONICAL, fileName), 'utf8')
      const api = readFileSync(join(BLUEPRINT_API, fileName), 'utf8')
      const web = readFileSync(join(BLUEPRINT_WEB, fileName), 'utf8')
      expect(api).toBe(canonical)
      expect(web).toBe(canonical)
    })
  }
})
