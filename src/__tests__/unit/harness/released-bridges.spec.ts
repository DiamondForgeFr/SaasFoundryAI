import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  ADOPTION_COMMON_INSTRUCTIONS,
  CODEX_SOURCE_CLAUDE_BRIDGE,
  COMMON_INSTRUCTIONS,
  inspectInstructionSource,
  installAgentInstructions,
  isGeneratedBridge,
  isReferenceOnlyAdoption,
  planAgentInstructions,
  recordsReferenceOnlyBridge,
  resolveInstructionFile
} from '../../../harness/agent-instructions'
import { planClaudeMdMigration } from '../../../harness/claude-md-migration'
import { RELEASED_BRIDGE_HASHES } from '../../../harness/released-bridge-hashes'
import { BridgeKind, isReleasedBridge, releasedBridgeVersions } from '../../../harness/released-bridges'
import { TIER_AGENT_PATH } from '../../../harness/tier-agents'
import type { SaaSFoundryManifest } from '../../../types'

const FIXTURES = join(__dirname, '../../fixtures/released-bridges')
const RELEASES = ['1.0.0', '1.0.1']
const FILES: Record<BridgeKind, string> = { common: 'AGENTS.common.md', adoption: 'AGENTS.adoption.md', claudeBridge: 'CLAUDE.bridge.md' }
const CURRENT: Record<BridgeKind, string> = { common: COMMON_INSTRUCTIONS, adoption: ADOPTION_COMMON_INSTRUCTIONS, claudeBridge: CODEX_SOURCE_CLAUDE_BRIDGE }

const released = (version: string, kind: BridgeKind): Promise<Buffer> => readFile(join(FIXTURES, version, FILES[kind]))
const sha = (content: Buffer | string): string => createHash('sha256').update(content).digest('hex')
const KINDS = Object.keys(FILES) as BridgeKind[]

/** The pre-#937 CLAUDE.md of a harness project, as 1.0.1 left it. */
const preCleaned = (): Promise<string> => readFile(join(__dirname, '../../fixtures/pre-937-claude-md/harness.CLAUDE.md'), 'utf8')

