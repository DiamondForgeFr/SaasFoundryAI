import { readFileSync } from 'fs'
import { join } from 'path'

import { manifestMigrations } from '../../../migrations/manifest'
import { runManifestMigrations, targetManifestVersion } from '../../../migrations/manifest/registry'
import { manifestSchemaUrl, type SaaSFoundryManifest } from '../../../types'

const FIXTURES_DIR = join(__dirname, 'fixtures')

const readJsonFixture = (relativePath: string): unknown => JSON.parse(readFileSync(join(FIXTURES_DIR, relativePath), 'utf8'))

/**
 * Golden-fixture harness — every registered migration MUST ship a
 * `before.json` + `after.json` pair under `fixtures/<NNN>-<name>/`. The
 * harness drives `migration.up(before)` and asserts the result equals
 * `after`, byte-for-byte at the JSON level. This lets reviewers eyeball
 * the data shape transition in PR diffs instead of inferring it from
 * imperative code.
 */
describe('manifest migration — golden fixtures', () => {
  for (const migration of manifestMigrations) {
    const fixtureKey = `${String(migration.from + 1).padStart(3, '0')}-${migration.name}`

    describe(`${fixtureKey}`, () => {
      it('matches before/after fixtures', () => {
        const before = readJsonFixture(`${fixtureKey}/before.json`) as SaaSFoundryManifest
        const after = readJsonFixture(`${fixtureKey}/after.json`) as SaaSFoundryManifest

        const result = migration.up(before)

        expect(result).toEqual(after)
      })

      it('after fixture has manifestVersion === migration.to', () => {
        const after = readJsonFixture(`${fixtureKey}/after.json`) as SaaSFoundryManifest
        expect(after.manifestVersion).toBe(migration.to)
      })
    })
  }
})

/**
 * Full-chain assertion — feed a frozen "as it shipped" v0 manifest through
 * the dispatcher and pin the resulting shape. This catches accidental
 * regressions where a new migration changes the end-state of older fields
 * without updating the chain expectation.
 */
describe('manifest migration — full chain (v0 → current)', () => {
  it('upgrades a legacy v0 manifest to the current target version', () => {
    const legacy = readJsonFixture('v0-legacy.json') as SaaSFoundryManifest

    const result = runManifestMigrations(legacy)

    expect(result.fromVersion).toBe(0)
    expect(result.toVersion).toBe(targetManifestVersion())
    expect(result.appliedMigrations).toHaveLength(manifestMigrations.length)
    expect(result.manifest.manifestVersion).toBe(targetManifestVersion())
    expect(result.manifest.$schema).toBe(manifestSchemaUrl)
  })

  it('preserves all original fields through the chain', () => {
    const legacy = readJsonFixture('v0-legacy.json') as SaaSFoundryManifest

    const { manifest } = runManifestMigrations(legacy)

    expect(manifest.version).toBe(legacy.version)
    expect(manifest.projectName).toBe(legacy.projectName)
    expect(manifest.structure).toBe(legacy.structure)
    expect(manifest.modules).toEqual(legacy.modules)
    expect(manifest.fileHashes).toEqual(legacy.fileHashes)
  })

  it('produces a manifest that conforms to the JSON schema', async () => {
    // Defer the ajv import so this suite stays cheap when the chain is empty.
    const Ajv = (await import('ajv')).default
    const addFormats = (await import('ajv-formats')).default
    const schema = readJsonFixture('../../../../../schemas/saasfoundry-manifest.schema.json')

    const ajv = new Ajv({ strict: false, allErrors: true })
    addFormats(ajv)
    const validate = ajv.compile(schema as object)

    const legacy = readJsonFixture('v0-legacy.json') as SaaSFoundryManifest
    const { manifest } = runManifestMigrations(legacy)

    const valid = validate(manifest)
    if (!valid) {
      throw new Error(`Migrated manifest failed schema validation: ${JSON.stringify(validate.errors, null, 2)}`)
    }
    expect(valid).toBe(true)
  })
})
