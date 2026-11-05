import { mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

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
  })
})
