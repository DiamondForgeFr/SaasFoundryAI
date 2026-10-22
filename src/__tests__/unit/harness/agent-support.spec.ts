import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

import * as adapter from '../../../harness/agent-instructions'
import { enableAgents, readAgentSupport, refreshAgents, replaceAgents } from '../../../harness/agent-support'
import { HARNESS_ASK_COMMANDS, harnessInstallerMeta } from '../../../installers/harness.installer'
import { CLAUDE_CAPTURE_COMMAND, CODEX_HOOKS_PATH } from '../../../harness/delegation-hooks'
import { TIER_AGENT_PATH } from '../../../harness/tier-agents'

// Tier agents (#929) have their own suite; these assertions are about the other deposits.
// Tier agents (#929) and the Codex capture hook (#1035) have their own suites.
const own = (paths: string[]): string[] => paths.filter((path) => !TIER_AGENT_PATH.test(path) && path !== CODEX_HOOKS_PATH)

const SKILL = '---\nname: commit\ndescription: Commit changes\n---\n# Commit\nFollow the project workflow.\n'
const MANIFEST = {
  version: '1.0.0-beta',
  projectName: 'managed',
  structure: 'cli',
  workflow: { tool: 'github-projects', workingBranch: 'develop' },
  modules: { harness: { version: 4, managed: true }, advancedSkills: ['sf-tool-notion'] },
  fileHashes: { 'unrelated.txt': 'preserve-me' }
}

