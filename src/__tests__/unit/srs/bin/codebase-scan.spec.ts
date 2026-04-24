import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { collectFiles } from '../../../../srs/bin/codebase-scan'

describe('collectFiles', () => {
  let scanRoot: string

  beforeEach(() => {
    scanRoot = mkdtempSync(join(tmpdir(), 'sf-scan-'))
    mkdirSync(join(scanRoot, 'src'), { recursive: true })
    mkdirSync(join(scanRoot, 'scaffolds'), { recursive: true })
    mkdirSync(join(scanRoot, 'docs'), { recursive: true })
    writeFileSync(join(scanRoot, 'src', 'a.ts'), 'export const a = 1\n')
    writeFileSync(join(scanRoot, 'scaffolds', 'tmpl.ts'), 'export const t = 2\n')
    writeFileSync(join(scanRoot, 'docs', 'readme.md'), '# readme\n')
  })

  it('includes every project file by default', () => {
    const files = collectFiles(scanRoot)
    expect(files).toContain('src/a.ts')
    expect(files).toContain('scaffolds/tmpl.ts')
    expect(files).toContain('docs/readme.md')
  })

  it('excludes files listed in a .srsignore at the scan root', () => {
    writeFileSync(join(scanRoot, '.srsignore'), 'scaffolds/\ndocs/\n')
    const files = collectFiles(scanRoot)
    expect(files).toContain('src/a.ts')
    expect(files).not.toContain('scaffolds/tmpl.ts')
    expect(files).not.toContain('docs/readme.md')
  })

  it('excludes files matched by manifest-provided patterns', () => {
    const files = collectFiles(scanRoot, { exclude: ['scaffolds/', 'docs/'] })
    expect(files).toContain('src/a.ts')
    expect(files).not.toContain('scaffolds/tmpl.ts')
    expect(files).not.toContain('docs/readme.md')
  })

  it('combines .srsignore and manifest exclusions (additive)', () => {
    writeFileSync(join(scanRoot, '.srsignore'), 'docs/\n')
    const files = collectFiles(scanRoot, { exclude: ['scaffolds/'] })
    expect(files).toContain('src/a.ts')
    expect(files).not.toContain('scaffolds/tmpl.ts')
    expect(files).not.toContain('docs/readme.md')
  })

  it('still respects .gitignore alongside .srsignore', () => {
    writeFileSync(join(scanRoot, '.gitignore'), 'docs/\n')
    writeFileSync(join(scanRoot, '.srsignore'), 'scaffolds/\n')
    const files = collectFiles(scanRoot)
    expect(files).toContain('src/a.ts')
    expect(files).not.toContain('scaffolds/tmpl.ts')
    expect(files).not.toContain('docs/readme.md')
  })
})
