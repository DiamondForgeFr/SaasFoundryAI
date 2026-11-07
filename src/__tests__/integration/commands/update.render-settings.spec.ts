import { copy } from 'fs-extra'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import shelljs from 'shelljs'

import { regenerateInTempDir, updateCommand } from '../../../commands/update'
import { targetManifestVersion } from '../../../migrations/manifest/registry'
import { manifestSchemaUrl, type SaaSFoundryManifest } from '../../../types'
import { hashFileContent } from '../../../utils'
import { legacyRenderSettings, type RenderSettings } from '../../../utils/live-render-settings'

jest.mock('../../../utils', () => ({
  ...jest.requireActual('../../../utils'),
  checkNodeVersion: jest.fn()
}))

jest.mock('ora', () => () => {
  const spinner: Record<string, unknown> = { text: '', succeed: jest.fn(), fail: jest.fn(), stop: jest.fn() }
  spinner.start = jest.fn(() => spinner)
  return spinner
})

/**
 * `sf update` on a project generated with its own answers (#1151).
 *
 * Seen on DiamondForge, 1.0.1 to 1.1.0: the template of `deployment-api.yml` did not change,
 * yet the regeneration rendered it with a placeholder sender, so the file read as changed,
 * an edited copy got a false conflict, an untouched one would have been overwritten, and the
 * placeholder render became the baseline.
 */
