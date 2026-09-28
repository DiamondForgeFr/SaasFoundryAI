import { readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'

// Regression guard for #301: the three physical copies of `packages/shared-validation`
// (canonical monorepo overlay + multirepo-friendly blueprint vendored copies for
// api and web) must stay byte-identical. Drift here = silent validation divergence
// across topologies — the very problem this package was created to solve.

const ROOT = resolve(__dirname, '../../../..')
const CANONICAL = join(ROOT, 'scaffolds/overlays/monorepo/root/packages/shared-validation/src')
const BLUEPRINT_API = join(ROOT, 'scaffolds/blueprints/api/src/shared-validation')
const BLUEPRINT_WEB = join(ROOT, 'scaffolds/blueprints/web/src/shared-validation')

function listTsFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && statSync(join(dir, f)).isFile())
    .sort()
}

describe('shared-validation drift guard (#301)', () => {
  const canonicalFiles = listTsFiles(CANONICAL)

  it('canonical directory is non-empty', () => {
    expect(canonicalFiles.length).toBeGreaterThan(0)
  })

  it.each(['blueprints/api', 'blueprints/web'])('%s/src/shared-validation ≡ canonical (same file list)', (location) => {
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
