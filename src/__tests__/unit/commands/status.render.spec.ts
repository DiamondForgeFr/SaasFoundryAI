import { renderClaudeFriendly, renderHuman, renderJson } from '../../../status/render'
import { describeProjectCapabilities, type StatusReport } from '../../../status/collect'
import type { Precondition } from '../../../status/preconditions'
import type { SaaSFoundryManifest } from '../../../types'

const fullCapabilities = describeProjectCapabilities({
  version: '1.0.0-beta',
  generatedAt: '2026-04-24T00:00:00Z',
  structure: 'monorepo',
  projectName: 'demo',
  modules: {
    email: { provider: 'none', version: 0 },
    s3Setup: 'manual',
    dbSetup: 'manual',
    includeAnalytics: false,
    advancedSkills: [],
    harness: { version: 1, managed: true }
  }
})

function makeReport(overrides: Partial<StatusReport> = {}): StatusReport {
  return {
    projectRoot: '/tmp/demo',
    manifest: {
      version: '1.0.0-beta',
      generatedAt: '2026-04-24T00:00:00Z',
      structure: 'monorepo',
      projectName: 'demo',
      workflow: { tool: 'github-projects' },
      tools: { srs: { enabled: true, backend: 'notion', rootPage: { id: 'x', url: 'y', name: 'SRS root' } } }
    },
    manifestPath: '/tmp/demo/.saasfoundry.json',
    git: { available: true, branch: 'develop', isClean: true },
    tools: [],
    checkedNetwork: false,
    installedSkills: [],
    capabilities: fullCapabilities,
    ...overrides
  }
}

const okPrecondition: Precondition = { name: 'manifest', description: 'Manifest present', status: 'ok', details: 'v1.0.0-beta' }
const failPrecondition: Precondition = { name: 'manifest', description: 'Manifest present', status: 'fail', remediation: 'Run sf new' }

describe('renderJson', () => {
  it('produces parseable JSON with the report + preconditions', () => {
    const out = renderJson({ report: makeReport(), preconditions: [okPrecondition] })
    const parsed = JSON.parse(out)
    expect(parsed.manifest.projectName).toBe('demo')
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.capabilities.effectiveProfile).toBe('full')
    expect(parsed.preconditions).toHaveLength(1)
    expect(parsed.preconditions[0]).toEqual({ name: 'manifest', description: 'Manifest present', status: 'ok', details: 'v1.0.0-beta', remediation: null })
  })

  it('serialises a null manifest correctly', () => {
    const out = renderJson({ report: makeReport({ manifest: null, capabilities: null }), preconditions: [failPrecondition] })
    const parsed = JSON.parse(out)
    expect(parsed.manifest).toBeNull()
    expect(parsed.capabilities).toBeNull()
  })
})

describe('project capability status', () => {
  const base: SaaSFoundryManifest = {
    version: '1.0.0-beta',
    generatedAt: '2026-04-24T00:00:00Z',
    structure: 'monorepo',
    projectName: 'demo'
  }
  const technicalModules = {
    email: { provider: 'none' as const, version: 0 },
    s3Setup: 'manual' as const,
    dbSetup: 'manual' as const,
    includeAnalytics: false,
    advancedSkills: []
  }

  it.each([
    [
      'full',
      { ...base, modules: { ...technicalModules, harness: { version: 1, managed: true } } },
      { effectiveProfile: 'full', technicalStack: 'present', collaborationHarness: 'managed', preview: null }
    ],
    [
      'stack',
      { ...base, modules: { ...technicalModules, harness: { version: 1, managed: false } } },
      { effectiveProfile: 'stack', technicalStack: 'present', collaborationHarness: 'core-only', preview: 'sf update' }
    ],
    [
      'harness',
      { ...base, structure: 'cli', modules: { harness: { version: 1, managed: true }, advancedSkills: [] } },
      { effectiveProfile: 'harness', technicalStack: 'absent', collaborationHarness: 'managed', preview: 'sf update' }
    ],
    ['unknown', { ...base, modules: { ...technicalModules } }, { effectiveProfile: 'unknown', technicalStack: 'present', collaborationHarness: 'legacy-unknown', preview: null }],
    [
      'inconsistent',
      { ...base, modules: { email: { provider: 'none', version: 0 }, harness: { version: 1, managed: true } } },
      { effectiveProfile: 'inconsistent', technicalStack: 'inconsistent', collaborationHarness: 'managed', preview: null }
    ]
  ] as const)('describes the %s state', (_name, manifest, expected) => {
    const capabilities = describeProjectCapabilities(manifest as SaaSFoundryManifest)
    expect(capabilities).toMatchObject({
      effectiveProfile: expected.effectiveProfile,
      technicalStack: expected.technicalStack,
      collaborationHarness: expected.collaborationHarness
    })
    expect(capabilities.reason).toBeTruthy()
    if (expected.preview) expect(capabilities.previewCommand).toContain(expected.preview)
    else expect(capabilities.previewCommand).toBeNull()
  })

  it('exposes the same partial-profile guidance in every render', () => {
    const capabilities = describeProjectCapabilities({ ...base, modules: { ...technicalModules, harness: { version: 1, managed: false } } })
    const report = makeReport({ capabilities })
    const payload = { report, preconditions: [okPrecondition] }

    expect(renderHuman(payload)).toContain('Preview full profile: sf update --target-profile full --dry-run --json')
    expect(renderClaudeFriendly(payload)).toContain('- full-profile preview: sf update --target-profile full --dry-run --json')
    expect(JSON.parse(renderJson(payload)).capabilities.previewCommand).toBe('sf update --target-profile full --dry-run --json')
  })
})

