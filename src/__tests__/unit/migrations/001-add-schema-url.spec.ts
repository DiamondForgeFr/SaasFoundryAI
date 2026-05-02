import { migration001 } from '../../../migrations/manifest/001-add-schema-url'
import { manifestSchemaUrl, type SaaSFoundryManifest } from '../../../types'

describe('migration 001 — add-schema-url', () => {
  const baseManifest: SaaSFoundryManifest = {
    version: '1.0.0-beta',
    generatedAt: '2026-04-01T00:00:00.000Z',
    structure: 'cli',
    projectName: 'demo'
  }

  it('declares from=0, to=1', () => {
    expect(migration001.from).toBe(0)
    expect(migration001.to).toBe(1)
    expect(migration001.name).toBe('add-schema-url')
  })

  it('stamps $schema and bumps manifestVersion when missing', () => {
    const result = migration001.up({ ...baseManifest })

    expect(result.$schema).toBe(manifestSchemaUrl)
    expect(result.manifestVersion).toBe(1)
  })

  it('puts $schema as the first key when stamped', () => {
    const result = migration001.up({ ...baseManifest })

    expect(Object.keys(result)[0]).toBe('$schema')
  })

  it('preserves a user-overridden $schema', () => {
    const customUrl = 'https://example.com/custom-schema.json'
    const result = migration001.up({ ...baseManifest, $schema: customUrl })

    expect(result.$schema).toBe(customUrl)
    expect(result.manifestVersion).toBe(1)
  })

  it('is idempotent — running twice yields the same output', () => {
    const once = migration001.up({ ...baseManifest })
    const twice = migration001.up(once)

    expect(twice).toEqual(once)
  })

  it('does not mutate the input manifest', () => {
    const input: SaaSFoundryManifest = { ...baseManifest }
    const snapshot = JSON.parse(JSON.stringify(input))

    migration001.up(input)

    expect(input).toEqual(snapshot)
  })

  it('preserves all other manifest fields', () => {
    const rich: SaaSFoundryManifest = {
      ...baseManifest,
      modules: {
        emailService: 'mailersend',
        s3Setup: 'docker',
        dbSetup: 'docker',
        includeAnalytics: true,
        advancedSkills: ['srs']
      },
      workflow: { tool: 'github-projects' }
    }

    const result = migration001.up(rich)

    expect(result.modules).toEqual(rich.modules)
    expect(result.workflow).toEqual(rich.workflow)
    expect(result.projectName).toBe('demo')
  })
})
