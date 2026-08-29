import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import glob from 'glob'

/**
 * #610 — a project that declined storage shipped a unit suite that did not compile.
 *
 * The blueprint gates storage code behind `// TODO storage-service-active:`, which the
 * installer strips when the module is selected. `organization.service.spec.ts` was never
 * given the marker, so its import of `@modules/storage/…` was unconditional — fine with
 * storage installed, fatal without it.
 *
 * Nothing could see it: `tsconfig.build.json` excludes `**\/*spec.ts`, so every build in
 * the docker matrix compiled around the one broken file. This guard is the cheap half of
 * the answer; #594's boot scenario, which runs the suite, is the other.
 */

const API_BLUEPRINT = join(__dirname, '../../../../scaffolds/blueprints/api')

/** Modules a user can decline, and the marker that gates each one's code. */
const DECLINABLE_MODULES = [{ importPath: '@modules/storage/', marker: '// TODO storage-service-active:' }]

const sourceFiles = glob.sync('src/**/*.ts', { cwd: API_BLUEPRINT }).map((relative) => ({ relative, content: readFileSync(join(API_BLUEPRINT, relative), 'utf8') }))

describe('no blueprint file imports a declinable module unconditionally (#610)', () => {
  it('finds the blueprint, so an empty glob cannot pass silently', () => {
    expect(sourceFiles.length).toBeGreaterThan(50)
  })

  it.each(DECLINABLE_MODULES)('every reference to $importPath is gated', ({ importPath, marker }) => {
    const ungated = sourceFiles
      .filter(({ content }) => content.includes(importPath))
      .flatMap(({ relative, content }) =>
        content
          .split('\n')
          .map((line, index) => ({ relative, index: index + 1, line }))
          .filter(({ line }) => line.includes(importPath) && !line.trimStart().startsWith(marker))
      )

    // The module's own files are its implementation, not a consumer of it.
    const offenders = ungated.filter(({ relative }) => !relative.startsWith('src/modules/storage/'))

    expect(offenders.map((o) => `${o.relative}:${o.index}`)).toEqual([])
  })

  it('the spec that started this carries the marker on both of its storage lines', () => {
    const spec = readFileSync(join(API_BLUEPRINT, 'src/modules/organizations/tests/unit/organization.service.spec.ts'), 'utf8')

    expect(spec).toContain('// TODO storage-service-active: import { StorageService }')
    expect(spec).toContain('// TODO storage-service-active:   provide: StorageService,')
  })
})

describe('the installer activates every gated file', () => {
  const installer = readFileSync(join(__dirname, '../../../installers/storage.installer.ts'), 'utf8')

  it('drives them from one list rather than a block per file', () => {
    // Five copy-pasted read/replace/write blocks are how a sixth file was forgotten.
    expect(installer).toContain('STORAGE_GATED_FILES')
    // One place strips the marker. More than one means the list has grown a bypass.
    expect(installer.match(/\.replace\(STORAGE_MARKER/g)?.length).toBe(1)
    expect(installer).not.toMatch(/replace\(\/\\\/\\\/ TODO storage-service-active/)
  })

  it('carries every file the blueprint gates, not just the ones someone remembered', () => {
    for (const file of ['src/configs/env/services/env.service.ts', 'src/app.module.ts', 'src/modules/organizations/organizations.module.ts']) {
      expect(installer).toContain(file)
    }
  })

  it('includes the spec', () => {
    expect(installer).toContain('src/modules/organizations/tests/unit/organization.service.spec.ts')
  })
})
