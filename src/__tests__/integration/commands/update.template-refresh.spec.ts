import { copy } from 'fs-extra'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import shelljs from 'shelljs'

import { regenerateInTempDir, updateCommand } from '../../../commands/update'
import { targetManifestVersion } from '../../../migrations/manifest/registry'
import { manifestSchemaUrl, type SaaSFoundryManifest } from '../../../types'
import { hashFileContent } from '../../../utils'
import { version as cliVersion } from '../../../../package.json'

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
 * FLOW 1 end to end: a project exactly as this CLI generates it, recorded by an older
 * version, then `sf update --non-interactive` for real.
 */
describe('sf update template refresh', () => {
  let root: string
  let project: string
  let originalCwd: string
  let spies: jest.SpyInstance[]

  const manifestFor = (): SaaSFoundryManifest => ({
    $schema: manifestSchemaUrl,
    manifestVersion: targetManifestVersion(),
    version: '0.9.0',
    generatedAt: '2026-06-22T21:07:04.662Z',
    structure: 'monorepo',
    projectName: 'acme-pilot',
    mainBranch: 'master',
    modules: { email: { provider: 'none', version: 1 }, s3Setup: 'manual', dbSetup: 'manual', includeAnalytics: false, advancedSkills: [] }
  })

  /** Generate the project with this CLI into `project`, and return the hashes `sf new` would have recorded. */
  const generateProject = async (manifest: SaaSFoundryManifest): Promise<Record<string, string>> => {
    const empty = await mkdtemp(join(tmpdir(), 'sf-refresh-empty-'))
    try {
      const { tempDir, hashes } = await regenerateInTempDir(manifest, empty)
      await copy(join(tempDir, manifest.projectName), project)
      await rm(tempDir, { recursive: true, force: true })
      return hashes
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  }

  const readManifest = async (): Promise<SaaSFoundryManifest> => JSON.parse(await readFile(join(project, '.saasfoundry.json'), 'utf8'))
  const exists = (path: string) =>
    readFile(join(project, path)).then(
      () => true,
      () => false
    )

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-template-refresh-'))
    project = join(root, 'acme-pilot')
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

  describe('conflicts (#856)', () => {
    const template = 'apps/api/src/main.ts'

    /** A project whose `main.ts` the user edited, recorded by an older CLI that shipped a different `main.ts`. */
    const conflictedProject = async () => {
      const manifest = manifestFor()
      const recorded = await generateProject(manifest)
      const offered = await readFile(join(project, template), 'utf8')
      const userEdit = `${offered}\n// the team's own bootstrap tweak\n`
      await writeFile(join(project, template), userEdit)
      await writeFile(join(project, '.saasfoundry.json'), JSON.stringify({ ...manifest, fileHashes: { ...recorded, [template]: hashFileContent('// older template\n') } }, null, 2))
      process.chdir(project)
      return { offered, userEdit }
    }

    it('reaches the new version with a sidecar, and records the offered template as the baseline', async () => {
      const { offered, userEdit } = await conflictedProject()

      await updateCommand({ nonInteractive: true })

      expect(await readFile(join(project, template), 'utf8')).toBe(userEdit)
      expect(await readFile(join(project, `${template}.saasfoundry.new`), 'utf8')).toBe(offered)
      const saved = await readManifest()
      expect(saved.version).toBe(cliVersion)
      expect(saved.fileHashes?.[template]).toBe(hashFileContent(offered))
    }, 180_000)

    it('does not raise the same conflict again once the sidecar is merged', async () => {
      const { userEdit } = await conflictedProject()
      await updateCommand({ nonInteractive: true })
      // The developer merges by keeping their edit and deleting the sidecar.
      await rm(join(project, `${template}.saasfoundry.new`))
      // Next CLI release, same templates.
      const saved = await readManifest()
      await writeFile(join(project, '.saasfoundry.json'), JSON.stringify({ ...saved, version: '0.9.1' }, null, 2))

      await updateCommand({ nonInteractive: true })

      expect(await exists(`${template}.saasfoundry.new`)).toBe(false)
      expect(await readFile(join(project, template), 'utf8')).toBe(userEdit)
      expect((await readManifest()).version).toBe(cliVersion)
    }, 240_000)

    it('keeps the edit without a sidecar under --conflict-strategy keep, and still moves on', async () => {
      const { offered, userEdit } = await conflictedProject()

      await updateCommand({ nonInteractive: true, conflictStrategy: 'keep' })

      expect(await readFile(join(project, template), 'utf8')).toBe(userEdit)
      expect(await exists(`${template}.saasfoundry.new`)).toBe(false)
      const saved = await readManifest()
      expect(saved.version).toBe(cliVersion)
      expect(saved.fileHashes?.[template]).toBe(hashFileContent(offered))
    }, 180_000)
  })

  describe('obsolete template files (#865)', () => {
    it('keeps an unmodified file the new CLI no longer generates, and stops tracking it', async () => {
      const manifest = manifestFor()
      const recorded = await generateProject(manifest)
      // A template an older CLI shipped and this one no longer generates, untouched since.
      const obsolete = 'apps/api/src/common/legacy/obsolete.helper.ts'
      const content = 'export const legacy = true\n'
      await mkdir(join(project, 'apps/api/src/common/legacy'), { recursive: true })
      await writeFile(join(project, obsolete), content)
      await writeFile(join(project, '.saasfoundry.json'), JSON.stringify({ ...manifest, fileHashes: { ...recorded, [obsolete]: hashFileContent(content) } }, null, 2))
      process.chdir(project)

      await updateCommand({ nonInteractive: true })

      expect(await exists(obsolete)).toBe(true)
      const saved = await readManifest()
      expect(saved.fileHashes).not.toHaveProperty([obsolete])
      expect(saved.version).toBe(cliVersion)
    }, 180_000)

    it('reports the obsolete file in the dry-run plan without touching it', async () => {
      const manifest = manifestFor()
      const recorded = await generateProject(manifest)
      const obsolete = 'apps/web/src/legacy.ts'
      await writeFile(join(project, obsolete), 'export {}\n')
      await writeFile(join(project, '.saasfoundry.json'), JSON.stringify({ ...manifest, fileHashes: { ...recorded, [obsolete]: hashFileContent('export {}\n') } }, null, 2))
      process.chdir(project)
      const chunks: string[] = []
      spies.push(
        jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
          chunks.push(String(chunk))
          return true
        }) as typeof process.stdout.write)
      )

      await updateCommand({ nonInteractive: true, dryRun: true, json: true })

      expect(JSON.parse(chunks.join('')).templateUpdate).toMatchObject({ status: 'would-apply', remove: [obsolete] })
      expect(await exists(obsolete)).toBe(true)
    }, 180_000)
  })
})
