import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { updateCommand } from '../../../commands/update'
import { detectLegacyAdoption } from '../../../legacy-adoption/legacy-adoption'
import { LEGACY_BETA_MULTIREPO_BASELINE } from '../../../legacy-adoption/legacy-beta-baseline'
import { canonicalTreeDigest, materializeLegacyReleaseFixture } from '../../../../tests/docker/legacy-release-fixture'

jest.mock('../../../utils', () => ({
  ...jest.requireActual('../../../utils'),
  checkNodeVersion: jest.fn()
}))

const CLI_ROOT = resolve(__dirname, '../../../..')
const CLI = join(CLI_ROOT, 'bin/sf.js')
const PROJECT_NAME = 'previous-release'
const FIXTURE = join(CLI_ROOT, 'tests/docker/fixtures/previous-release/1.0.0-beta/multirepo.fixture.json.gz')
const CHILD_TIMEOUT = 120_000
const MAX_BUFFER = 32 * 1024 * 1024
const FIXTURE_UNMANAGED_PATHS = [
  `apps/${PROJECT_NAME}-api/.env`,
  `apps/${PROJECT_NAME}-api/.env.test`,
  `apps/${PROJECT_NAME}-api/package-lock.json`,
  `apps/${PROJECT_NAME}-web/.env`,
  `apps/${PROJECT_NAME}-web/.env.test`,
  `apps/${PROJECT_NAME}-web/package-lock.json`
] as const

jest.setTimeout(CHILD_TIMEOUT)

