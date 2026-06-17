import { evaluatePreconditions } from '../../../status/preconditions'
import type { StatusReport } from '../../../status/collect'

function makeReport(overrides: Partial<StatusReport> = {}): StatusReport {
  return {
    projectRoot: '/tmp/demo',
    manifest: null,
    manifestPath: '/tmp/demo/.saasfoundry.json',
    git: { available: false },
    tools: [],
    checkedNetwork: false,
    installedSkills: [],
    ...overrides
  }
}

describe('evaluatePreconditions', () => {
  it('fails manifest precondition when .saasfoundry.json is missing', () => {
    const preconditions = evaluatePreconditions(makeReport())
    const manifest = preconditions.find((p) => p.name === 'manifest')
    expect(manifest?.status).toBe('fail')
    expect(manifest?.remediation).toContain('sf new')
  })

  it('warns when workflow tool is none', () => {
    const report = makeReport({
      manifest: {
        version: '1.0.0-beta',
        generatedAt: '2026-04-24T00:00:00Z',
        structure: 'monorepo',
        projectName: 'x',
        workflow: { tool: 'none' }
      }
    })
    const workflow = evaluatePreconditions(report).find((p) => p.name === 'workflow')
    expect(workflow?.status).toBe('warn')
  })

  it('marks srs ok when rootPage is configured', () => {
    const report = makeReport({
      manifest: {
        version: '1.0.0-beta',
        generatedAt: '2026-04-24T00:00:00Z',
        structure: 'monorepo',
        projectName: 'x',
        tools: { srs: { enabled: true, backend: 'notion', rootPage: { id: 'a', url: 'b', name: 'Root' } } }
      }
    })
    const srs = evaluatePreconditions(report).find((p) => p.name === 'srs')
    expect(srs?.status).toBe('ok')
    expect(srs?.details).toContain('Root')
  })

  it('warns when srs is enabled but rootPage is missing', () => {
    const report = makeReport({
      manifest: {
        version: '1.0.0-beta',
        generatedAt: '2026-04-24T00:00:00Z',
        structure: 'monorepo',
        projectName: 'x',
        tools: { srs: { enabled: true, backend: 'notion' } }
      }
    })
    const srs = evaluatePreconditions(report).find((p) => p.name === 'srs')
    expect(srs?.status).toBe('warn')
  })

  it('skips srs when the module is not installed', () => {
    const report = makeReport({
      manifest: {
        version: '1.0.0-beta',
        generatedAt: '2026-04-24T00:00:00Z',
        structure: 'monorepo',
        projectName: 'x'
      }
    })
    const srs = evaluatePreconditions(report).find((p) => p.name === 'srs')
    expect(srs?.status).toBe('skip')
    expect(srs?.remediation).toContain('sf update --add-modules srs')
  })

  it('warns on dirty working tree', () => {
    const report = makeReport({ git: { available: true, branch: 'feature/x', isClean: false } })
    const git = evaluatePreconditions(report).find((p) => p.name === 'git')
    expect(git?.status).toBe('warn')
  })

  it('skips gh check when not requested', () => {
    const report = makeReport()
    const gh = evaluatePreconditions(report).find((p) => p.name === 'gh')
    expect(gh?.status).toBe('skip')
  })

  // FR-CONFIG-ENGINE-07 (#448) AC1: a harness-profile manifest (structure 'cli',
  // modules.harness, configured workflow + SRS) reports OK preconditions — no
  // stack-specific check trips on the absence of email/db/s3 modules.
  it('reports ok preconditions on a harness-profile manifest', () => {
    const report = makeReport({
      git: { available: true, branch: 'develop', isClean: true },
      manifest: {
        version: '1.0.0-beta',
        generatedAt: '2026-06-17T00:00:00Z',
        structure: 'cli',
        projectName: 'notulia',
        modules: { harness: { version: 1 } },
        workflow: { tool: 'github-projects' },
        tools: { srs: { enabled: true, backend: 'notion', rootPage: { id: 'a', url: 'b', name: 'Root' } } }
      }
    })

    const preconditions = evaluatePreconditions(report)
    expect(preconditions.some((p) => p.status === 'fail')).toBe(false)
    expect(preconditions.find((p) => p.name === 'manifest')?.status).toBe('ok')
    expect(preconditions.find((p) => p.name === 'workflow')?.status).toBe('ok')
    expect(preconditions.find((p) => p.name === 'srs')?.status).toBe('ok')
    expect(preconditions.find((p) => p.name === 'git')?.status).toBe('ok')
  })
})
