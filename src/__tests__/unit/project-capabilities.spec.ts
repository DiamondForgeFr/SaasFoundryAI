import { classifyProjectCapabilities } from '../../project-capabilities'
import type { SaaSFoundryManifest } from '../../types'

const base: SaaSFoundryManifest = {
  version: '1.0.0',
  generatedAt: 'x',
  structure: 'monorepo',
  projectName: 'p',
  modules: {
    email: { provider: 'none', version: 1 },
    s3Setup: 'manual',
    dbSetup: 'manual',
    includeAnalytics: false,
    advancedSkills: [],
    harness: { version: 1, managed: false }
  }
}

describe('classifyProjectCapabilities', () => {
  it('classifies current explicit profiles', () => {
    expect(classifyProjectCapabilities(base)).toEqual({ technicalStack: 'present', collaborationHarness: 'core-only', effectiveProfile: 'stack' })
    expect(classifyProjectCapabilities({ ...base, modules: { ...base.modules, harness: { version: 1, managed: true } } }).effectiveProfile).toBe('full')
    expect(classifyProjectCapabilities({ ...base, structure: 'cli', modules: { harness: { version: 1, managed: true }, advancedSkills: [] } }).effectiveProfile).toBe('harness')
  })

  it('keeps a current pre-discriminator stack manifest legacy-unknown', () => {
    const manifest = { ...base, modules: { ...base.modules, harness: { version: 1 } } }
    expect(classifyProjectCapabilities(manifest)).toEqual({ technicalStack: 'present', collaborationHarness: 'legacy-unknown', effectiveProfile: 'unknown' })
  })

  it('uses workflow evidence for a legacy managed harness', () => {
    const manifest: SaaSFoundryManifest = {
      ...base,
      structure: 'cli',
      modules: { harness: { version: 1 }, advancedSkills: [] },
      workflow: { tool: 'github-projects' }
    }
    expect(classifyProjectCapabilities(manifest)).toEqual({ technicalStack: 'absent', collaborationHarness: 'managed', effectiveProfile: 'harness' })
  })

  it('does not mistake a multirepo child projection for a technical coordinator', () => {
    const manifest: SaaSFoundryManifest = { ...base, structure: 'cli', modules: { harness: { version: 1, managed: false }, advancedSkills: [] } }
    expect(classifyProjectCapabilities(manifest).technicalStack).toBe('absent')
  })

  it.each([
    { ...base, modules: { ...base.modules, dbSetup: undefined } },
    { ...base, structure: 'cli' as const },
    { ...base, workflow: { tool: 'github-projects' as const } }
  ])('fails closed on partial or contradictory state', (manifest) => {
    expect(classifyProjectCapabilities(manifest as SaaSFoundryManifest).effectiveProfile).toBe('inconsistent')
  })
})
