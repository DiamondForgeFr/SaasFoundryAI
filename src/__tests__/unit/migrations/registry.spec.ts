import { manifestMigrations } from '../../../migrations/manifest'
import { assertContiguousRegistry, runManifestMigrations, targetManifestVersion } from '../../../migrations/manifest/registry'
import type { ManifestMigration } from '../../../migrations/manifest/types'
import { manifestSchemaUrl, type SaaSFoundryManifest } from '../../../types'

const baseManifest: SaaSFoundryManifest = {
  version: '1.0.0-beta',
  generatedAt: '2026-04-01T00:00:00.000Z',
  structure: 'cli',
  projectName: 'demo'
}

const fakeMigration = (from: number, name = `mig-${from}`): ManifestMigration => ({
  from,
  to: from + 1,
  name,
  up: (m) => ({ ...m, manifestVersion: from + 1 })
})

describe('assertContiguousRegistry', () => {
  it('accepts an empty registry', () => {
    expect(() => assertContiguousRegistry([])).not.toThrow()
  })

  it('accepts a contiguous chain starting at 0', () => {
    expect(() => assertContiguousRegistry([fakeMigration(0), fakeMigration(1), fakeMigration(2)])).not.toThrow()
  })

  it('rejects a chain that does not start at 0', () => {
    expect(() => assertContiguousRegistry([fakeMigration(1)])).toThrow(/gap at version 0/)
  })

  it('rejects a gap between consecutive migrations', () => {
    expect(() => assertContiguousRegistry([fakeMigration(0), fakeMigration(2)])).toThrow(/gap at version 1/)
  })

  it('rejects a migration whose to !== from + 1', () => {
    const broken: ManifestMigration = { from: 0, to: 5, name: 'jump', up: (m) => m }
    expect(() => assertContiguousRegistry([broken])).toThrow(/to === from \+ 1/)
  })

  it('validates the live registry shipped with the CLI', () => {
    expect(() => assertContiguousRegistry(manifestMigrations)).not.toThrow()
  })
})

describe('targetManifestVersion', () => {
  it('returns 0 for an empty registry', () => {
    expect(targetManifestVersion([])).toBe(0)
  })

  it('returns the highest to value', () => {
    expect(targetManifestVersion([fakeMigration(0), fakeMigration(1), fakeMigration(2)])).toBe(3)
  })

  it('reports the live registry target (matches the last shipped migration)', () => {
    // Reads the live registry rather than pinning a magic number, so adding a
    // new migration only requires touching the migrations folder + index.
    const expected = manifestMigrations[manifestMigrations.length - 1].to
    expect(targetManifestVersion()).toBe(expected)
  })
})

describe('runManifestMigrations', () => {
  it('runs every migration on a manifest with no manifestVersion (treated as 0)', () => {
    const result = runManifestMigrations(baseManifest)

    const target = manifestMigrations[manifestMigrations.length - 1].to
    expect(result.fromVersion).toBe(0)
    expect(result.toVersion).toBe(target)
    expect(result.appliedMigrations).toHaveLength(manifestMigrations.length)
    expect(result.appliedMigrations[0].name).toBe('add-schema-url')
    expect(result.manifest.$schema).toBe(manifestSchemaUrl)
    expect(result.manifest.manifestVersion).toBe(target)
  })

  it('skips when manifest is already at target version', () => {
    const target = manifestMigrations[manifestMigrations.length - 1].to
    const upToDate: SaaSFoundryManifest = { ...baseManifest, manifestVersion: target, $schema: manifestSchemaUrl }
    const result = runManifestMigrations(upToDate)

    expect(result.appliedMigrations).toHaveLength(0)
    expect(result.fromVersion).toBe(target)
    expect(result.toVersion).toBe(target)
    expect(result.manifest).toBe(upToDate)
  })

  it('runs only the remaining migrations when partially applied', () => {
    const registry = [fakeMigration(0, 'a'), fakeMigration(1, 'b'), fakeMigration(2, 'c')]
    const partial: SaaSFoundryManifest = { ...baseManifest, manifestVersion: 1 }

    const result = runManifestMigrations(partial, registry)

    expect(result.appliedMigrations.map((m) => m.name)).toEqual(['b', 'c'])
    expect(result.fromVersion).toBe(1)
    expect(result.toVersion).toBe(3)
    expect(result.manifest.manifestVersion).toBe(3)
  })

  it('is idempotent — running the dispatcher twice produces the same result', () => {
    const once = runManifestMigrations(baseManifest)
    const twice = runManifestMigrations(once.manifest)

    expect(twice.appliedMigrations).toHaveLength(0)
    expect(twice.manifest).toEqual(once.manifest)
  })

  it('asserts registry contiguity before mutating the manifest', () => {
    const broken = [fakeMigration(0), fakeMigration(2)]
    expect(() => runManifestMigrations(baseManifest, broken)).toThrow(/gap at version 1/)
  })

  it('propagates errors from a failing migration', () => {
    const failing: ManifestMigration = {
      from: 0,
      to: 1,
      name: 'boom',
      up: () => {
        throw new Error('boom')
      }
    }
    expect(() => runManifestMigrations(baseManifest, [failing])).toThrow(/boom/)
  })
})
