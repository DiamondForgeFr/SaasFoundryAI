import { classifyProjectCapabilities, hasTechnicalStack } from '../../project-capabilities'
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
    const manifest: SaaSFoundryManifest = {
      ...base,
      structure: 'cli',
      projection: { kind: 'multirepo-child', rootProjectName: 'p', app: 'api' },
      modules: { harness: { version: 1, managed: true }, advancedSkills: [] }
    }
    expect(classifyProjectCapabilities(manifest)).toMatchObject({ technicalStack: 'absent', effectiveProfile: 'projection' })
  })

  it('fails closed for a legacy multirepo child generated before projection markers', () => {
    const manifest: SaaSFoundryManifest = {
      ...base,
      structure: 'cli',
      projectName: 'acme-api',
      mainBranch: 'main',
      workflow: undefined,
      modules: { harness: { version: 1, managed: true }, advancedSkills: [] },
      fileHashes: {}
    }
    expect(classifyProjectCapabilities(manifest)).toMatchObject({ technicalStack: 'absent', effectiveProfile: 'projection' })
  })

  it.each([
    { ...base, modules: { ...base.modules, dbSetup: undefined } },
    { ...base, structure: 'cli' as const },
    { ...base, workflow: { tool: 'github-projects' as const } }
  ])('fails closed on partial or contradictory state', (manifest) => {
    expect(classifyProjectCapabilities(manifest as SaaSFoundryManifest).effectiveProfile).toBe('inconsistent')
  })

  describe('the stackless email block of manifest migration 002', () => {
    const cliHarness: SaaSFoundryManifest = {
      version: '1.1.0',
      generatedAt: 'x',
      structure: 'cli',
      projectName: 'saasfoundryai-cli',
      workflow: { tool: 'github-projects' },
      modules: { email: { provider: 'none', version: 1 }, harness: { version: 5, managed: true } }
    }

    it('is not a technical stack: a cli project with a managed harness is a harness project', () => {
      expect(classifyProjectCapabilities(cliHarness)).toEqual({ technicalStack: 'absent', collaborationHarness: 'managed', effectiveProfile: 'harness' })
    })

    it('stays absent when the manifest also lists advanced skills', () => {
      const manifest = { ...cliHarness, modules: { ...cliHarness.modules, advancedSkills: [] } }
      expect(classifyProjectCapabilities(manifest).technicalStack).toBe('absent')
    })

    it.each([
      ['a provider that sends mail', { email: { provider: 'mailersend' as const, version: 1 } }],
      ['a database setup', { email: { provider: 'none' as const, version: 1 }, dbSetup: 'docker' as const }],
      ['an object-storage setup', { email: { provider: 'none' as const, version: 1 }, s3Setup: 'manual' as const }],
      ['the analytics flag', { email: { provider: 'none' as const, version: 1 }, includeAnalytics: false }]
    ])('stays contradictory next to %s', (_name, extra) => {
      const manifest: SaaSFoundryManifest = { ...cliHarness, modules: { ...extra, harness: { version: 5, managed: true } } }
      expect(classifyProjectCapabilities(manifest)).toMatchObject({ technicalStack: 'inconsistent', effectiveProfile: 'inconsistent' })
    })

    it('does not make a stack of a non-cli project', () => {
      const manifest: SaaSFoundryManifest = { ...cliHarness, structure: 'monorepo' }
      expect(classifyProjectCapabilities(manifest).technicalStack).toBe('inconsistent')
    })

    it('does not let a legacy multirepo child pass as a standalone harness', () => {
      const child: SaaSFoundryManifest = {
        ...cliHarness,
        projectName: 'acme-api',
        workflow: undefined,
        mainBranch: 'main',
        fileHashes: {},
        modules: { email: { provider: 'none', version: 1 }, harness: { version: 5, managed: true }, advancedSkills: [] }
      }
      expect(classifyProjectCapabilities(child)).toMatchObject({ technicalStack: 'absent', effectiveProfile: 'projection' })
    })
  })

  it('keeps hasTechnicalStack true for a contradictory manifest and false for the stackless email block', () => {
    const cli: SaaSFoundryManifest = { ...base, structure: 'cli', modules: { email: { provider: 'none', version: 1 }, harness: { version: 5, managed: true } }, workflow: { tool: 'github-projects' } }
    expect(hasTechnicalStack(cli)).toBe(false)
    expect(hasTechnicalStack({ ...cli, modules: { ...cli.modules, dbSetup: 'docker' } })).toBe(true)
  })
})
