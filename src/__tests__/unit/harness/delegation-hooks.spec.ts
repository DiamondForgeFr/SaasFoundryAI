import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { GENERATED_REGION_END, GENERATED_REGION_START, installAgentInstructions, planAgentInstructions } from '../../../harness/agent-instructions'
import { captureState, CLAUDE_CAPTURE_COMMAND, CLAUDE_CAPTURE_HOOKS, CODEX_CAPTURE_COMMAND, CODEX_HOOKS_PATH, renderCodexHooks } from '../../../harness/delegation-hooks'
import { mergeClaudeSettingsHooks, mergeClaudeSettingsPermissions } from '../../../utils/claude-settings'

describe('the hooks that capture delegations (#1035)', () => {
  let root: string
  const put = async (path: string, content: string) => {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), content)
  }
  const get = (path: string) => readFile(join(root, path), 'utf8')

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-capture-hooks-'))
  })
  afterEach(async () => rm(root, { recursive: true, force: true }))

  describe('Claude Code settings', () => {
    it('declares the stop of any agent and the result of the delegation tool, on one command', () => {
      expect(CLAUDE_CAPTURE_HOOKS.SubagentStop[0].hooks[0].command).toBe(CLAUDE_CAPTURE_COMMAND)
      expect(CLAUDE_CAPTURE_HOOKS.PostToolUse[0]).toMatchObject({ matcher: 'Agent|Task', hooks: [{ command: CLAUDE_CAPTURE_COMMAND }] })
    })

    it('merges into the settings a project already has, keeps its own hooks, and is idempotent', async () => {
      await put('.claude/settings.json', JSON.stringify({ model: 'opus', hooks: { SubagentStop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }))
      expect(await mergeClaudeSettingsHooks(root, CLAUDE_CAPTURE_HOOKS)).toBe(true)
      const settings = JSON.parse(await get('.claude/settings.json'))
      expect(settings.model).toBe('opus')
      expect(settings.hooks.SubagentStop.flatMap((group: { hooks: { command: string }[] }) => group.hooks.map((hook) => hook.command))).toEqual(['echo mine', CLAUDE_CAPTURE_COMMAND])
      expect(settings.hooks.PostToolUse).toHaveLength(1)
      const written = await get('.claude/settings.json')
      expect(await mergeClaudeSettingsHooks(root, CLAUDE_CAPTURE_HOOKS)).toBe(false)
      expect(await get('.claude/settings.json')).toBe(written)
    })

    it('leaves the formatting of a settings file alone when there is nothing to add', async () => {
      const compact = JSON.stringify({ hooks: CLAUDE_CAPTURE_HOOKS })
      await put('.claude/settings.json', compact)
      expect(await mergeClaudeSettingsHooks(root, CLAUDE_CAPTURE_HOOKS)).toBe(false)
      expect(await get('.claude/settings.json')).toBe(compact)
    })

    it('reports whether the permissions changed', async () => {
      expect(await mergeClaudeSettingsPermissions(root, ['Bash(sf agents route *)'])).toBe(true)
      expect(await mergeClaudeSettingsPermissions(root, ['Bash(sf agents route *)'])).toBe(false)
    })
  })

  describe('the Codex hooks file', () => {
    it('is created with the capture hook', () => {
      const rendered = renderCodexHooks()
      expect(rendered).toEqual({ content: expect.any(String) })
      expect(JSON.parse((rendered as { content: string }).content)).toEqual({
        hooks: { SubagentStop: [{ hooks: [{ type: 'command', command: CODEX_CAPTURE_COMMAND, timeout: 30 }] }] }
      })
    })

    it('adds the hook to what the project already has, and changes nothing the second time', () => {
      const existing = JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'sf status --agent-friendly' }] }], SubagentStop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] },
        extra: 1
      })
      const first = renderCodexHooks(existing) as { content: string }
      const config = JSON.parse(first.content)
      expect(config.extra).toBe(1)
      expect(config.hooks.SessionStart).toHaveLength(1)
      expect(config.hooks.SubagentStop.map((group: { hooks: { command: string }[] }) => group.hooks[0].command)).toEqual(['echo mine', CODEX_CAPTURE_COMMAND])
      expect(renderCodexHooks(first.content)).toEqual({ content: first.content })
    })

    it.each([
      ['not JSON', '{ nope', 'is not valid JSON'],
      ['an array', '[]', 'is not a hooks object'],
      ['hooks that are not an object', '{"hooks":[]}', 'is not a hooks object']
    ])('refuses to touch a file that is %s', (_, existing, message) => {
      expect(renderCodexHooks(existing)).toEqual({ error: expect.stringContaining(message) })
    })
  })

  describe('the deposit with the instructions', () => {
    beforeEach(async () => {
      await put('AGENTS.md', `# Project\n\n${GENERATED_REGION_START}\n${GENERATED_REGION_END}\n`)
    })

    it('plans the Codex hooks file for a declared Codex, as a merge the project keeps owning, and none for Claude Code alone', async () => {
      const codex = await planAgentInstructions({ targetPath: root, agents: ['codex'] })
      expect(codex.files.find((file) => file.path === CODEX_HOOKS_PATH)).toMatchObject({ merge: true, mode: 0o644 })
      const claude = await planAgentInstructions({ targetPath: root, agents: ['claude-code'] })
      expect(claude.files.map((file) => file.path)).not.toContain(CODEX_HOOKS_PATH)
    })

    it('deposits it, tracks no baseline for it, and writes nothing the second time', async () => {
      const first = await installAgentInstructions({ targetPath: root, agents: ['codex'] })
      expect(first.written).toContain(CODEX_HOOKS_PATH)
      expect(first.fileHashes[CODEX_HOOKS_PATH]).toBeUndefined()
      expect(await captureState(root, 'codex')).toBe('enforced')
      const second = await installAgentInstructions({ targetPath: root, agents: ['codex'], manifest: { fileHashes: first.fileHashes } })
      expect(second.written).not.toContain(CODEX_HOOKS_PATH)
      expect(second.unchanged).toContain(CODEX_HOOKS_PATH)
    })

    it('keeps the hooks a project wrote in its own file, with no conflict', async () => {
      await put(CODEX_HOOKS_PATH, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'sf status --agent-friendly' }] }] } }))
      const result = await installAgentInstructions({ targetPath: root, agents: ['codex'] })
      expect(result.conflicts).toEqual([])
      const config = JSON.parse(await get(CODEX_HOOKS_PATH))
      expect(config.hooks.SessionStart).toHaveLength(1)
      expect(config.hooks.SubagentStop).toHaveLength(1)
    })

    it('warns and leaves a hooks file that is not JSON exactly as it is', async () => {
      await put(CODEX_HOOKS_PATH, '{ broken')
      const result = await installAgentInstructions({ targetPath: root, agents: ['codex'] })
      expect(result.warnings.join('\n')).toContain('is not valid JSON; the delegation capture hook was not added')
      expect(await get(CODEX_HOOKS_PATH)).toBe('{ broken')
    })

    it('does not write through a link', async () => {
      await mkdir(join(root, 'elsewhere'), { recursive: true })
      await symlink(join(root, 'elsewhere'), join(root, '.codex'))
      const result = await installAgentInstructions({ targetPath: root, agents: ['codex'] })
      expect(result.warnings.join('\n')).toContain('symbolic link destination left untouched')
    })
  })

  describe('what is enforced', () => {
    it('reads the hook declarations, not the host', async () => {
      expect(await captureState(root, 'claude-code')).toBe('missing')
      expect(await captureState(root, 'codex')).toBe('missing')
      await put('.claude/settings.json', JSON.stringify({ hooks: CLAUDE_CAPTURE_HOOKS }))
      expect(await captureState(root, 'claude-code')).toBe('enforced')
    })

    it('says a host without hooks is not enforced: its delegations are recorded by hand', async () => {
      expect(await captureState(root, 'gemini-cli')).toBe('not-enforced')
      expect(await captureState(root, 'kimi')).toBe('not-enforced')
    })

    it('treats a settings file that cannot be read as missing rather than failing', async () => {
      await put('.claude/settings.json', '{ nope')
      expect(await captureState(root, 'claude-code')).toBe('missing')
    })
  })
})
