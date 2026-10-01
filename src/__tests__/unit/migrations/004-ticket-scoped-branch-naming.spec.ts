import { migration004 } from '../../../migrations/manifest/004-ticket-scoped-branch-naming'
import type { SaaSFoundryManifest } from '../../../types'

const manifestWith = (branchNaming?: NonNullable<SaaSFoundryManifest['workflow']>['branchNaming']): SaaSFoundryManifest => ({
  manifestVersion: 3,
  version: '1.0.0-beta',
  generatedAt: '2026-06-22T00:00:00.000Z',
  structure: 'monorepo',
  projectName: 'acme',
  workflow: { tool: 'github-projects', ...(branchNaming ? { branchNaming } : {}) }
})

describe('migration 004 — ticket-scoped branch naming (#864)', () => {
  it('gives the pre-#480 defaults the ticket placeholder the PR guards require', () => {
    const result = migration004.up(manifestWith({ feature: 'feature/{name}', fix: 'fix/{name}', release: 'rc-{version}' }))

    expect(result.manifestVersion).toBe(4)
    expect(result.workflow?.branchNaming).toEqual({ feature: 'feature/{N}-{description}', fix: 'fix/{N}-{description}', release: 'rc-{version}' })
  })

  it('scopes a customized pattern to the ticket the same way', () => {
    const result = migration004.up(manifestWith({ feature: 'feat/{description}', fix: 'hotfix/{name}' }))

    expect(result.workflow?.branchNaming).toEqual({ feature: 'feat/{N}-{description}', fix: 'hotfix/{N}-{description}' })
  })

  it.each(['feature/{N}-{description}', 'feature/{ticket}-{name}', 'feature/{issue-number}', 'feature/{number}/{description}'])('leaves %s as written: it already names the ticket', (feature) => {
    expect(migration004.up(manifestWith({ feature })).workflow?.branchNaming).toEqual({ feature })
  })

  it('leaves a pattern with no placeholder at all for the guards to report', () => {
    expect(migration004.up(manifestWith({ feature: 'feature/work' })).workflow?.branchNaming).toEqual({ feature: 'feature/work' })
  })

  it('only stamps the version on a manifest without branch naming or without a workflow', () => {
    expect(migration004.up(manifestWith())).toEqual({ ...manifestWith(), manifestVersion: 4 })
    const noWorkflow: SaaSFoundryManifest = { ...manifestWith() }
    delete noWorkflow.workflow
    expect(migration004.up(noWorkflow)).toEqual({ ...noWorkflow, manifestVersion: 4 })
  })

  it('is idempotent', () => {
    const once = migration004.up(manifestWith({ feature: 'feature/{name}', fix: 'fix/{name}' }))

    expect(migration004.up(once)).toEqual(once)
  })

  it('does not mutate its input', () => {
    const input = manifestWith({ feature: 'feature/{name}' })
    const snapshot = structuredClone(input)

    migration004.up(input)

    expect(input).toEqual(snapshot)
  })
})