describe('renderClaudeFriendly', () => {
  it('emits markdown with the usage block and status lines', () => {
    const out = renderClaudeFriendly({ report: makeReport(), preconditions: [okPrecondition, failPrecondition] })
    expect(out).toContain('# SaaSFoundryAI project status')
    expect(out).toContain('- [ok] Manifest present')
    expect(out).toContain('- [fail] Manifest present')
    expect(out).toContain('remediation: Run sf new')
    expect(out).toContain('## How to use this output')
  })

  it('handles missing manifest gracefully', () => {
    const out = renderClaudeFriendly({ report: makeReport({ manifest: null }), preconditions: [failPrecondition] })
    expect(out).toContain('NOT a SaaSFoundryAI project')
  })
})

describe('renderHuman', () => {
  it('includes project name and branch in the header', () => {
    const out = renderHuman({ report: makeReport(), preconditions: [okPrecondition] })
    expect(out).toContain('demo')
    expect(out).toContain('develop')
    expect(out).toContain('Manifest present')
  })
})

// The claude-friendly render feeds the SessionStart hook, so it is where an
// agent learns the rule. It must state the languages every run — including the
// all-English case, which is precisely the one an agent would otherwise guess
// wrong when the conversation is in another language.
describe('output language in the status renders', () => {
  it('always names the three surfaces in the claude-friendly render', () => {
    const out = renderClaudeFriendly({ report: makeReport(), preconditions: [okPrecondition] })
    expect(out).toContain('- output language: srs en, tickets en, code comments en')
  })

  it('tells the agent the conversation language is not the signal', () => {
    const out = renderClaudeFriendly({ report: makeReport(), preconditions: [okPrecondition] })
    expect(out).toContain('The language of the conversation is NOT the signal')
  })

  it('reports what the project actually configured', () => {
    const report = makeReport()
    report.manifest = { ...report.manifest!, language: { srs: 'fr' } }
    const out = renderClaudeFriendly({ report, preconditions: [okPrecondition] })
    expect(out).toContain('- output language: srs fr, tickets en, code comments en')
  })

  it('resolves the block in the JSON render so consumers never re-implement the default', () => {
    const parsed = JSON.parse(renderJson({ report: makeReport(), preconditions: [okPrecondition] }))
    expect(parsed.manifest.language).toEqual({ srs: 'en', tickets: 'en', codeComments: 'en' })
  })

  it('stays quiet in the human render while everything is English', () => {
    const out = renderHuman({ report: makeReport(), preconditions: [okPrecondition] })
    expect(out).not.toContain('AI writes in:')
  })

  it('speaks up in the human render as soon as a surface is opted out', () => {
    const report = makeReport()
    report.manifest = { ...report.manifest!, language: { tickets: 'fr' } }
    const out = renderHuman({ report, preconditions: [okPrecondition] })
    expect(out).toContain('srs en, tickets fr, code comments en')
  })
})
