import { migration003 } from '../../../migrations/manifest/003-classify-harness-capability'
import type { SaaSFoundryManifest } from '../../../types'

const base = (overrides: Partial<SaaSFoundryManifest> = {}): SaaSFoundryManifest => ({
  manifestVersion: 2,
  version: '1.0.0-beta',
  generatedAt: '2026-09-20T00:00:00.000Z',
  structure: 'cli',
  projectName: 'demo',
  modules: { harness: { version: 1 } },
  ...overrides
})

describe('migration003 — classify harness capability', () => {
  it('marks unambiguous workflow-managed legacy harnesses', () => {
    const result = migration003.up(base({ workflow: { tool: 'github-projects' } }))
    expect(result.manifestVersion).toBe(3)
    expect(result.modules?.harness).toEqual({ version: 1, managed: true })
  })

  it('leaves ambiguous legacy manifests unknown', () => {
    expect(migration003.up(base()).modules?.harness).toEqual({ version: 1 })
  })

  it.each([true, false])('preserves an explicit managed=%s decision', (managed) => {
    const input = base({ modules: { harness: { version: 1, managed } } })
    expect(migration003.up(input).modules?.harness?.managed).toBe(managed)
  })

  it('is pure and idempotent', () => {
    const input = base({ workflow: { tool: 'github-projects' } })
    const frozen = JSON.stringify(input)
    const once = migration003.up(input)
    const twice = migration003.up(once)
    expect(JSON.stringify(input)).toBe(frozen)
    expect(twice).toEqual(once)
  })
})
