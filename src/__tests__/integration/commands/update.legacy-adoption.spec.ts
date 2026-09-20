import { gunzipSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { updateCommand } from '../../../commands/update'
import { detectLegacyAdoption } from '../../../legacy-adoption/legacy-adoption'
import { LEGACY_BETA_MULTIREPO_BASELINE } from '../../../legacy-adoption/legacy-beta-baseline'

jest.mock('../../../utils', () => ({
  ...jest.requireActual('../../../utils'),
  checkNodeVersion: jest.fn()
}))

const fixtureRoot = resolve(__dirname, '../../fixtures/legacy-beta')

describe('sf update --adopt-legacy', () => {
  let parent: string
  let projectRoot: string
  let originalCwd: string
  let logSpy: jest.SpyInstance

  async function writeLegacyApp(): Promise<void> {
    const api = join(projectRoot, 'apps/legacy-app-api')
    const web = join(projectRoot, 'apps/legacy-app-web')
    const compressed = await readFile(join(fixtureRoot, 'multirepo-baseline.json.gz'))
    const exact = JSON.parse(gunzipSync(compressed).toString('utf8')) as Record<'api' | 'web', Record<string, string>>
    for (const role of ['api', 'web'] as const) {
      const root = role === 'api' ? api : web
      for (const path of Object.keys(LEGACY_BETA_MULTIREPO_BASELINE[role])) {
        const target = join(root, ...path.split('/'))
        await mkdir(join(target, '..'), { recursive: true })
        await writeFile(target, exact[role][path] ? Buffer.from(exact[role][path], 'base64') : `user-customized ${path}\n`)
      }
      const packagePath = join(root, 'package.json')
      const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
      pkg.name = 'legacy-app-api'
      pkg.description = 'Legacy app'
      pkg.repository.url = 'https://example.com/legacy-app.git'
      pkg.keywords = ['legacy-app', 'saasfoundry', 'backend', 'nest', 'prisma']
      await writeFile(packagePath, JSON.stringify(pkg, null, 2))
    }
    await writeFile(join(api, 'user-customized.ts'), 'keep me\n')
  }

  beforeEach(async () => {
    parent = join(tmpdir(), `sf-legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    projectRoot = join(parent, 'legacy-app')
    await mkdir(projectRoot, { recursive: true })
    await writeLegacyApp()
    await writeFile(join(projectRoot, 'README.md'), 'user-owned root file\n')
    originalCwd = process.cwd()
    process.chdir(projectRoot)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(async () => {
    logSpy.mockRestore()
    process.chdir(originalCwd)
    await rm(parent, { recursive: true, force: true }).catch(() => {})
  })

  it('produces a deterministic, read-only adoption plan', async () => {
    const first = await detectLegacyAdoption({ projectRoot, mainBranch: 'main' })
    const second = await detectLegacyAdoption({ projectRoot, mainBranch: 'main' })

    expect(first.report).toEqual(second.report)
    expect(first.report.legacyAdoption).toMatchObject({
      status: 'would-adopt',
      topology: 'multirepo',
      projectName: 'legacy-app',
      mainBranch: 'main'
    })
    expect(first.report.legacyAdoption.managedPaths).toContain('apps/legacy-app-api/nest-cli.json')
    expect(first.report.legacyAdoption.unmanagedPaths).toContain('apps/legacy-app-api/user-customized.ts')
    expect(first.report.legacyAdoption.unmanagedPaths).toContain('README.md')
    await expect(readFile('.saasfoundry.json')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('requires the reviewed fingerprint and then creates only the manifest', async () => {
    const plan = await detectLegacyAdoption({ projectRoot, mainBranch: 'main' })
    const fingerprint = plan.report.legacyAdoption.fingerprint!

    await expect(updateCommand({ adoptLegacy: true, projectName: 'legacy-app', mainBranch: 'main' })).rejects.toThrow(/matching dry-run fingerprint/)
    await updateCommand({ adoptLegacy: true, adoptPlan: fingerprint, projectName: 'legacy-app', mainBranch: 'main' })

    const manifest = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    expect(manifest).toMatchObject({
      version: '1.0.0-beta',
      structure: 'multirepo',
      projectName: 'legacy-app',
      adoption: { kind: 'legacy', planFingerprint: fingerprint, refreshPending: true }
    })
    expect(manifest.unmanagedPaths).toContain('README.md')
    expect(await readFile('apps/legacy-app-api/user-customized.ts', 'utf8')).toBe('keep me\n')
  })

  it('fails closed when a release signature changed', async () => {
    await writeFile('apps/legacy-app-web/src/main.tsx', 'customized entrypoint\n')
    const plan = await detectLegacyAdoption({ projectRoot, mainBranch: 'main' })
    expect(plan.report.legacyAdoption).toMatchObject({ status: 'blocked', reasonCode: 'signature-mismatch' })
  })

  it('rejects a copied handful of public signatures without the full release inventory', async () => {
    await rm(join(projectRoot, 'apps'), { recursive: true, force: true })
    const api = join(projectRoot, 'apps/legacy-app-api')
    const web = join(projectRoot, 'apps/legacy-app-web')
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
    await rm('apps/legacy-app-web/components.json')
    await symlink('tsconfig.json', 'apps/legacy-app-web/components.json')
    const plan = await detectLegacyAdoption({ projectRoot, mainBranch: 'main' })
    expect(plan.report.legacyAdoption).toMatchObject({ status: 'blocked', reasonCode: 'unsafe-filesystem-entry' })
  })

  it('rejects special files without blocking on them', async () => {
    if (process.platform === 'win32') return
    const fifo = join(projectRoot, 'apps/legacy-app-api/untrusted.fifo')
    execFileSync('mkfifo', [fifo])
    const plan = await detectLegacyAdoption({ projectRoot, mainBranch: 'main' })
    expect(plan.report.legacyAdoption).toMatchObject({ status: 'blocked', reasonCode: 'unsafe-filesystem-entry' })
  })

  it('rejects oversized evidence before reading it into memory', async () => {
    const oversized = join(projectRoot, 'apps/legacy-app-api/oversized.bin')
    await writeFile(oversized, '')
    await truncate(oversized, 64 * 1024 * 1024 + 1)
    const plan = await detectLegacyAdoption({ projectRoot, mainBranch: 'main' })
    expect(plan.report.legacyAdoption).toMatchObject({ status: 'blocked', reasonCode: 'unsafe-filesystem-entry' })
  })

  it('never replaces an existing manifest', async () => {
    await writeFile('.saasfoundry.json', '{"version":"user-owned"}\n')
    await expect(updateCommand({ adoptLegacy: true, adoptPlan: '0'.repeat(64), projectName: 'legacy-app', mainBranch: 'main' })).rejects.toThrow(/already exists/)
    expect(await readFile('.saasfoundry.json', 'utf8')).toBe('{"version":"user-owned"}\n')
  })
})
