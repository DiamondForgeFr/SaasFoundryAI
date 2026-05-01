import { renderClaudeFriendly, renderHuman, renderJson } from '../../../status/render'
import type { StatusReport } from '../../../status/collect'
import type { Precondition } from '../../../status/preconditions'

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
    expect(parsed.preconditions).toHaveLength(1)
    expect(parsed.preconditions[0]).toEqual({ name: 'manifest', description: 'Manifest present', status: 'ok', details: 'v1.0.0-beta', remediation: null })
  })

  it('serialises a null manifest correctly', () => {
    const out = renderJson({ report: makeReport({ manifest: null }), preconditions: [failPrecondition] })
    const parsed = JSON.parse(out)
    expect(parsed.manifest).toBeNull()
  })
})

describe('renderClaudeFriendly', () => {
  it('emits markdown with the usage block and status lines', () => {
    const out = renderClaudeFriendly({ report: makeReport(), preconditions: [okPrecondition, failPrecondition] })
    expect(out).toContain('# SaaSFoundry project status')
    expect(out).toContain('- [ok] Manifest present')
    expect(out).toContain('- [fail] Manifest present')
    expect(out).toContain('remediation: Run sf new')
    expect(out).toContain('## How to use this output')
  })

  it('handles missing manifest gracefully', () => {
    const out = renderClaudeFriendly({ report: makeReport({ manifest: null }), preconditions: [failPrecondition] })
    expect(out).toContain('NOT a SaaSFoundry project')
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
