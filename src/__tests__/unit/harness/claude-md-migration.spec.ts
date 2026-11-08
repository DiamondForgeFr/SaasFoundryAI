import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

import { CLAUDE_CODE_RULE_PATH, CODEX_SOURCE_CLAUDE_BRIDGE, COMMON_INSTRUCTIONS, GENERATED_REGION_END, GENERATED_REGION_START } from '../../../harness/agent-instructions'
import { KEPT_FOR_REVIEW_HEADING, planClaudeMdMigration } from '../../../harness/claude-md-migration'
import { splitSections } from '../../../harness/markdown-sections'
import { harnessInstallerMeta } from '../../../installers/harness.installer'
import { harnessMigrations, moveClaudeMdToAgentsMd } from '../../../installers/harness.migrations'
import type { HarnessAgent, SaaSFoundryManifest } from '../../../types'
import { hashFileContent } from '../../../utils'

const FIXTURES = join(__dirname, '../../fixtures/pre-937-claude-md')
const fixture = (kind: 'harness' | 'api' | 'web' | 'monorepo'): Promise<string> => readFile(join(FIXTURES, `${kind}.CLAUDE.md`), 'utf8')

const USER_SECTION = '## Deployment\n\nDeploy with `make ship` from a clean tree.\n\n### Rollback\n\n```sh\n## not a heading\nmake rollback\n```\n'
const WORKFLOW_SECTION = '## Workflow System\n\nThis project uses **github-projects** for task tracking.\n\n**IMPORTANT**: Read the status file before any transition.\n'

/** A pre-#937 CLAUDE.md as an installed project holds it: the template, the workflow section, the user's own sections. */
const installed = async (kind: 'harness' | 'api' | 'web' | 'monorepo'): Promise<string> => `${(await fixture(kind)).trimEnd()}\n\n${WORKFLOW_SECTION}\n${USER_SECTION}`

const headingCount = (content: string, heading: string): number => content.split('\n').filter((line) => line === `## ${heading}`).length