describe('sf update --adopt-legacy', () => {
  let fixtureBytes: Buffer
  let parent: string
  let projectRoot: string
  let originalCwd: string
  let logSpy: jest.SpyInstance | undefined

  function runCli(args: string[]): SpawnSyncReturns<string> {
    return spawnSync(process.execPath, [CLI, 'update', ...args], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, CI: 'true', NO_COLOR: '1', FORCE_COLOR: '0' },
      timeout: CHILD_TIMEOUT,
      maxBuffer: MAX_BUFFER
    })
  }

  function expectCliSuccess(result: SpawnSyncReturns<string>): void {
    expect({ status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }).toMatchObject({
      status: 0,
      signal: null,
      error: undefined
    })
  }

  function previewAndAdopt(): { legacyAdoption: { fingerprint: string } } {
    const preview = runCli(['--adopt-legacy', '--dry-run', '--json', '--project-name', PROJECT_NAME, '--main-branch', 'main'])
    expectCliSuccess(preview)
    const adoption = JSON.parse(preview.stdout)
    expect(adoption).toMatchObject({
      version: 1,
      mutated: false,
      legacyAdoption: {
        status: 'would-adopt',
        topology: 'multirepo',
        projectName: PROJECT_NAME,
        mainBranch: 'main'
      }
    })
    expect(adoption.legacyAdoption.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(existsSync(join(projectRoot, '.saasfoundry.json'))).toBe(false)

    const applied = runCli(['--adopt-legacy', '--project-name', PROJECT_NAME, '--main-branch', 'main', '--adopt-plan', adoption.legacyAdoption.fingerprint])
    expectCliSuccess(applied)
    return adoption
  }

  beforeAll(async () => {
    execFileSync(process.execPath, [join(CLI_ROOT, 'node_modules/typescript/bin/tsc')], {
      cwd: CLI_ROOT,
      env: { ...process.env, HUSKY: '0' },
      stdio: 'pipe',
      timeout: CHILD_TIMEOUT,
      maxBuffer: MAX_BUFFER
    })
    fixtureBytes = await readFile(FIXTURE)
  })

  beforeEach(async () => {
    parent = join(tmpdir(), `sf-legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    projectRoot = join(parent, PROJECT_NAME)
    await mkdir(parent, { recursive: true })
    await materializeLegacyReleaseFixture(fixtureBytes, projectRoot)
    await writeFile(join(projectRoot, 'user-canary.txt'), 'keep me byte-for-byte\n')
    originalCwd = process.cwd()
    process.chdir(projectRoot)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(async () => {
    logSpy?.mockRestore()
    if (originalCwd) process.chdir(originalCwd)
    await rm(parent, { recursive: true, force: true }).catch(() => {})
  })

  it('uses the real CLI to adopt, refresh, add a late capability, and remain idempotent', async () => {
    const adoption = previewAndAdopt()
    expect(JSON.parse(await readFile('.saasfoundry.json', 'utf8'))).toMatchObject({
      version: '1.0.0-beta',
      structure: 'multirepo',
      projectName: PROJECT_NAME,
      modules: { harness: { version: 1, managed: false } },
      adoption: { kind: 'legacy', planFingerprint: adoption.legacyAdoption.fingerprint, refreshPending: true }
    })

    const refreshPreview = runCli(['--non-interactive', '--dry-run', '--json'])
    expectCliSuccess(refreshPreview)
    expect(JSON.parse(refreshPreview.stdout).templateUpdate.status).not.toBe('blocked')

    const refreshed = runCli(['--non-interactive', '--accept-template-updates'])
    expectCliSuccess(refreshed)
    expect(JSON.parse(await readFile('.saasfoundry.json', 'utf8'))).toMatchObject({ adoption: { refreshPending: false } })
    expect(await readFile('user-canary.txt', 'utf8')).toBe('keep me byte-for-byte\n')

    const lateCapability = runCli(['--non-interactive', '--accept-template-updates', '--add-modules', 'analytics'])
    expectCliSuccess(lateCapability)
    expect(JSON.parse(await readFile('.saasfoundry.json', 'utf8'))).toMatchObject({ modules: { includeAnalytics: true } })
    expect(await readFile('user-canary.txt', 'utf8')).toBe('keep me byte-for-byte\n')

    const stableDigest = await canonicalTreeDigest(projectRoot)
    const repeated = runCli(['--non-interactive', '--accept-template-updates', '--add-modules', 'analytics'])
    expectCliSuccess(repeated)
    expect(await canonicalTreeDigest(projectRoot)).toBe(stableDigest)
  })

  it('uses the real CLI to reject a managed-signature conflict without creating a manifest', async () => {
    await writeFile(`apps/${PROJECT_NAME}-web/src/main.tsx`, 'customized managed entrypoint\n')
    const result = runCli(['--adopt-legacy', '--dry-run', '--json', '--project-name', PROJECT_NAME, '--main-branch', 'main'])

    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout).legacyAdoption).toMatchObject({ status: 'blocked', reasonCode: 'signature-mismatch' })
    await expect(readFile('.saasfoundry.json')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves a post-adoption managed edit, keeps refresh pending, and defers late modules', async () => {
    previewAndAdopt()
    const preview = runCli(['--non-interactive', '--dry-run', '--json'])
    expectCliSuccess(preview)
    const report = JSON.parse(preview.stdout)
    expect(report.templateUpdate).toMatchObject({ status: 'would-apply' })
    expect(report.templateUpdate.update.length).toBeGreaterThan(0)

    const managedPath = (report.templateUpdate.update as string[]).find((path) => path.endsWith('package.json')) ?? report.templateUpdate.update[0]
    const edited = Buffer.concat([await readFile(managedPath), Buffer.from('\nuser-managed-conflict\n')])
    await writeFile(managedPath, edited)

    const result = runCli(['--non-interactive', '--accept-template-updates', '--conflict-strategy', 'save-new', '--add-modules', 'analytics'])
    expectCliSuccess(result)
    expect(await readFile(managedPath)).toEqual(edited)
    await expect(readFile(`${managedPath}.saasfoundry.new`)).resolves.toBeInstanceOf(Buffer)
    const manifest = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    expect(manifest.adoption.refreshPending).toBe(true)
    expect(manifest.modules.includeAnalytics).not.toBe(true)
    await expect(readFile(`apps/${PROJECT_NAME}-web/src/lib/analytics/analytics.ts`)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('produces a deterministic, read-only adoption plan from the published fixture', async () => {
    const first = await detectLegacyAdoption({ projectRoot, mainBranch: 'main' })
    const second = await detectLegacyAdoption({ projectRoot, mainBranch: 'main' })

    expect(first.report).toEqual(second.report)
    expect(first.report.legacyAdoption).toMatchObject({
      status: 'would-adopt',
      topology: 'multirepo',
      projectName: PROJECT_NAME,
      mainBranch: 'main'
    })
    const expectedManagedPaths = [
      ...Object.keys(LEGACY_BETA_MULTIREPO_BASELINE.api).map((path) => `apps/${PROJECT_NAME}-api/${path}`),
      ...Object.keys(LEGACY_BETA_MULTIREPO_BASELINE.web).map((path) => `apps/${PROJECT_NAME}-web/${path}`)
    ]
      .filter((path) => !FIXTURE_UNMANAGED_PATHS.includes(path as (typeof FIXTURE_UNMANAGED_PATHS)[number]))
      .sort()
    expect(first.report.legacyAdoption.managedPaths).toEqual(expectedManagedPaths)
    expect(first.report.legacyAdoption.unmanagedPaths).toEqual([...FIXTURE_UNMANAGED_PATHS, 'user-canary.txt'].sort())
    await expect(readFile('.saasfoundry.json')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a copied handful of public signatures without the full release inventory', async () => {
    await rm(join(projectRoot, 'apps'), { recursive: true, force: true })
    const api = join(projectRoot, `apps/${PROJECT_NAME}-api`)
    const web = join(projectRoot, `apps/${PROJECT_NAME}-web`)
    for (const role of ['api', 'web'] as const) {
      const root = role === 'api' ? api : web
      for (const path of Object.keys(LEGACY_BETA_MULTIREPO_BASELINE[role]).slice(0, 8)) {
        const target = join(root, ...path.split('/'))
        await mkdir(join(target, '..'), { recursive: true })
        await writeFile(target, 'lookalike\n')
      }
    }
    const plan = await detectLegacyAdoption({ projectRoot, mainBranch: 'main' })
    expect(plan.report.legacyAdoption).toMatchObject({ status: 'blocked', reasonCode: 'signature-mismatch' })
  })

  it('refuses a partial competing topology', async () => {
    await mkdir('apps/api', { recursive: true })
    const plan = await detectLegacyAdoption({ projectRoot, mainBranch: 'main' })
    expect(plan.report.legacyAdoption).toMatchObject({ status: 'blocked', reasonCode: 'ambiguous-topology' })
  })

  it('rejects monorepo because the verified beta disabled that generator path', async () => {
    await rm(join(projectRoot, 'apps'), { recursive: true, force: true })
    await mkdir(join(projectRoot, 'apps/api'), { recursive: true })
    await mkdir(join(projectRoot, 'apps/web'), { recursive: true })
    const plan = await detectLegacyAdoption({ projectRoot, mainBranch: 'main' })
    expect(plan.report.legacyAdoption).toMatchObject({ status: 'blocked', reasonCode: 'unsupported-legacy-layout' })
  })

  it('rejects linked evidence', async () => {
    await rm(`apps/${PROJECT_NAME}-web/components.json`)
    await symlink('tsconfig.json', `apps/${PROJECT_NAME}-web/components.json`)
    const plan = await detectLegacyAdoption({ projectRoot, mainBranch: 'main' })
    expect(plan.report.legacyAdoption).toMatchObject({ status: 'blocked', reasonCode: 'unsafe-filesystem-entry' })
  })

  it('rejects special files without blocking on them', async () => {
    if (process.platform === 'win32') return
    const fifo = join(projectRoot, `apps/${PROJECT_NAME}-api/untrusted.fifo`)
    execFileSync('mkfifo', [fifo])
    const plan = await detectLegacyAdoption({ projectRoot, mainBranch: 'main' })
    expect(plan.report.legacyAdoption).toMatchObject({ status: 'blocked', reasonCode: 'unsafe-filesystem-entry' })
  })

  it('rejects oversized evidence before reading it into memory', async () => {
    const oversized = join(projectRoot, `apps/${PROJECT_NAME}-api/oversized.bin`)
    await writeFile(oversized, '')
    await truncate(oversized, 64 * 1024 * 1024 + 1)
    const plan = await detectLegacyAdoption({ projectRoot, mainBranch: 'main' })
    expect(plan.report.legacyAdoption).toMatchObject({ status: 'blocked', reasonCode: 'unsafe-filesystem-entry' })
  })

  it('never replaces an existing manifest', async () => {
    await writeFile('.saasfoundry.json', '{"version":"user-owned"}\n')
    await expect(updateCommand({ adoptLegacy: true, adoptPlan: '0'.repeat(64), projectName: PROJECT_NAME, mainBranch: 'main' })).rejects.toThrow(/already exists/)
    expect(await readFile('.saasfoundry.json', 'utf8')).toBe('{"version":"user-owned"}\n')
  })
})
