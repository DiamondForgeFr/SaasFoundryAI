import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

/**
 * #587 — `sf status` knew the manifest, the workflow, the SRS and the git tree, and none of
 * those is the reason a generated project fails to start.
 *
 * A user hit a taken port and read four `ok`s, then 219 TypeScript errors that never
 * mentioned a port: the port stopped `initAndStartDb`, so `db:setup:dev` never ran, so no
 * Prisma client was generated, so every `@/generated/prisma` import failed.
 *
 * These tests use a real temp directory rather than a mock of `fs`: what is being checked is
 * whether a path exists, and a stub of that answer is a stub of the conclusion.
 */
describe('runtime preconditions (#587)', () => {
  let dir: string

  const generated = (structure: 'monorepo' | 'multirepo', overrides: Record<string, unknown> = {}) => ({
    version: '1.0.0-beta',
    generatedAt: '2026-08-31T00:00:00Z',
    structure,
    projectName: 'demo',
    modules: { email: { provider: 'none' as const, version: 1 }, s3Setup: 'manual' as const, dbSetup: 'docker' as const, includeAnalytics: false, advancedSkills: [] },
    ...overrides
  })

  const evaluate = (report: Partial<StatusReport>) => evaluatePreconditions(makeReport({ projectRoot: dir, ...report }))
  const find = (report: Partial<StatusReport>, name: string) => evaluate(report).find((p) => p.name === name)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sf-runtime-precond-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  describe('on the CLI itself, they are not applicable', () => {
    it.each(['dependencies', 'database', 'ormClient'])('%s is skip, never fail', (name) => {
      const p = find({ manifest: { version: '1', generatedAt: 'x', structure: 'cli', projectName: 'sf' } }, name)

      expect(p?.status).toBe('skip')
      expect(p?.details).toBe('Not a generated project')
    })

    it.each(['dependencies', 'database', 'ormClient'])('%s is skip when there is no manifest at all', (name) => {
      expect(find({}, name)?.status).toBe('skip')
    })
  })

  describe('dependencies', () => {
    it('fails per app in multirepo, naming an install for each', () => {
      const p = find({ manifest: generated('multirepo') }, 'dependencies')

      expect(p?.status).toBe('fail')
      expect(p?.remediation).toBe('sf resume   (or: npm install --prefix apps/demo-api && npm install --prefix apps/demo-web)')
    })

    it('fails at the root in monorepo, where the install actually happens', () => {
      const p = find({ manifest: generated('monorepo') }, 'dependencies')

      expect(p?.status).toBe('fail')
      expect(p?.remediation).toBe('sf resume   (or: npm install)')
    })

    it('passes once the directories exist', () => {
      mkdirSync(join(dir, 'apps/demo-api/node_modules'), { recursive: true })
      mkdirSync(join(dir, 'apps/demo-web/node_modules'), { recursive: true })

      expect(find({ manifest: generated('multirepo') }, 'dependencies')?.status).toBe('ok')
    })

    it('still fails when only one of the two is installed', () => {
      mkdirSync(join(dir, 'apps/demo-api/node_modules'), { recursive: true })
      const p = find({ manifest: generated('multirepo') }, 'dependencies')

      expect(p?.status).toBe('fail')
      expect(p?.remediation).toBe('sf resume   (or: npm install --prefix apps/demo-web)')
    })
  })

  describe('database', () => {
    it("is not this project's concern when it does not host one", () => {
      const manifest = generated('multirepo', { modules: { email: { provider: 'none', version: 1 }, s3Setup: 'manual', dbSetup: 'credentials', includeAnalytics: false, advancedSkills: [] } })
      const p = find({ manifest }, 'database')

      expect(p?.status).toBe('skip')
      expect(p?.details).toContain('credentials')
    })

    /** Unreached is not unreachable — the distinction recap.sh already draws elsewhere. */
    it('is skip, not fail, when nobody asked', () => {
      const p = find({ manifest: generated('multirepo') }, 'database')

      expect(p?.status).toBe('skip')
      expect(p?.details).toContain('Not checked')
    })

    it('fails on the port the project actually chose, not on 5435 by assumption', () => {
      const manifest = generated('multirepo', { ports: { db: 5436, api: 3501, web: 5174 } })
      const p = find({ manifest, database: { port: 5436, reachable: false } }, 'database')

      expect(p?.status).toBe('fail')
      expect(p?.details).toContain('5436')
      expect(p?.remediation).toBe('sf resume   (or: docker compose -f apps/demo-api/docker-compose.dev-services.yml up -d db-dev)')
    })

    it('passes when it answers', () => {
      expect(find({ manifest: generated('multirepo'), database: { port: 5435, reachable: true } }, 'database')?.status).toBe('ok')
    })
  })

  describe('ORM client', () => {
    it('fails and names the import that will not resolve', () => {
      const p = find({ manifest: generated('multirepo') }, 'ormClient')

      expect(p?.status).toBe('fail')
      expect(p?.details).toContain('@/generated/prisma')
      expect(p?.remediation).toBe('sf resume   (or: npm run db:setup:dev --prefix apps/demo-api)')
    })

    it('looks under apps/api in a monorepo', () => {
      const p = find({ manifest: generated('monorepo') }, 'ormClient')

      expect(p?.remediation).toBe('sf resume   (or: npm run db:setup:dev --prefix apps/api)')
    })

    it('passes once the client is generated', () => {
      mkdirSync(join(dir, 'apps/demo-api/src/generated/prisma'), { recursive: true })

      expect(find({ manifest: generated('multirepo') }, 'ormClient')?.status).toBe('ok')
    })
  })

  describe('every remediation runs as printed', () => {
    /**
     * The half of #582 that was missing: the old message said
     * `docker compose -f <other-project>/…` — a placeholder a human must resolve and an
     * agent can do nothing with.
     */
    it('leads with the one command that does all of it (#588)', () => {
      const manifest = generated('multirepo', { ports: { db: 5436, api: 3501, web: 5174 } })
      const remediations = evaluate({ manifest, database: { port: 5436, reachable: false } })
        .filter((p) => p.status === 'fail' && p.remediation)
        .map((p) => p.remediation as string)

      // `sf resume` knows the topology; the literal stays beside it so the line remains
      // actionable without the CLI on PATH.
      for (const remediation of remediations) expect(remediation.startsWith('sf resume')).toBe(true)
    })

    it('contains no placeholder to interpret', () => {
      const manifest = generated('multirepo', { ports: { db: 5436, api: 3501, web: 5174 } })
      const remediations = evaluate({ manifest, database: { port: 5436, reachable: false } })
        .filter((p) => p.status === 'fail' && p.remediation)
        .map((p) => p.remediation as string)

      expect(remediations.length).toBeGreaterThan(0)
      for (const remediation of remediations) {
        expect(remediation).not.toMatch(/<[^>]+>/)
        expect(remediation).not.toContain('...')
      }
    })

    it('reports the whole scenario the ticket describes in three lines', () => {
      const manifest = generated('multirepo', { ports: { db: 5436, api: 3501, web: 5174 } })
      const runtime = evaluate({ manifest, database: { port: 5436, reachable: false } }).filter((p) => ['dependencies', 'database', 'ormClient'].includes(p.name))

      expect(runtime.map((p) => `${p.status} ${p.name}`)).toEqual(['fail dependencies', 'fail database', 'fail ormClient'])
    })
  })
})