describe('harness migration v3 → v4: move-claude-md-to-agents-md (#938)', () => {
  let dir: string
  let logSpy: jest.SpyInstance

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sf-claude-md-migration-'))
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(async () => {
    logSpy.mockRestore()
    await rm(dir, { recursive: true, force: true })
  })

  const put = async (files: Record<string, string>): Promise<void> => {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, path)), { recursive: true })
      await writeFile(join(dir, path), content)
    }
  }
  const read = (path: string): Promise<string> => readFile(join(dir, path), 'utf8')
  const output = (): string => logSpy.mock.calls.flat().join('\n')

  const manifest = (overrides: Partial<SaaSFoundryManifest> = {}, agents: HarnessAgent[] = ['claude-code', 'codex']): SaaSFoundryManifest => ({
    version: '1.0.0',
    generatedAt: '2026-10-12T00:00:00Z',
    structure: 'cli',
    projectName: 'acme',
    modules: { harness: { version: 3, managed: true, agents } },
    fileHashes: { 'AGENTS.md': hashFileContent(COMMON_INSTRUCTIONS) },
    ...overrides
  })

  it('is the 3 → 4 step of the harness chain, which #935 extends to 5', () => {
    expect(harnessMigrations[2]).toBe(moveClaudeMdToAgentsMd)
    expect(moveClaudeMdToAgentsMd).toMatchObject({ from: 3, to: 4 })
    expect(harnessInstallerMeta.currentVersion).toBe(5)
  })

  it('moves a harness CLAUDE.md into AGENTS.md, removes CLAUDE.md and adds the generated region and the Claude rule', async () => {
    const claude = await installed('harness')
    await put({ 'CLAUDE.md': claude, 'AGENTS.md': COMMON_INSTRUCTIONS })
    const m = manifest()

    await moveClaudeMdToAgentsMd.up(dir, m)

    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false)
    const agents = await read('AGENTS.md')
    expect(agents.startsWith('# acme')).toBe(true)
    expect(agents).toContain(USER_SECTION.trimEnd())
    expect(agents).toContain(WORKFLOW_SECTION.trimEnd())
    expect(agents).toContain(GENERATED_REGION_START)
    expect(agents.trimEnd().endsWith(GENERATED_REGION_END)).toBe(true)
    // Shipped generated sections are not duplicated beside the region
    for (const heading of ['Coding-agent identity and onboarding', 'Managed project capabilities', 'File edits and shell calls']) expect(headingCount(agents, heading)).toBe(1)
    expect(agents).not.toContain(KEPT_FOR_REVIEW_HEADING)
    // A shipped template section is refreshed to the current, tool-neutral wording
    expect(agents).not.toContain('SessionStart')
    expect(agents).toContain('sf status --agent-friendly --no-network')
    expect(await read(CLAUDE_CODE_RULE_PATH)).toContain('SessionStart')
    expect(m.fileHashes).not.toHaveProperty('AGENTS.md')
    expect(m.fileHashes).not.toHaveProperty('CLAUDE.md')
    expect(output()).toContain('Moved CLAUDE.md into AGENTS.md')
  })

  it('loses no line the user wrote: every line outside shipped sections lands in AGENTS.md', async () => {
    const claude = await installed('api')
    await put({ 'CLAUDE.md': claude })

    await moveClaudeMdToAgentsMd.up(dir, manifest({ structure: 'multirepo', projectName: 'acme' }))

    const agents = await read('AGENTS.md')
    const plan = splitSections(claude)
    const userLines = [...WORKFLOW_SECTION.split('\n'), ...USER_SECTION.split('\n')].filter((line) => line.trim())
    for (const line of userLines) expect(agents).toContain(line)
    expect(plan.length).toBeGreaterThan(5)
  })

  it('keeps an edited copy of a generated section verbatim under a marked heading', async () => {
    const edited = '## Coding-agent identity and onboarding\n\nAlways ask me before enabling an agent.\n'
    await put({ 'CLAUDE.md': `# acme\n\n${edited}\n${USER_SECTION}` })

    await moveClaudeMdToAgentsMd.up(dir, manifest())

    const agents = await read('AGENTS.md')
    expect(agents).toContain(`${KEPT_FOR_REVIEW_HEADING}\n\n${edited}`)
    expect(agents.indexOf(KEPT_FOR_REVIEW_HEADING)).toBeLessThan(agents.indexOf(GENERATED_REGION_START))
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false)
    expect(output()).toContain('Kept from CLAUDE.md for review')
  })

  it('never overwrites an AGENTS.md the user wrote: the proposal goes to a sidecar and both files stay', async () => {
    const claude = `# acme\n\n${USER_SECTION}`
    const own = '# My agents\n\nUse pnpm.\n'
    await put({ 'CLAUDE.md': claude, 'AGENTS.md': own })

    await moveClaudeMdToAgentsMd.up(dir, manifest({ fileHashes: {} }))

    expect(await read('CLAUDE.md')).toBe(claude)
    expect(await read('AGENTS.md')).toBe(own)
    const proposal = await read('AGENTS.md.saasfoundry.new')
    expect(proposal.startsWith(own.trimEnd())).toBe(true)
    expect(proposal).toContain(USER_SECTION.trimEnd())
    expect(output()).toContain('Wrote AGENTS.md.saasfoundry.new')
  })

  it('recognises an older generated bridge by its recorded hash, and treats an unrecorded one as the user’s', async () => {
    const olderBridge = '# SaaSFoundry agent instructions\n\nRead `CLAUDE.md` in this project before working.\n'
    await put({ 'CLAUDE.md': `# acme\n\n${USER_SECTION}`, 'AGENTS.md': olderBridge })

    const recorded = (await planClaudeMdMigration(dir, manifest({ fileHashes: { 'AGENTS.md': hashFileContent(olderBridge) } }))).dirs[0]
    const unrecorded = (await planClaudeMdMigration(dir, manifest({ fileHashes: {} }))).dirs[0]

    expect(recorded.outcome).toBe('migrate')
    expect(unrecorded.outcome).toBe('sidecar')
  })

  it('removes the generated CLAUDE.md bridge of a Codex-source project', async () => {
    await put({ 'CLAUDE.md': CODEX_SOURCE_CLAUDE_BRIDGE, 'AGENTS.md': '# Codex rules\n' })

    await moveClaudeMdToAgentsMd.up(dir, manifest())

    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false)
    expect(await read('AGENTS.md')).toBe('# Codex rules\n')
  })

  it('never touches CLAUDE.local.md and reports it', async () => {
    await put({ 'CLAUDE.md': `# acme\n\n${USER_SECTION}`, 'CLAUDE.local.md': 'my notes\n' })

    const preview = await moveClaudeMdToAgentsMd.preview!(dir, manifest())
    await moveClaudeMdToAgentsMd.up(dir, manifest())

    expect(await read('CLAUDE.local.md')).toBe('my notes\n')
    expect(preview).toContainEqual(expect.objectContaining({ action: 'keep', source: 'CLAUDE.local.md' }))
    expect(output()).toContain('Kept CLAUDE.local.md')
  })

  it('migrates a monorepo root and its apps; the apps get no generated region', async () => {
    await put({ 'CLAUDE.md': await installed('monorepo'), 'apps/api/CLAUDE.md': await fixture('api'), 'apps/web/CLAUDE.md': await fixture('web') })

    await moveClaudeMdToAgentsMd.up(dir, manifest({ structure: 'monorepo', fileHashes: {} }))

    for (const app of ['', 'apps/api/', 'apps/web/']) expect(existsSync(join(dir, `${app}CLAUDE.md`))).toBe(false)
    expect(await read('AGENTS.md')).toContain(GENERATED_REGION_START)
    for (const app of ['apps/api', 'apps/web']) {
      const agents = await read(`${app}/AGENTS.md`)
      expect(agents).not.toContain(GENERATED_REGION_START)
      expect(headingCount(agents, 'Coding-agent identity and onboarding')).toBe(0)
    }
  })

  it('lists every section, where it lands and the removal in the preview, without writing anything', async () => {
    const claude = await installed('harness')
    await put({ 'CLAUDE.md': claude, 'AGENTS.md': COMMON_INSTRUCTIONS })

    const preview = await moveClaudeMdToAgentsMd.preview!(dir, manifest())

    const sections = splitSections(claude).filter((section) => section.text.trim())
    expect(preview.filter((entry) => entry.source.startsWith('CLAUDE.md#'))).toHaveLength(sections.length)
    expect(preview).toContainEqual(expect.objectContaining({ action: 'move', source: 'CLAUDE.md#Deployment', target: 'AGENTS.md' }))
    expect(preview).toContainEqual(expect.objectContaining({ action: 'drop', source: 'CLAUDE.md#Coding-agent identity and onboarding' }))
    expect(preview).toContainEqual(expect.objectContaining({ action: 'delete', source: 'CLAUDE.md' }))
    expect(preview).toContainEqual(expect.objectContaining({ action: 'create', target: CLAUDE_CODE_RULE_PATH }))
    expect(await read('CLAUDE.md')).toBe(claude)
    expect(await read('AGENTS.md')).toBe(COMMON_INSTRUCTIONS)
  })

  it('deposits no Claude rule when Claude Code is not declared', async () => {
    await put({ 'CLAUDE.md': `# acme\n\n${USER_SECTION}` })

    await moveClaudeMdToAgentsMd.up(dir, manifest({}, ['codex']))

    expect(existsSync(join(dir, CLAUDE_CODE_RULE_PATH))).toBe(false)
  })

  it('is idempotent', async () => {
    await put({ 'CLAUDE.md': await installed('harness'), 'AGENTS.md': COMMON_INSTRUCTIONS })
    await moveClaudeMdToAgentsMd.up(dir, manifest())
    const after = await read('AGENTS.md')

    await moveClaudeMdToAgentsMd.up(dir, manifest())

    expect(await read('AGENTS.md')).toBe(after)
    expect(await moveClaudeMdToAgentsMd.preview!(dir, manifest())).toEqual([])
  })

  describe('references to the CLAUDE.md files it removes (#1152)', () => {
    /** Mentions that name a CLAUDE.md the migration does not remove: they must come out as they went in. */
    const UNRELATED = '## Notes\n\nPersonal notes live in CLAUDE.local.md and ~/.claude/CLAUDE.md; see https://docs.example.com/guide/CLAUDE.md and MYCLAUDE.md.\n'

    /**
     * The monorepo CLAUDE.md of a project that customised the sections holding the references (as DiamondForge did),
     * so they are moved verbatim instead of being replaced by the current template wording.
     */
    const customised = async (): Promise<string> => {
      const claude = (await fixture('monorepo'))
        .replace('This is a **Turborepo monorepo**', 'This is the DiamondForge **Turborepo monorepo**')
        .replace('- ✅ Tests run automatically before push', '- ✅ Tests run automatically before push, in CI too')
        .replace('- **API Docs**:', '- **Runbook**: `docs/runbook.md`\n- **API Docs**:')
      return `${claude.trimEnd()}\n\n${WORKFLOW_SECTION}\n${UNRELATED}`
    }
    const monorepo = (): SaaSFoundryManifest => manifest({ structure: 'monorepo', fileHashes: {} })

    const PROSE = '- ✅ Use CLAUDE.md files in apps/ for app-specific context'

    it('points the project-structure tree and the app-specific links at the AGENTS.md files that replace them', async () => {
      await put({ 'CLAUDE.md': await customised(), 'apps/api/CLAUDE.md': await fixture('api'), 'apps/web/CLAUDE.md': await fixture('web') })

      await moveClaudeMdToAgentsMd.up(dir, monorepo())

      const agents = await read('AGENTS.md')
      expect(agents).toContain('│   │   └── AGENTS.md     # API-specific context')
      expect(agents).toContain('│       └── AGENTS.md     # Web-specific context')
      expect(agents).toContain('- **App-specific context**: Check `apps/api/AGENTS.md` and `apps/web/AGENTS.md`')
      // The customisations that kept these sections out of the template refresh are still there
      expect(agents).toContain('DiamondForge')
      expect(agents).toContain('docs/runbook.md')
      // What names a deleted file with no doubt is gone; the one bare name in running text is the only CLAUDE.md left (the notes section is checked below)
      const remaining = agents
        .replace(UNRELATED.trimEnd(), '')
        .split('\n')
        .filter((line) => line.includes('CLAUDE.md'))
      expect(remaining).toEqual([PROSE])
      expect(output()).toContain('Rewrote 4 reference(s) in AGENTS.md to a removed CLAUDE.md')
    })

    it('keeps a bare name in running text as the user wrote it, because it can be a label, and reports it', async () => {
      const canary = 'SaaSFoundry fixture CLAUDE.md canary — moves to AGENTS.md line for line.'
      const claude = `# acme\n\n## Fixture conventions\n\n${canary}\n`
      await put({ 'CLAUDE.md': claude })

      const preview = await moveClaudeMdToAgentsMd.preview!(dir, manifest())
      await moveClaudeMdToAgentsMd.up(dir, manifest())

      expect(await read('AGENTS.md')).toContain(`## Fixture conventions\n\n${canary}`)
      expect(preview).toContainEqual(expect.objectContaining({ action: 'report', source: 'CLAUDE.md#Fixture conventions', reason: expect.stringContaining('CLAUDE.md line 5') }))
      expect(preview.filter((entry) => entry.action === 'rewrite')).toEqual([])
      expect(output()).toContain('AGENTS.md: 1 mention(s) of a removed CLAUDE.md in running text were kept as you wrote them')
    })

    it('leaves every mention of a CLAUDE.md it does not remove as written', async () => {
      await put({ 'CLAUDE.md': await customised(), 'apps/api/CLAUDE.md': await fixture('api'), 'apps/web/CLAUDE.md': await fixture('web') })

      await moveClaudeMdToAgentsMd.up(dir, monorepo())

      expect(await read('AGENTS.md')).toContain(UNRELATED.trimEnd())
    })

    it('rewrites a reference found in a section it keeps for review', async () => {
      const edited = '## Coding-agent identity and onboarding\n\nAsk me first. The rules of the API are in apps/api/CLAUDE.md.\n'
      await put({ 'CLAUDE.md': `# acme\n\n${edited}\n${USER_SECTION}`, 'apps/api/CLAUDE.md': '# api\n\nUse pnpm.\n' })

      await moveClaudeMdToAgentsMd.up(dir, manifest({ structure: 'monorepo', fileHashes: {} }))

      const agents = await read('AGENTS.md')
      expect(agents).toContain('The rules of the API are in apps/api/AGENTS.md.')
      // The heading and the comment that name CLAUDE.md as the origin of the review block stay: they say where it came from
      expect(agents).toContain(KEPT_FOR_REVIEW_HEADING)
    })

    it('lists every rewrite in the preview, with its line, and writes nothing', async () => {
      const claude = await customised()
      await put({ 'CLAUDE.md': claude, 'apps/api/CLAUDE.md': await fixture('api'), 'apps/web/CLAUDE.md': await fixture('web') })
      const lineOf = (needle: string): number => claude.split('\n').findIndex((line) => line.includes(needle)) + 1

      const preview = await moveClaudeMdToAgentsMd.preview!(dir, monorepo())

      const rewrites = preview.filter((entry) => entry.action === 'rewrite' && entry.source.startsWith('CLAUDE.md#'))
      expect(rewrites.map((entry) => entry.reason)).toEqual([
        expect.stringContaining(`CLAUDE.md line ${lineOf('API-specific context')}: CLAUDE.md → AGENTS.md`),
        expect.stringContaining(`CLAUDE.md line ${lineOf('Web-specific context')}: CLAUDE.md → AGENTS.md`),
        expect.stringContaining(`CLAUDE.md line ${lineOf('Check `apps/api/CLAUDE.md`')}: apps/api/CLAUDE.md → apps/api/AGENTS.md`),
        expect.stringContaining(`CLAUDE.md line ${lineOf('Check `apps/api/CLAUDE.md`')}: apps/web/CLAUDE.md → apps/web/AGENTS.md`)
      ])
      expect(rewrites[0]).toMatchObject({ source: 'CLAUDE.md#🏗️ Monorepo Structure', target: 'AGENTS.md' })
      // The bare name in running text is listed too, so nothing that names a deleted file goes unreported
      expect(preview.filter((entry) => entry.action === 'report')).toEqual([expect.objectContaining({ reason: expect.stringContaining(`CLAUDE.md line ${lineOf(PROSE)} names a removed CLAUDE.md`) })])
      // Each rewrite sits beside the section it belongs to, which the preview still lists as moved verbatim
      expect(preview).toContainEqual(expect.objectContaining({ action: 'move', source: 'CLAUDE.md#🏗️ Monorepo Structure', target: 'AGENTS.md' }))
      expect(await read('CLAUDE.md')).toBe(claude)
      expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false)
    })

    it('rewrites the reference to an app CLAUDE.md that is a generated bridge, which the migration removes', async () => {
      await put({ 'CLAUDE.md': await customised(), 'apps/api/CLAUDE.md': await fixture('api'), 'apps/web/CLAUDE.md': CODEX_SOURCE_CLAUDE_BRIDGE, 'apps/web/AGENTS.md': '# web\n' })

      await moveClaudeMdToAgentsMd.up(dir, monorepo())

      expect(existsSync(join(dir, 'apps/web/CLAUDE.md'))).toBe(false)
      expect(await read('AGENTS.md')).toContain('Check `apps/api/AGENTS.md` and `apps/web/AGENTS.md`')
    })

    it('keeps the reference to an app CLAUDE.md that stays, because the app has an AGENTS.md of its own', async () => {
      await put({ 'CLAUDE.md': await customised(), 'apps/api/CLAUDE.md': await fixture('api'), 'apps/api/AGENTS.md': '# My API\n\nUse pnpm.\n', 'apps/web/CLAUDE.md': await fixture('web') })

      await moveClaudeMdToAgentsMd.up(dir, monorepo())

      expect(existsSync(join(dir, 'apps/api/CLAUDE.md'))).toBe(true)
      expect(existsSync(join(dir, 'apps/web/CLAUDE.md'))).toBe(false)
      expect(await read('AGENTS.md')).toContain('Check `apps/api/CLAUDE.md` and `apps/web/AGENTS.md`')
    })

    it('changes nothing in a CLAUDE.md that names no removed file', async () => {
      const claude = `# acme\n\n${USER_SECTION}\n${UNRELATED}`
      await put({ 'CLAUDE.md': claude })

      const preview = await moveClaudeMdToAgentsMd.preview!(dir, manifest())
      await moveClaudeMdToAgentsMd.up(dir, manifest())

      expect(preview.filter((entry) => entry.action === 'rewrite')).toEqual([])
      expect(await read('AGENTS.md')).toContain(UNRELATED.trimEnd())
      expect(output()).not.toContain('Rewrote')
    })
  })
})
