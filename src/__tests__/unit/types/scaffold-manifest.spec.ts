import { SaaSFoundryManifest, isScaffoldManifest } from '../../../types'

const base = { version: '1.0.0', generatedAt: 'x', structure: 'multirepo' as const, projectName: 'p' }

describe('isScaffoldManifest', () => {
  it('accepts a full scaffolded manifest', () => {
    const manifest: SaaSFoundryManifest = {
      ...base,
      modules: { email: { provider: 'none', version: 1 }, s3Setup: 'manual', dbSetup: 'manual', includeAnalytics: false, advancedSkills: [] }
    }
    expect(isScaffoldManifest(manifest)).toBe(true)
  })

  it('rejects a harness-only manifest (modules.harness without stack keys)', () => {
    const manifest: SaaSFoundryManifest = { ...base, structure: 'cli', modules: { harness: { version: 1 } } }
    expect(isScaffoldManifest(manifest)).toBe(false)
  })

  it('rejects a manifest without a modules block', () => {
    expect(isScaffoldManifest({ ...base, structure: 'cli' })).toBe(false)
  })

  it('narrows the type: scaffold manifests expose the stack keys non-optionally', () => {
    const manifest: SaaSFoundryManifest = {
      ...base,
      modules: { email: { provider: 'mailersend', version: 1 }, s3Setup: 'docker', dbSetup: 'docker', includeAnalytics: true, advancedSkills: ['context7'], harness: { version: 1 } }
    }
    if (isScaffoldManifest(manifest)) {
      // No optional chaining needed — this is the compile-time contract
      expect(manifest.modules.email.provider).toBe('mailersend')
      expect(manifest.modules.advancedSkills).toEqual(['context7'])
      expect(manifest.modules.harness?.version).toBe(1)
    } else {
      throw new Error('expected scaffold manifest')
    }
  })
})