describe('sf update keeps the answers sf new rendered (#1151)', () => {
  const workflow = '.github/workflows/deployment-api.yml'
  const devServices = 'apps/api/docker-compose.dev-services.yml'
  const sender = { email: 'noreply@diamondforge.fr', name: "DiamondForge's Forge" }
  const senderLines = [`env_line MAILERSEND_SENDER_EMAIL 'noreply@diamondforge.fr'`, `env_line MAILERSEND_SENDER_NAME 'DiamondForge'\\''s Forge'`]
  const placeholderLines = [`env_line MAILERSEND_SENDER_EMAIL 'noreply@example.com'`, `env_line MAILERSEND_SENDER_NAME 'App'`]

  let root: string
  let project: string
  let originalCwd: string
  let spies: jest.SpyInstance[]

  const manifestFor = (modules: Partial<SaaSFoundryManifest['modules']> = {}): SaaSFoundryManifest => ({
    $schema: manifestSchemaUrl,
    manifestVersion: targetManifestVersion(),
    version: '1.0.1',
    generatedAt: '2026-06-22T21:07:04.662Z',
    structure: 'monorepo',
    projectName: 'diamondforge',
    mainBranch: 'master',
    modules: { email: { provider: 'mailersend', version: 1 }, s3Setup: 'manual', dbSetup: 'manual', includeAnalytics: false, advancedSkills: [], ...modules }
  })

  const projectSettings = (overrides: Partial<RenderSettings> = {}): RenderSettings => ({
    mailersendSenderEmail: sender.email,
    mailersendSenderName: sender.name,
    dbUser: 'db_dev_user',
    dbPassword: 'db_dev_password',
    dbName: 'db_dev',
    ...overrides
  })

  /** Render the project with `settings` (the answers of `sf new`) and return the rendered files' hashes. */
  const render = async (manifest: SaaSFoundryManifest, settings: RenderSettings, into?: string): Promise<{ hashes: Record<string, string>; read: (path: string) => Promise<string> }> => {
    const empty = await mkdtemp(join(tmpdir(), 'sf-settings-empty-'))
    try {
      const { tempDir, hashes } = await regenerateInTempDir(manifest, empty, settings)
      const rendered = join(tempDir, manifest.projectName)
      const contents = new Map<string, string>()
      for (const path of [workflow, devServices]) contents.set(path, await readFile(join(rendered, path), 'utf8').catch(() => ''))
      if (into) await copy(rendered, into)
      await rm(tempDir, { recursive: true, force: true })
      return { hashes, read: async (path) => contents.get(path) ?? '' }
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  }

  /** A project as `sf new` generated it with `settings`, and the baselines it recorded. */
  const generateProject = async (manifest: SaaSFoundryManifest, settings: RenderSettings) => render(manifest, settings, project)

  const saveManifest = (manifest: SaaSFoundryManifest) => writeFile(join(project, '.saasfoundry.json'), JSON.stringify(manifest, null, 2))
  const readManifest = async (): Promise<SaaSFoundryManifest> => JSON.parse(await readFile(join(project, '.saasfoundry.json'), 'utf8'))
  const readProject = (path: string) => readFile(join(project, path), 'utf8')
  const exists = (path: string) =>
    readFile(join(project, path)).then(
      () => true,
      () => false
    )

  /** The plan `sf update --dry-run --json` reports. */
  const dryRunPlan = async () => {
    const chunks: string[] = []
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      chunks.push(String(chunk))
      return true
    }) as typeof process.stdout.write)
    try {
      await updateCommand({ nonInteractive: true, dryRun: true, json: true })
    } finally {
      spy.mockRestore()
    }
    return JSON.parse(chunks.join('')).templateUpdate as { status: string; update?: string[]; conflict?: string[]; add?: string[] }
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-render-settings-'))
    project = join(root, 'diamondforge')
    await mkdir(project, { recursive: true })
    originalCwd = process.cwd()
    spies = [
      jest.spyOn(shelljs, 'exec').mockImplementation((() => ({ code: 0, stdout: '', stderr: '' })) as never),
      jest.spyOn(console, 'log').mockImplementation(() => {}),
      jest.spyOn(console, 'warn').mockImplementation(() => {}),
      jest.spyOn(console, 'error').mockImplementation(() => {}),
      jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code})`)
      }) as never)
    ]
  })

  afterEach(async () => {
    for (const spy of spies) spy.mockRestore()
    process.chdir(originalCwd)
    await rm(root, { recursive: true, force: true })
  })

  it('renders the deployment workflow with the sender sf new chose', async () => {
    const { read } = await render(manifestFor(), projectSettings())
    const content = await read(workflow)
    for (const line of senderLines) expect(content).toContain(line)
  }, 120_000)

  it('plans no change for an untouched workflow whose template did not change', async () => {
    const manifest = manifestFor()
    const { hashes } = await generateProject(manifest, projectSettings())
    await saveManifest({ ...manifest, fileHashes: hashes })
    process.chdir(project)

    expect(await dryRunPlan()).toEqual({ status: 'no-changes' })

    const generated = await readProject(workflow)
    await updateCommand({ nonInteractive: true })
    expect(await readProject(workflow)).toBe(generated)
    expect((await readManifest()).fileHashes?.[workflow]).toBe(hashes[workflow])
  }, 240_000)

  it('raises no conflict on an edited workflow, and keeps its baseline', async () => {
    const manifest = manifestFor()
    const { hashes } = await generateProject(manifest, projectSettings())
    const edited = `${await readProject(workflow)}\n# the team's own deployment step\n`
    await writeFile(join(project, workflow), edited)
    await saveManifest({ ...manifest, fileHashes: hashes })
    process.chdir(project)

    await updateCommand({ nonInteractive: true })

    expect(await readProject(workflow)).toBe(edited)
    expect(await exists(`${workflow}.saasfoundry.new`)).toBe(false)
    expect((await readManifest()).fileHashes?.[workflow]).toBe(hashes[workflow])
  }, 180_000)

  // The manifest stays older than the CLI under test, so the refresh runs: what matters is the
  // baseline the faulty update recorded, not the version it wrote.
  describe('a project an earlier sf update already gave the placeholder baseline', () => {
    it('raises no conflict on an edited workflow, and records the real render as its baseline', async () => {
      const manifest = manifestFor()
      const { hashes } = await generateProject(manifest, projectSettings())
      const placeholder = await render(manifest, legacyRenderSettings(manifest))
      const edited = `${await readProject(workflow)}\n# the team's own deployment step\n`
      await writeFile(join(project, workflow), edited)
      await saveManifest({ ...manifest, fileHashes: { ...hashes, [workflow]: placeholder.hashes[workflow] } })
      process.chdir(project)

      expect(await dryRunPlan()).toEqual({ status: 'no-changes' })
      await updateCommand({ nonInteractive: true })

      expect(await readProject(workflow)).toBe(edited)
      expect(await exists(`${workflow}.saasfoundry.new`)).toBe(false)
      expect((await readManifest()).fileHashes?.[workflow]).toBe(hashes[workflow])
    }, 300_000)

    it('gives an untouched workflow its sender back', async () => {
      const manifest = manifestFor()
      const { hashes, read } = await generateProject(manifest, projectSettings())
      const placeholder = await render(manifest, legacyRenderSettings(manifest))
      const overwritten = await placeholder.read(workflow)
      for (const line of placeholderLines) expect(overwritten).toContain(line)
      await writeFile(join(project, workflow), overwritten)
      await saveManifest({ ...manifest, fileHashes: { ...hashes, [workflow]: hashFileContent(overwritten) } })
      process.chdir(project)

      expect(await dryRunPlan()).toEqual({ status: 'would-apply', update: [workflow], add: [], conflict: [], remove: [] })
      await updateCommand({ nonInteractive: true })

      expect(await readProject(workflow)).toBe(await read(workflow))
      expect((await readManifest()).fileHashes?.[workflow]).toBe(hashes[workflow])
    }, 300_000)
  })

  it('keeps custom Docker database credentials and bucket in the dev-services compose file', async () => {
    const manifest = manifestFor({ email: { provider: 'none', version: 1 }, dbSetup: 'docker', s3Setup: 'docker' })
    const settings = projectSettings({ mailersendSenderEmail: undefined, mailersendSenderName: undefined, dbUser: 'forge', dbPassword: 'anvil-2026', dbName: 'forge_dev', s3Bucket: 'forge-assets' })
    const { hashes } = await generateProject(manifest, settings)
    const generated = await readProject(devServices)
    expect(generated).toContain('POSTGRES_USER: forge')
    expect(generated).toContain('myminio/forge-assets')
    await saveManifest({ ...manifest, fileHashes: hashes })
    process.chdir(project)

    expect(await dryRunPlan()).toEqual({ status: 'no-changes' })
    await updateCommand({ nonInteractive: true })

    expect(await readProject(devServices)).toBe(generated)
  }, 240_000)
})
