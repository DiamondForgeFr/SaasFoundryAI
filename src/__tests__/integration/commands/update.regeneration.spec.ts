import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import shelljs from 'shelljs'

import { computeFileUpdates, regenerateInTempDir } from '../../../commands/update'
import { targetManifestVersion } from '../../../migrations/manifest/registry'
import { installSrsSkill } from '../../../installers/srs-skill.installer'
import { manifestSchemaUrl, type SaaSFoundryManifest } from '../../../types'
import { computeFileHashes } from '../../../utils'
import { version as cliVersion } from '../../../../package.json'

/**
 * The target side of the FLOW 1 three-way merge, regenerated for real.
 *
 * Every file this regeneration gets wrong becomes a wrong `sf update` plan on a user's
 * project: a conflict nobody caused, or an untouched file silently overwritten.
 */
describe('regenerateInTempDir', () => {
  let liveRoot: string
  let tempDirs: string[]
  let shellSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance
  let logSpy: jest.SpyInstance

  const monorepoManifest = (overrides: Partial<SaaSFoundryManifest> = {}): SaaSFoundryManifest => ({
    $schema: manifestSchemaUrl,
    manifestVersion: targetManifestVersion(),
    version: '1.0.0-beta',
    generatedAt: '2026-06-22T21:07:04.662Z',
    structure: 'monorepo',
    projectName: 'acme-pilot',
    mainBranch: 'master',
    modules: { email: { provider: 'none', version: 1 }, s3Setup: 'manual', dbSetup: 'manual', includeAnalytics: false, advancedSkills: [] },
    ...overrides
  })

  const regenerate = async (manifest: SaaSFoundryManifest) => {
    const result = await regenerateInTempDir(manifest, liveRoot)
    tempDirs.push(result.tempDir)
    return { ...result, projectDir: join(result.tempDir, manifest.projectName) }
  }

  const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8'))

  beforeEach(async () => {
    liveRoot = await mkdtemp(join(tmpdir(), 'sf-regeneration-live-'))
    tempDirs = []
    shellSpy = jest.spyOn(shelljs, 'exec').mockImplementation((() => ({ code: 0, stdout: '', stderr: '' })) as never)
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(async () => {
    shellSpy.mockRestore()
    warnSpy.mockRestore()
    logSpy.mockRestore()
    await Promise.all([liveRoot, ...tempDirs].map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('runs with the CLI version under test', () => {
    expect(cliVersion).toMatch(/^\d+\.\d+\.\d+/)
  })

  describe('.gitignore templates (#875)', () => {
    const exists = (path: string) =>
      readFile(path).then(
        () => true,
        () => false
      )

    it.each([
      ['monorepo', ['.']],
      ['multirepo', ['apps/acme-pilot-api', 'apps/acme-pilot-web']]
    ] as const)(
      'deposits a real .gitignore in every %s package root, and no stray packaged copy',
      async (structure, roots) => {
        const { projectDir } = await regenerate(monorepoManifest({ structure }))

        for (const root of roots) {
          expect({ root, gitignore: await exists(join(projectDir, root, '.gitignore')), packaged: await exists(join(projectDir, root, 'gitignore')) }).toEqual({
            root,
            gitignore: true,
            packaged: false
          })
          expect(await readFile(join(projectDir, root, '.gitignore'), 'utf8')).toMatch(/^\.env$/m)
        }
      },
      120_000
    )
  })

  describe('SRS deposit (#857)', () => {
    const srsTools = { srs: { enabled: true, backend: 'notion' as const, rootPage: { id: 'root', url: 'https://www.notion.so/root', name: 'acme-pilot-srs' } } }
    const settingsHooks = async (projectDir: string) => JSON.stringify((await readJson(join(projectDir, '.claude/settings.json'))).hooks ?? {})

    it('regenerates the sf-srs skill and its prompt hook when the project has SRS', async () => {
      const { projectDir, hashes } = await regenerate(monorepoManifest({ tools: srsTools }))

      for (const script of ['srs-cli.sh', 'srs-intent-hook.sh', 'detect-eval-signals.sh']) expect(hashes).toHaveProperty([`.claude/skills/sf-srs/scripts/${script}`])
      expect(await settingsHooks(projectDir)).toContain('.claude/skills/sf-srs/scripts/srs-intent-hook.sh')
    }, 120_000)

    it('plans no removal of the sf-srs deposit `sf new` laid down', async () => {
      // Base and current: what `sf new` recorded — the stack plus the SRS bootstrap's skill.
      const srsDir = await mkdtemp(join(tmpdir(), 'sf-regeneration-srs-'))
      tempDirs.push(srsDir)
      await installSrsSkill({ targetPath: srsDir, onExisting: () => {} })
      const deposited = { ...(await regenerate(monorepoManifest())).hashes, ...(await computeFileHashes(srsDir)) }
      expect(Object.keys(deposited).filter((path) => path.startsWith('.claude/skills/sf-srs/scripts/')).length).toBeGreaterThan(0)

      const target = (await regenerate(monorepoManifest({ tools: srsTools }))).hashes
      const removals = computeFileUpdates(deposited, deposited, target).filter((update) => update.action === 'remove' && update.path.startsWith('.claude/skills/sf-srs/'))

      expect(removals).toEqual([])
    }, 120_000)

    it('regenerates neither the skill nor the hook without SRS', async () => {
      const { projectDir, hashes } = await regenerate(monorepoManifest())

      expect(Object.keys(hashes).filter((path) => path.includes('sf-srs'))).toEqual([])
      expect(await settingsHooks(projectDir)).not.toContain('srs-intent-hook')
    }, 120_000)
  })

  describe('package identity (#858)', () => {
    it("keeps the project's description and repository in every regenerated package", async () => {
      const identity = { description: 'Workplace health and safety compliance for construction SMEs.', repository: { type: 'git', url: 'git@github.com:acme/acme-pilot.git' } }
      for (const dir of ['.', 'apps/api', 'apps/web']) {
        await mkdir(join(liveRoot, dir), { recursive: true })
        await writeFile(join(liveRoot, dir, 'package.json'), JSON.stringify({ name: 'x', ...identity }, null, 2))
      }

      const { projectDir } = await regenerate(monorepoManifest())

      for (const dir of ['.', 'apps/api', 'apps/web']) {
        const packageJson = await readJson(join(projectDir, dir, 'package.json'))
        expect({ dir, description: packageJson.description, repository: packageJson.repository, homepage: packageJson.homepage, bugs: packageJson.bugs }).toEqual({
          dir,
          description: identity.description,
          repository: identity.repository,
          homepage: 'https://github.com/acme/acme-pilot#readme',
          bugs: { url: 'https://github.com/acme/acme-pilot/issues' }
        })
      }
    }, 120_000)

    it('keeps each multirepo app on its own repository', async () => {
      const manifest = monorepoManifest({ structure: 'multirepo' })
      const repositories = { api: 'https://github.com/acme/acme-pilot-api.git', web: 'https://github.com/acme/acme-pilot-web.git' }
      for (const app of ['api', 'web'] as const) {
        const dir = join(liveRoot, `apps/acme-pilot-${app}`)
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, 'package.json'), JSON.stringify({ description: 'Acme pilot', repository: { type: 'git', url: repositories[app] } }))
      }

      const { projectDir } = await regenerate(manifest)

      for (const app of ['api', 'web'] as const) {
        const packageJson = await readJson(join(projectDir, `apps/acme-pilot-${app}`, 'package.json'))
        expect({ app, description: packageJson.description, url: packageJson.repository?.url }).toEqual({ app, description: 'Acme pilot', url: repositories[app] })
      }
    }, 120_000)

    it("never points a package at the template author's repository or identity", async () => {
      const { projectDir } = await regenerate(monorepoManifest())

      for (const dir of ['.', 'apps/api', 'apps/web']) {
        const packageJson = await readFile(join(projectDir, dir, 'package.json'), 'utf8')
        expect({ dir, mentionsPlaceholder: packageJson.includes('agachet') }).toEqual({ dir, mentionsPlaceholder: false })
      }
    }, 120_000)
  })
})
