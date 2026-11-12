import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

import { collectStatus, describeProjectCapabilities } from '../../../status/collect'
import type { SaaSFoundryManifest } from '../../../types'

/** The manifest of a stackless `cli` project once manifest migration 002 has run: the shape this repository has. */
const cliHarness: SaaSFoundryManifest = {
  version: '1.1.0',
  generatedAt: '2026-11-05T00:00:00Z',
  structure: 'cli',
  projectName: 'saasfoundryai-cli',
  workflow: { tool: 'github-projects' },
  modules: { email: { provider: 'none', version: 1 }, harness: { version: 5, managed: true } }
}

describe('the SaaSFoundryAI CLI source repository in sf status (#1103)', () => {
  describe('describeProjectCapabilities', () => {
    it('keeps offering the full profile to a harness project that is not the CLI repository', () => {
      const capabilities = describeProjectCapabilities(cliHarness)
      expect(capabilities.effectiveProfile).toBe('harness')
      expect(capabilities.previewCommand).toBe('sf update --target-profile full --dry-run --json')
    })

    it('names the CLI repository and offers no full-profile preview', () => {
      const capabilities = describeProjectCapabilities(cliHarness, { cliSourceRepository: true })
      expect(capabilities).toMatchObject({ effectiveProfile: 'harness', technicalStack: 'absent', collaborationHarness: 'managed', previewCommand: null })
      expect(capabilities.reason).toContain('SaaSFoundryAI CLI source repository')
    })

    it('does not hide a real inconsistency behind the repository reason', () => {
      const contradictory: SaaSFoundryManifest = { ...cliHarness, modules: { ...cliHarness.modules, dbSetup: 'docker' } }
      const capabilities = describeProjectCapabilities(contradictory, { cliSourceRepository: true })
      expect(capabilities.effectiveProfile).toBe('inconsistent')
      expect(capabilities.reason).toContain('contradictory')
    })
  })

  describe('collectStatus', () => {
    let root: string

    beforeEach(async () => {
      root = await realpath(await mkdtemp(join(tmpdir(), 'sf-status-cli-repo-')))
      await writeFile(join(root, '.saasfoundry.json'), JSON.stringify(cliHarness, null, 2) + '\n')
    })
    afterEach(async () => rm(root, { recursive: true, force: true }))

    it('reports a harness profile with no preview on a CLI source layout', async () => {
      await mkdir(join(root, 'bin'))
      await writeFile(join(root, 'bin', 'sf.js'), '\n')
      await mkdir(join(root, 'src'))
      await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'saasfoundryai-cli' }))

      const { capabilities } = await collectStatus(root, { checkNetwork: false })

      expect(capabilities).toMatchObject({ effectiveProfile: 'harness', previewCommand: null })
      expect(capabilities?.reason).toContain('CLI source repository')
    })

    it('reports a harness profile with the full-profile preview anywhere else', async () => {
      const { capabilities } = await collectStatus(root, { checkNetwork: false })

      expect(capabilities).toMatchObject({ effectiveProfile: 'harness', previewCommand: 'sf update --target-profile full --dry-run --json' })
      expect(capabilities?.reason).not.toContain('CLI source repository')
    })

    describe('the CLI block', () => {
      const layOut = async () => {
        await mkdir(join(root, 'bin'))
        await writeFile(join(root, 'bin', 'sf.js'), '\n')
        await mkdir(join(root, 'src', 'deep'), { recursive: true })
        await mkdir(join(root, 'src', '__tests__'), { recursive: true })
        await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'saasfoundryai-cli' }))
      }
      const touch = async (file: string, mtime: Date) => {
        await mkdir(dirname(join(root, file)), { recursive: true })
        await writeFile(join(root, file), '\n')
        await utimes(join(root, file), mtime, mtime)
      }
      const at = (iso: string) => new Date(iso)

      it('is absent when the caller does not say which CLI runs, so a legacy caller sees no CLI preconditions', async () => {
        await layOut()
        expect((await collectStatus(root, { checkNetwork: false })).cli).toBeUndefined()
      })

      it('carries the running version, channel and harness version, and looks at no build outside the CLI repository', async () => {
        const report = await collectStatus(root, { checkNetwork: false, cliVersion: '1.1.0', harnessCurrentVersion: 5, cliChannel: { channel: 'checkout', path: '/src/sf', commit: 'abc1234' } })
        expect(report.cli).toEqual({ version: '1.1.0', channel: { channel: 'checkout', path: '/src/sf', commit: 'abc1234' }, harnessCurrentVersion: 5, sourceRepository: false })
      })

      it('defaults to a published package', async () => {
        expect((await collectStatus(root, { checkNetwork: false, cliVersion: '1.1.0' })).cli).toMatchObject({ channel: { channel: 'package' } })
      })

      it('reads the build against the newest source, tests and dependencies left out', async () => {
        await layOut()
        await touch('dist/index.js', at('2026-11-05T10:00:00Z'))
        await touch('src/index.ts', at('2026-11-05T09:00:00Z'))
        await touch('src/deep/newest.ts', at('2026-11-05T09:30:00Z'))
        await touch('src/__tests__/newer.spec.ts', at('2026-11-05T11:00:00Z'))
        await touch('src/node_modules/newer.js', at('2026-11-05T11:00:00Z'))

        const { cli } = await collectStatus(root, { checkNetwork: false, cliVersion: '1.1.0' })

        expect(cli?.sourceRepository).toBe(true)
        expect(cli?.build).toEqual({ distMtimeMs: at('2026-11-05T10:00:00Z').getTime(), newestSourceMtimeMs: at('2026-11-05T09:30:00Z').getTime(), newestSource: join('src', 'deep', 'newest.ts') })
      })

      it('reports a missing build as no dist time', async () => {
        await layOut()
        await touch('src/index.ts', at('2026-11-05T09:00:00Z'))

        const { cli } = await collectStatus(root, { checkNetwork: false, cliVersion: '1.1.0' })

        expect(cli?.build).toEqual({ newestSourceMtimeMs: at('2026-11-05T09:00:00Z').getTime(), newestSource: join('src', 'index.ts') })
      })
    })
  })
})