describe('generated bridges of the published releases (#935)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sf-released-bridges-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const put = (path: string, content: string | Buffer): Promise<void> => writeFile(join(dir, path), content)
  const manifest = (fileHashes: Record<string, string> = {}): SaaSFoundryManifest => ({
    version: '1.0.1',
    generatedAt: '2026-10-12T00:00:00Z',
    structure: 'cli',
    projectName: 'acme',
    modules: { harness: { version: 3, managed: true } },
    fileHashes
  })

  describe('the fixtures', () => {
    it('hold the published bytes: their sha256 is the table the CLI ships', async () => {
      for (const version of RELEASES) {
        for (const kind of KINDS) expect({ version, kind, hash: sha(await released(version, kind)) }).toEqual({ version, kind, hash: RELEASED_BRIDGE_HASHES[kind][version] })
      }
    })

    it('are listed in the generated table, one entry per file and no entry without a file', async () => {
      const versions = (await readdir(FIXTURES, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
      expect(versions.sort()).toEqual(RELEASES)
      for (const kind of KINDS) {
        const withFile = versions.filter((version) => existsSync(join(FIXTURES, version, FILES[kind]))).sort()
        expect(Object.keys(RELEASED_BRIDGE_HASHES[kind]).sort()).toEqual(withFile)
      }
    })

    it('differ from what this CLI renders: byte equality with the current text recognises none of the 1.0.1 common and adoption bridges', async () => {
      // The defect this ticket fixes: #1022 and #1026 changed the generated text after the release.
      for (const kind of ['common', 'adoption'] as const) expect((await released('1.0.1', kind)).equals(Buffer.from(CURRENT[kind]))).toBe(false)
      for (const kind of KINDS) expect((await released('1.0.0', kind)).equals(Buffer.from(CURRENT[kind]))).toBe(false)
    })
  })

  describe('recognition', () => {
    it.each(RELEASES.flatMap((version) => KINDS.map((kind) => [version, kind] as const)))('%s: the %s bridge is a generated bridge', async (version, kind) => {
      const bytes = await released(version, kind)
      expect(isGeneratedBridge(kind, bytes)).toBe(true)
      expect(isGeneratedBridge(kind, bytes.toString('utf8'))).toBe(true)
      expect(releasedBridgeVersions(kind, bytes)).toContain(version)
    })

    it('still recognises the bridge this CLI renders', () => {
      for (const kind of KINDS) expect(isGeneratedBridge(kind, CURRENT[kind])).toBe(true)
    })

    it('treats a bridge the user edited by one byte as the user’s own file', async () => {
      for (const kind of KINDS) {
        const edited = `${(await released('1.0.1', kind)).toString('utf8')}\nAlso run make check.\n`
        expect(isGeneratedBridge(kind, edited)).toBe(false)
        expect(isReleasedBridge(kind, edited)).toBe(false)
      }
    })

    it('does not take a bridge for another kind', async () => {
      expect(isGeneratedBridge('claudeBridge', await released('1.0.1', 'common'))).toBe(false)
      expect(isGeneratedBridge('common', await released('1.0.1', 'adoption'))).toBe(false)
    })

    it('reads a recorded baseline of a published adoption or Claude bridge as reference-only', async () => {
      expect(recordsReferenceOnlyBridge({ 'AGENTS.md': sha(await released('1.0.1', 'adoption')) })).toBe(true)
      expect(recordsReferenceOnlyBridge({ 'AGENTS.md': sha(await released('1.0.0', 'adoption')) })).toBe(true)
      expect(recordsReferenceOnlyBridge({ 'CLAUDE.md': sha(await released('1.0.1', 'claudeBridge')) })).toBe(true)
      // The common bridge points at a CLAUDE.md the project owns: that is not a reference-only adoption.
      expect(recordsReferenceOnlyBridge({ 'AGENTS.md': sha(await released('1.0.1', 'common')) })).toBe(false)
      expect(recordsReferenceOnlyBridge({ 'AGENTS.md': sha('# My agents\n') })).toBe(false)
      expect(recordsReferenceOnlyBridge(undefined)).toBe(false)
    })
  })

  describe('instruction sources', () => {
    it('classes a 1.0.1 AGENTS.md bridge over a CLAUDE.md as a Claude source, never mixed', async () => {
      await put('CLAUDE.md', await preCleaned())
      await put('AGENTS.md', await released('1.0.1', 'common'))
      expect(await inspectInstructionSource(dir)).toMatchObject({ source: 'claude', claudeInstructions: true, sharedInstructions: true })
    })

    it('classes a 1.0.1 CLAUDE.md bridge over an AGENTS.md as a Codex source, never mixed', async () => {
      await put('CLAUDE.md', await released('1.0.1', 'claudeBridge'))
      await put('AGENTS.md', '# My agents\n\nUse pnpm.\n')
      expect(await inspectInstructionSource(dir)).toMatchObject({ source: 'codex' })
    })

    it('classes a 1.0.1 adoption bridge as a Claude source too', async () => {
      await put('CLAUDE.md', '# Mine\n')
      await put('AGENTS.md', await released('1.0.1', 'adoption'))
      expect(await inspectInstructionSource(dir)).toMatchObject({ source: 'claude' })
      expect(await isReferenceOnlyAdoption(dir)).toBe(true)
    })

    it('does not class a user-written AGENTS.md as an adoption', async () => {
      await put('CLAUDE.md', '# Mine\n')
      await put('AGENTS.md', '# My agents\n')
      expect(await isReferenceOnlyAdoption(dir)).toBe(false)
    })

    it('skips a published bridge when it looks for the file that holds the instructions', async () => {
      await put('CLAUDE.md', await preCleaned())
      await put('AGENTS.md', await released('1.0.1', 'common'))
      expect(await resolveInstructionFile(dir)).toBe('CLAUDE.md')

      await rm(join(dir, 'CLAUDE.md'))
      await put('CLAUDE.md', await released('1.0.1', 'claudeBridge'))
      await put('AGENTS.md', '# My agents\n')
      expect(await resolveInstructionFile(dir)).toBe('AGENTS.md')
    })
  })

  describe('harness v3 → v4 over a published bridge', () => {
    it('moves a 1.0.1 CLAUDE.md into AGENTS.md when the AGENTS.md beside it is the 1.0.1 bridge (no sidecar)', async () => {
      await put('CLAUDE.md', await preCleaned())
      await put('AGENTS.md', await released('1.0.1', 'common'))

      const plan = await planClaudeMdMigration(dir, manifest({ 'AGENTS.md': sha(await released('1.0.1', 'common')) }))

      expect(plan.dirs).toHaveLength(1)
      expect(plan.dirs[0].outcome).toBe('migrate')
    })

    it('recognises the bridge by its bytes even when the manifest recorded no baseline for it', async () => {
      await put('CLAUDE.md', await preCleaned())
      await put('AGENTS.md', await released('1.0.0', 'common'))

      expect((await planClaudeMdMigration(dir, manifest())).dirs[0].outcome).toBe('migrate')
    })

    it('removes a 1.0.1 CLAUDE.md bridge over an AGENTS.md project: it hides AGENTS.md from Claude Code, it is not the user’s file', async () => {
      await put('CLAUDE.md', await released('1.0.1', 'claudeBridge'))
      await put('AGENTS.md', '# My agents\n\nUse pnpm.\n')

      const plan = await planClaudeMdMigration(dir, manifest())

      expect(plan.dirs).toEqual([expect.objectContaining({ dir: '', outcome: 'remove-bridge' })])
    })

    it('still sidecars the AGENTS.md of a project whose CLAUDE.md the user wrote', async () => {
      await put('CLAUDE.md', '# acme\n\n## Deployment\n\nShip with make.\n')
      await put('AGENTS.md', '# My agents\n\nUse pnpm.\n')

      expect((await planClaudeMdMigration(dir, manifest())).dirs[0].outcome).toBe('sidecar')
    })
  })

  describe('refresh over a published adoption', () => {
    it('reads a 1.0.1 adoption bridge as reference-only: no tier agents, and the bridge is refreshed in place', async () => {
      await put('CLAUDE.md', '# Mine\n')
      await put('AGENTS.md', await released('1.0.1', 'adoption'))
      const baselines = { 'AGENTS.md': sha(await released('1.0.1', 'adoption')) }

      const plan = await planAgentInstructions({ targetPath: dir, agents: ['claude-code'], manifest: manifest(baselines) })

      expect(plan.files.map((file) => file.path).filter((path) => TIER_AGENT_PATH.test(path))).toEqual([])
      const report = await installAgentInstructions({ targetPath: dir, agents: ['claude-code'], manifest: manifest(baselines) })
      expect(report.conflicts).toEqual([])
      expect(await readFile(join(dir, 'AGENTS.md'), 'utf8')).toBe(ADOPTION_COMMON_INSTRUCTIONS)
    })

    it('does not class the 1.0.1 adoption bridge as a conflict with a mixed source', async () => {
      await put('CLAUDE.md', '# Mine\n')
      await put('AGENTS.md', await released('1.0.1', 'adoption'))

      const plan = await planAgentInstructions({ targetPath: dir, agents: ['claude-code'], manifest: manifest() })

      expect(plan.warnings.join('\n')).not.toContain('both contain custom instructions')
    })
  })
})