describe('additive managed agent support (#660)', () => {
  let root: string
  const put = async (path: string, content: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
  const get = (path: string) => readFile(join(root, path), 'utf8')
  const manifest = async () => JSON.parse(await get('.saasfoundry.json'))
  const enable = (agents: string[]) => enableAgents({ targetPath: root, agents, scope: 'shared' })
  const replace = (agents: string[]) => replaceAgents({ targetPath: root, agents, scope: 'shared' })
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-agent-support-'))
    await put('.saasfoundry.json', JSON.stringify(MANIFEST, null, 4) + '\n')
    await put('CLAUDE.md', '# Custom common instructions\n')
    await put('.claude/skills/sf-git-commit/SKILL.md', SKILL)
    await put('.claude/settings.json', '{"hooks":{"custom":["preserve"]}}')
    await put('.claude/skills/sf-git-commit/.env', 'TOKEN=private')
  })
  afterEach(async () => {
    jest.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it('unions Claude, Codex and Kimi without reinstalling legacy files or copying credentials', async () => {
    await enable(['claude-code'])
    await enable(['codex'])
    const result = await enable(['kimi'])
    expect(result.configuredAgents).toEqual(['claude-code', 'codex', 'kimi'])
    expect((await manifest()).modules.harness).toEqual({ version: 4, managed: true, agents: result.configuredAgents })
    expect(await get('CLAUDE.md')).toBe('# Custom common instructions\n')
    expect(await get('.claude/skills/sf-git-commit/SKILL.md')).toBe(SKILL)
    expect(await get('.claude/settings.json')).toBe('{"hooks":{"custom":["preserve"]}}')
    await expect(get('.agents/skills/sf-git-commit/.env')).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await manifest()).fileHashes['unrelated.txt']).toBe('preserve-me')
    expect((await manifest()).workflow).toEqual(MANIFEST.workflow)
    expect((await manifest()).modules.advancedSkills).toEqual(MANIFEST.modules.advancedSkills)
  })
  it('supports adding Claude to managed Codex configuration without replacing Codex', async () => {
    await put('.saasfoundry.json', JSON.stringify({ ...MANIFEST, modules: { harness: { version: 4, agents: ['codex'] } } }))
    const result = await enable(['claude-code'])
    expect(result.configuredAgents).toEqual(['claude-code', 'codex'])
    expect(await get('.claude/skills/sf-git-commit/SKILL.md')).toBe(SKILL)
  })
  it('adds Codex without reconciling an unrelated custom Gemini entrypoint', async () => {
    await put('GEMINI.md', '# Personal Gemini instructions\n')

    const result = await enable(['codex'])

    expect(result.report.conflicts).toEqual([])
    expect(result.sharedAgents).toEqual(['claude-code', 'codex'])
    expect(await get('GEMINI.md')).toBe('# Personal Gemini instructions\n')
    await expect(get('GEMINI.md.saasfoundry.new')).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('replaces only the shared declaration and retains prior generated adapters', async () => {
    await enable(['gemini-cli'])
    const gemini = await get('GEMINI.md')

    const result = await replace(['kimi'])

    expect(result.sharedAgents).toEqual(['kimi'])
    expect(result.configuredAgents).toEqual(['kimi'])
    expect((await manifest()).modules.harness.agents).toEqual(['kimi'])
    expect(await get('GEMINI.md')).toBe(gemini)
  })
  it('does not rewrite manifests, skills or hooks on repeat enable or refresh', async () => {
    await enable(['codex', 'codex', 'kimi'])
    const before = await get('.saasfoundry.json')
    const stamp = (await lstat(join(root, '.saasfoundry.json'))).mtimeMs
    const repeated = await enable(['kimi', 'codex'])
    // The first refresh wires the delegation capture hooks into the project settings (#1035): a repeat changes nothing.
    await refreshAgents({ targetPath: root, scope: 'shared' })
    const settings = await get('.claude/settings.json')
    const refreshed = await refreshAgents({ targetPath: root, scope: 'shared' })
    expect(own(repeated.report.written)).toEqual([])
    expect(own(refreshed.report.written)).toEqual([])
    expect(repeated.manifestChanged).toBe(false)
    expect(refreshed.manifestChanged).toBe(false)
    expect(await get('.saasfoundry.json')).toBe(before)
    expect(await get('.claude/settings.json')).toBe(settings)
    expect((await lstat(join(root, '.saasfoundry.json'))).mtimeMs).toBe(stamp)
  })
  it('wires the delegation capture hooks into the project settings on a shared refresh, and only then', async () => {
    await enable(['claude-code'])
    expect(await get('.claude/settings.json')).toBe('{"hooks":{"custom":["preserve"]}}')
    const refreshed = await refreshAgents({ targetPath: root, scope: 'shared' })
    expect(refreshed.report.written).toContain('.claude/settings.json')
    const settings = JSON.parse(await get('.claude/settings.json'))
    expect(settings.hooks.custom).toEqual(['preserve'])
    // The hook runs the CLI the project resolves, never a bare `sf`, and only for the routed sf-<tier> agents
    expect(settings.hooks.SubagentStop[0]).toMatchObject({ matcher: 'sf-.*', hooks: [{ type: 'command', command: CLAUDE_CAPTURE_COMMAND, timeout: 30 }] })
    expect(CLAUDE_CAPTURE_COMMAND).not.toMatch(/(^|[;&|]\s*)sf agents/)
    expect(settings.hooks.PostToolUse[0].matcher).toBe('Agent|Task')
    expect(settings.permissions.allow).toContain('Bash(sf agents route *)')
    // What writes evidence the routing acts on asks first
    expect(settings.permissions.allow).not.toContain('Bash(sf agents outcome mark *)')
    expect(settings.permissions.ask).toEqual(expect.arrayContaining([...HARNESS_ASK_COMMANDS]))
    expect(settings.permissions.allow).not.toContain('Bash(sf agents outcome record *)')
  })
  it('replaces the bare-sf capture hooks and the pre-approved evidence commands an earlier build wrote, and keeps the project own', async () => {
    await put(
      '.claude/settings.json',
      JSON.stringify({
        hooks: {
          SubagentStop: [
            {
              hooks: [
                { type: 'command', command: 'sf agents outcome capture --host claude-code', timeout: 30 },
                { type: 'command', command: 'echo mine' }
              ]
            }
          ]
        },
        permissions: { allow: ['Bash(npm test)', 'Bash(sf agents outcome mark *)', 'Bash(sf agents outcome record *)'] }
      })
    )
    await enable(['claude-code'])
    await refreshAgents({ targetPath: root, scope: 'shared' })
    const settings = JSON.parse(await get('.claude/settings.json'))
    expect(settings.hooks.SubagentStop.flatMap((group: { hooks: { command: string }[] }) => group.hooks.map((hook) => hook.command))).toEqual(['echo mine', CLAUDE_CAPTURE_COMMAND])
    expect(settings.permissions.allow).toContain('Bash(npm test)')
    expect(settings.permissions.allow).not.toContain('Bash(sf agents outcome mark *)')
    expect(settings.permissions.allow).not.toContain('Bash(sf agents outcome record *)')
  })
  it('refreshes generated copies using their successful baselines', async () => {
    await enable(['codex'])
    await put('.claude/skills/sf-git-commit/SKILL.md', SKILL + '\nAdditional source instructions.\n')
    const result = await refreshAgents({ targetPath: root, scope: 'shared' })
    expect(result.report.conflicts).toEqual([])
    expect(result.report.written).toContain('.agents/skills/sf-git-commit/SKILL.md')
    expect(await get('.agents/skills/sf-git-commit/SKILL.md')).toContain('Additional source instructions.')
  })
  it('preserves conflicts and successful baselines without claiming new activation', async () => {
    await put('AGENTS.md', '# My custom instructions\n')
    const result = await enable(['codex'])
    expect(result.report.conflicts).toContain('AGENTS.md')
    expect(result.configuredAgents).toEqual(['claude-code'])
    expect(await get('AGENTS.md')).toBe('# My custom instructions\n')
    expect((await manifest()).modules.harness.agents).toBeUndefined()
    expect((await manifest()).fileHashes['AGENTS.md']).toBeUndefined()
    expect((await manifest()).fileHashes['.agents/skills/sf-git-commit/SKILL.md']).toBeTruthy()
    const sidecar = await get('AGENTS.md.saasfoundry.new')
    await enable(['codex'])
    expect(await get('AGENTS.md.saasfoundry.new')).toBe(sidecar)
  })
  it('does not bless customized destinations as successful refresh baselines', async () => {
    await enable(['codex'])
    const before = await manifest()
    await put('.agents/skills/sf-git-commit/SKILL.md', '# User content')
    const result = await enable(['kimi'])
    expect(result.configuredAgents).toEqual(['claude-code', 'codex'])
    expect(result.report.conflicts).toContain('.agents/skills/sf-git-commit/SKILL.md')
    expect((await manifest()).fileHashes['.agents/skills/sf-git-commit/SKILL.md']).toBe(before.fileHashes['.agents/skills/sf-git-commit/SKILL.md'])
    expect(await get('.agents/skills/sf-git-commit/SKILL.md')).toBe('# User content')
  })
  it('reads configured support separately from runtime verification', async () => {
    expect(await readAgentSupport(root)).toEqual({
      configuredAgents: ['claude-code'],
      sharedAgents: ['claude-code'],
      localAgents: [],
      discovered: { claudeInstructions: true, sharedInstructions: false, sharedSkills: false },
      runtime: 'not-checked'
    })
    await enable(['codex'])
    expect((await readAgentSupport(root)).discovered).toEqual({ claudeInstructions: true, sharedInstructions: true, sharedSkills: true })
  })
  it('supports legacy managed manifests without a harness stamp', async () => {
    await put('.saasfoundry.json', JSON.stringify({ version: '1', projectName: 'legacy', structure: 'cli' }))
    expect((await enable(['codex'])).configuredAgents).toEqual(['claude-code', 'codex'])
    expect((await manifest()).modules.harness.version).toBe(harnessInstallerMeta.currentVersion)
    expect(Object.keys((await manifest()).fileHashes).every((key) => ['AGENTS.md', 'GEMINI.md'].includes(key) || key.startsWith('.agents/') || TIER_AGENT_PATH.test(key))).toBe(true)
  })
  it.each(['project', 'SHARED'])('refuses unsupported scope %s before changing files', async (scope) => {
    const before = await get('.saasfoundry.json')
    await expect(enableAgents({ targetPath: root, agents: ['codex'], scope })).rejects.toThrow('scope must be')
    expect(await get('.saasfoundry.json')).toBe(before)
    expect(await readdir(root)).toEqual(expect.not.arrayContaining(['AGENTS.md', '.agents', '.saasfoundry.agents.lock']))
  })
  it.each([[], ['gpt-5'], ['claude'], ['unknown', 'codex']])('rejects unknown/model agent identifiers %j without partial application', async (...agents) => {
    const before = await get('.saasfoundry.json')
    await expect(enable(agents)).rejects.toThrow('Choose coding agents')
    expect(await get('.saasfoundry.json')).toBe(before)
    expect(await readdir(root)).not.toContain('AGENTS.md')
  })
  it.each(['{}', '[]', '{bad', JSON.stringify({ ...MANIFEST, modules: [] }), JSON.stringify({ ...MANIFEST, fileHashes: [] })])('rejects invalid manifests without mutation: %s', async (content) => {
    await put('.saasfoundry.json', content)
    await expect(enable(['codex'])).rejects.toThrow('Invalid')
    expect(await get('.saasfoundry.json')).toBe(content)
    expect(await readdir(root)).not.toContain('AGENTS.md')
  })
  it.each(['.saasfoundry.json', 'CLAUDE.md'])('rejects missing required managed harness path %s', async (target) => {
    await rm(join(root, target), { recursive: true })
    await expect(enable(['codex'])).rejects.toThrow('No managed harness')
    expect(await readdir(root)).not.toContain('AGENTS.md')
  })
  it.each(['.saasfoundry.json', 'CLAUDE.md', '.claude', '.agents'])('rejects symlink targets and ancestors %s before writing', async (target) => {
    const external = await mkdtemp(join(tmpdir(), 'sf-agent-external-'))
    try {
      await writeFile(join(external, 'file'), '# untouched')
      await rm(join(root, target), { recursive: true, force: true })
      await symlink(target.endsWith('.json') || target.endsWith('.md') ? join(external, 'file') : external, join(root, target))
      await expect(enable(['codex'])).rejects.toThrow('symbolic link')
      expect(await readFile(join(external, 'file'), 'utf8')).toBe('# untouched')
      expect(await readdir(external)).toEqual(['file'])
      expect(await readdir(root)).not.toContain('AGENTS.md')
    } finally {
      await rm(external, { recursive: true, force: true })
    }
  })
  it('rejects a directory in place of a manifest', async () => {
    await rm(join(root, '.saasfoundry.json'))
    await mkdir(join(root, '.saasfoundry.json'))
    await expect(enable(['codex'])).rejects.toThrow('regular file')
    expect(await readdir(root)).not.toContain('AGENTS.md')
  })
  it('does not overwrite a manifest changed while generating artifacts', async () => {
    const actual = adapter.installAgentInstructions
    jest.spyOn(adapter, 'installAgentInstructions').mockImplementationOnce(async (params) => {
      const result = await actual(params)
      await put('.saasfoundry.json', JSON.stringify({ ...MANIFEST, projectName: 'concurrent-edit' }))
      return result
    })
    await expect(enable(['codex'])).rejects.toThrow('Manifest changed during')
    expect((await manifest()).projectName).toBe('concurrent-edit')
    expect((await manifest()).modules.harness.agents).toBeUndefined()
    expect(await readdir(root)).not.toContain('.saasfoundry.agents.lock')
    expect((await enable(['codex'])).report.conflicts).toEqual([])
  })
  it('refuses a second writer while an agent setup lock exists', async () => {
    await put('.saasfoundry.agents.lock', 'another operation')
    const before = await get('.saasfoundry.json')
    await expect(enable(['codex'])).rejects.toThrow('Another agent setup')
    expect(await get('.saasfoundry.json')).toBe(before)
    expect(await get('.saasfoundry.agents.lock')).toBe('another operation')
    expect(await readdir(root)).not.toContain('AGENTS.md')
  })
})
