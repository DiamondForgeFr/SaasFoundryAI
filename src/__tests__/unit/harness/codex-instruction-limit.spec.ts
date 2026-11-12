import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

import { installAgentInstructions, planAgentInstructions, withGeneratedRegion, type HarnessAgent } from '../../../harness/agent-instructions'
import { previewCodexInstructionLimits } from '../../../harness/codex-instruction-limit-preview'
import { codexDocLimitFor, planCodexDocLimit, readCodexDocLimit, withCodexDocLimit } from '../../../harness/codex-instruction-size'
import { collectInstructionDiagnostics } from '../../../status/instruction-diagnostics'
import { evaluatePreconditions } from '../../../status/preconditions'
import type { StatusReport } from '../../../status/collect'
import type { SaaSFoundryManifest } from '../../../types'

/** #1154: a migrated monorepo's AGENTS.md chain is over Codex's 32 KiB default. */
describe('Codex instruction limit (#1154)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sf-codex-limit-'))
    await mkdir(join(dir, '.git'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const put = async (files: Record<string, string>): Promise<void> => {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, path)), { recursive: true })
      await writeFile(join(dir, path), content)
    }
  }
  const read = (path: string): Promise<string> => readFile(join(dir, path), 'utf8')
  const padded = (title: string, bytes: number): string => `# ${title}\n\n${'Project rule line.\n'.repeat(Math.ceil(bytes / 19))}`.slice(0, bytes)

  const manifest = (agents: HarnessAgent[]): SaaSFoundryManifest => ({
    version: '1.1.0',
    generatedAt: '2026-10-12T00:00:00Z',
    structure: 'monorepo',
    projectName: 'diamondforge',
    modules: { harness: { version: 5, managed: true, agents } },
    fileHashes: {}
  })

  /** The sizes DiamondForge reported once migrated: root ~23 KB, apps/api ~13 KB, apps/web ~14 KB. */
  const diamondForge = async (agents: HarnessAgent[] = ['claude-code', 'codex']): Promise<SaaSFoundryManifest> => {
    const root = withGeneratedRegion(padded('DiamondForge', 23041 - 9000))
    await put({ 'AGENTS.md': root, 'apps/api/AGENTS.md': padded('API', 12983), 'apps/web/AGENTS.md': padded('Web', 14020) })
    const value = manifest(agents)
    await put({ '.saasfoundry.json': JSON.stringify(value, null, 2) })
    return value
  }

  describe('the .codex/config.toml edit', () => {
    it('adds the key to the root table, before the first table, keeping every other line', () => {
      const toml = '# my settings\nmodel = "gpt-5"\n\n[features]\nweb_search = true\n'
      const result = withCodexDocLimit(toml, 49152)
      expect(result).toEqual({ content: expect.any(String) })
      const content = (result as { content: string }).content
      expect(content.startsWith('# my settings\nmodel = "gpt-5"\n\n')).toBe(true)
      expect(content.indexOf('project_doc_max_bytes = 49152')).toBeLessThan(content.indexOf('[features]'))
      expect(content.endsWith('[features]\nweb_search = true\n')).toBe(true)
      expect(readCodexDocLimit(content)).toBe(49152)
    })

    it('rewrites only the value of an existing key, and ignores one inside a table', () => {
      expect(withCodexDocLimit('project_doc_max_bytes = 40000 # mine\nmodel = "x"\n', 49152)).toEqual({ content: 'project_doc_max_bytes = 49152 # mine\nmodel = "x"\n' })
      expect(readCodexDocLimit('[profiles.fast]\nproject_doc_max_bytes = 99999\n')).toBeUndefined()
      expect(readCodexDocLimit('project_doc_max_bytes = 65_536\n')).toBe(65536)
    })

    it('leaves a value it cannot read as an integer alone', () => {
      expect(planCodexDocLimit([{ directory: '.', bytes: 40000, files: ['AGENTS.md'] }], 'project_doc_max_bytes = "big"\n')).toEqual({ error: expect.stringContaining('not a plain integer') })
    })

    it('covers the longest chain with a margin, and never lowers a larger value', () => {
      const sizes = [
        { directory: '.', bytes: 23041, files: ['AGENTS.md'] },
        { directory: 'apps/web', bytes: 37061, files: ['AGENTS.md', 'apps/web/AGENTS.md'] }
      ]
      expect(codexDocLimitFor(37061)).toBe(49152)
      expect(planCodexDocLimit(sizes, undefined)).toMatchObject({ to: 49152, largest: { directory: 'apps/web' } })
      expect(planCodexDocLimit(sizes, 'project_doc_max_bytes = 36000\n')).toMatchObject({ from: 36000, to: 49152 })
      // A value that already covers the chain is the project's choice, even below what the CLI would write.
      expect(planCodexDocLimit(sizes, 'project_doc_max_bytes = 40000\n')).toBeUndefined()
      expect(planCodexDocLimit(sizes, 'project_doc_max_bytes = 65536\n')).toBeUndefined()
      expect(planCodexDocLimit([sizes[0]], undefined)).toBeUndefined()
    })
  })

  describe('the instruction refresh (sf update, sf agents refresh, sf agents enable codex)', () => {
    it('writes project_doc_max_bytes for a declared Codex whose chain is over 32 KiB, keeping the user TOML', async () => {
      const value = await diamondForge()
      await put({ '.codex/config.toml': 'model = "gpt-5"\n\n[features]\nweb_search = true\n' })

      const plan = await planAgentInstructions({ targetPath: dir, agents: ['claude-code', 'codex'], manifest: value })
      expect(plan.warnings).toContainEqual(expect.stringContaining('.codex/config.toml: project_doc_max_bytes set to'))
      const report = await installAgentInstructions({ targetPath: dir, agents: ['claude-code', 'codex'], manifest: value })

      expect(report.written).toContain('.codex/config.toml')
      expect(report.fileHashes['.codex/config.toml']).toBeUndefined()
      const toml = await read('.codex/config.toml')
      expect(toml).toContain('model = "gpt-5"')
      expect(toml).toContain('[features]\nweb_search = true')
      const limit = readCodexDocLimit(toml)!
      const web = (await read('AGENTS.md')).length + (await read('apps/web/AGENTS.md')).length
      expect(web).toBeGreaterThan(32 * 1024)
      expect(limit).toBeGreaterThan(web)

      // The refresh is idempotent: once the limit covers the chain, the next run leaves the file alone.
      const again = await installAgentInstructions({ targetPath: dir, agents: ['claude-code', 'codex'], manifest: value })
      expect(again.written).not.toContain('.codex/config.toml')
      expect(await read('.codex/config.toml')).toBe(toml)
    })

    it('then lets sf status pass', async () => {
      const value = await diamondForge()
      await installAgentInstructions({ targetPath: dir, agents: ['claude-code', 'codex'], manifest: value })

      const instructions = await collectInstructionDiagnostics(dir, ['apps/api', 'apps/web'], dir)
      const report: StatusReport = {
        projectRoot: dir,
        manifest: value,
        manifestPath: join(dir, '.saasfoundry.json'),
        git: { available: false },
        tools: [],
        checkedNetwork: false,
        installedSkills: [],
        instructions
      }
      expect(evaluatePreconditions(report).find((check) => check.name === 'codexInstructionSize')).toMatchObject({ status: 'ok' })
    })

    it('never lowers a larger value the project set', async () => {
      const value = await diamondForge()
      const toml = 'project_doc_max_bytes = 131072\nmodel = "gpt-5"\n'
      await put({ '.codex/config.toml': toml })

      const plan = await planAgentInstructions({ targetPath: dir, agents: ['codex'], manifest: value })
      expect(plan.files.map((file) => file.path)).not.toContain('.codex/config.toml')
      await installAgentInstructions({ targetPath: dir, agents: ['codex'], manifest: value })
      expect(await read('.codex/config.toml')).toBe(toml)
    })

    it('writes nothing when Codex is not declared', async () => {
      const value = await diamondForge(['claude-code'])
      await installAgentInstructions({ targetPath: dir, agents: ['claude-code'], manifest: value })
      expect(existsSync(join(dir, '.codex/config.toml'))).toBe(false)
    })

    it('writes nothing when every chain fits', async () => {
      const value = manifest(['codex'])
      await put({ 'AGENTS.md': withGeneratedRegion('# Small\n'), 'apps/api/AGENTS.md': '# API\n', 'apps/web/AGENTS.md': '# Web\n' })
      const plan = await planAgentInstructions({ targetPath: dir, agents: ['codex'], manifest: value })
      expect(plan.files.map((file) => file.path)).not.toContain('.codex/config.toml')
    })
  })

  describe('sf update --dry-run', () => {
    it('announces the raise without writing it', async () => {
      const value = await diamondForge()
      const previews = await previewCodexInstructionLimits(dir, value, false)
      expect(previews).toEqual([expect.objectContaining({ path: '.codex/config.toml', directory: expect.stringMatching(/^apps\//), to: expect.any(Number) })])
      expect(previews[0].to).toBeGreaterThan(previews[0].bytes)
      expect(existsSync(join(dir, '.codex/config.toml'))).toBe(false)
    })

    it('measures the AGENTS.md the pending CLAUDE.md move would write', async () => {
      const value = manifest(['claude-code', 'codex'])
      value.modules!.harness!.version = 3
      await put({ 'CLAUDE.md': padded('DiamondForge', 23041), 'apps/api/CLAUDE.md': padded('API', 12983), 'apps/web/CLAUDE.md': padded('Web', 14020) })

      expect(await previewCodexInstructionLimits(dir, value, false)).toEqual([])
      const previews = await previewCodexInstructionLimits(dir, value, true)
      expect(previews).toEqual([expect.objectContaining({ path: '.codex/config.toml' })])
      expect(previews[0].bytes).toBeGreaterThan(32 * 1024)
      expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false)
    })

    it('announces nothing when Codex is not declared', async () => {
      const value = await diamondForge(['claude-code'])
      expect(await previewCodexInstructionLimits(dir, value, false)).toEqual([])
    })
  })
})
