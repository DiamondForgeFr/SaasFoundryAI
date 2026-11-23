import { spawn } from 'child_process'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

import { GENERATED_REGION_END, GENERATED_REGION_START, installAgentInstructions, planAgentInstructions } from '../../../harness/agent-instructions'
import {
  captureCommand,
  captureStanding,
  captureState,
  CLAUDE_CAPTURE_COMMAND,
  CLAUDE_CAPTURE_HOOKS,
  CODEX_CAPTURE_COMMAND,
  CODEX_HOOKS_PATH,
  CODEX_RETRUST_NOTICE,
  defaultCaptureProbe,
  isLegacyCaptureCommand,
  renderCodexHooks,
  resolveCaptureCli,
  V1_1_0_CAPTURE_COMMANDS,
  V1_2_0_CAPTURE_COMMANDS
} from '../../../harness/delegation-hooks'
import { readCaptureErrors } from '../../../harness/capture-errors'
import { CODEX_GUARD_COMMAND, CODEX_GUARD_TRUST_NOTICE, guardState } from '../../../harness/guard-hook'
import { mergeClaudeSettingsHooks, mergeClaudeSettingsPermissions } from '../../../utils/claude-settings'
import { hermeticPath, nodeBinDir } from '../../helpers/hermetic-path'

// The system tools only, without any CLI the machine installed there (#1128).
const SYSTEM_PATH = hermeticPath('/usr/bin:/bin')

describe('the hooks that capture delegations (#1035)', () => {
  let root: string
  const put = async (path: string, content: string) => {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), content)
  }
  const get = (path: string) => readFile(join(root, path), 'utf8')
  /** A program that records how it was called and what it read, then exits with `code`. */
  const program = async (path: string, code = 0, extra = '') => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), `#!/bin/sh\nprintf '%s\\n' "$0 $*" >> "${root}/calls.log"\ncat > "${root}/stdin-$(basename "$0").log"\n${extra}\nexit ${code}\n`)
    await chmod(join(root, path), 0o755)
  }
  const calls = async () => (await readFile(join(root, 'calls.log'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean)

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'sf-capture-hooks-')))
  })
  afterEach(async () => rm(root, { recursive: true, force: true }))

  /** Run the hook command the way a host does: through a shell, in the project, the payload on stdin. */
  const runHook = (command: string, payload: string, env: Record<string, string> = {}) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn('sh', ['-c', command], { cwd: root, env: { PATH: `${root}/bin:${nodeBinDir()}:${SYSTEM_PATH}`, ...env } })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += chunk))
      child.stderr.on('data', (chunk) => (stderr += chunk))
      child.on('error', reject)
      child.on('close', (code) => resolve({ code, stdout, stderr }))
      child.stdin.end(payload)
    })
  const SUBAGENT = JSON.stringify({ hook_event_name: 'SubagentStop', agent_type: 'sf-build', last_assistant_message: 'done' })

  describe('the command a host runs (Examine finding 3)', () => {
    it('is a self-contained shell line for each host, never a bare sf', () => {
      expect(captureCommand('claude-code')).toBe(CLAUDE_CAPTURE_COMMAND)
      expect(captureCommand('codex')).toBe(CODEX_CAPTURE_COMMAND)
      expect(CLAUDE_CAPTURE_COMMAND).toContain('--host claude-code')
      expect(CODEX_CAPTURE_COMMAND).toContain('--host codex')
      for (const command of [CLAUDE_CAPTURE_COMMAND, CODEX_CAPTURE_COMMAND]) {
        expect(command).not.toMatch(/(^|[;|&]\s*)"?sf"? agents/)
        expect(command).not.toContain('\n')
        expect(isLegacyCaptureCommand(command)).toBe(false)
      }
      expect(isLegacyCaptureCommand('sf agents outcome capture --host claude-code')).toBe(true)
      expect(isLegacyCaptureCommand('sf agents outcome capture --host codex')).toBe(true)
      expect(isLegacyCaptureCommand('sf agents outcome capture --host gemini')).toBe(false)
    })

    it('leaves at once, before Node starts, when the payload does not mention a routed agent', async () => {
      await program('node_modules/.bin/saasfoundryai')
      const result = await runHook(CLAUDE_CAPTURE_COMMAND, JSON.stringify({ hook_event_name: 'SubagentStop', agent_type: 'Explore' }))
      expect(result).toEqual({ code: 0, stdout: '', stderr: '' })
      expect(await calls()).toEqual([])
    })

    it('runs the CLI of the project with the payload on stdin and the host it was asked for', async () => {
      await program('node_modules/.bin/saasfoundryai')
      const result = await runHook(CLAUDE_CAPTURE_COMMAND, SUBAGENT)
      expect(result).toEqual({ code: 0, stdout: '', stderr: '' })
      // Run from the project directory, with no CLAUDE_PROJECT_DIR: the project is `.`
      expect(await calls()).toEqual(['./node_modules/.bin/saasfoundryai agents outcome capture --host claude-code'])
      expect(await readFile(join(root, 'stdin-saasfoundryai.log'), 'utf8')).toBe(SUBAGENT)
      await rm(join(root, 'calls.log'))
      await runHook(CODEX_CAPTURE_COMMAND, SUBAGENT)
      expect((await calls())[0]).toContain('--host codex')
    })

    it('finds the project from CLAUDE_PROJECT_DIR when the host runs the hook from another directory', async () => {
      await program('node_modules/.bin/saasfoundryai')
      const elsewhere = join(root, 'elsewhere')
      await mkdir(elsewhere)
      const result = await new Promise<number | null>((resolve) => {
        const child = spawn('sh', ['-c', CLAUDE_CAPTURE_COMMAND], { cwd: elsewhere, env: { PATH: SYSTEM_PATH, CLAUDE_PROJECT_DIR: root } })
        child.on('close', resolve)
        child.stdin.end(SUBAGENT)
      })
      expect(result).toBe(0)
      expect(await calls()).toHaveLength(1)
    })

    it('prefers the saasfoundryai of the project, then its sf, then the build of this repository, then saasfoundryai on the PATH', async () => {
      await program('node_modules/.bin/sf')
      await program('bin/saasfoundryai')
      await runHook(CLAUDE_CAPTURE_COMMAND, SUBAGENT)
      expect((await calls())[0]).toContain('node_modules/.bin/sf agents')
      await rm(join(root, 'calls.log'))
      await rm(join(root, 'node_modules'), { recursive: true })
      await runHook(CLAUDE_CAPTURE_COMMAND, SUBAGENT)
      expect((await calls())[0]).toContain(`${root}/bin/saasfoundryai agents`)
    })

    it('runs the build of the repository itself when the project is SaaSFoundry', async () => {
      await put('package.json', '{\n  "name": "saasfoundryai-cli"\n}\n')
      await put('bin/sf.js', `require('fs').appendFileSync(${JSON.stringify(join(root, 'calls.log'))}, 'sf.js ' + process.argv.slice(2).join(' ') + '\\n')\n`)
      expect((await runHook(CLAUDE_CAPTURE_COMMAND, SUBAGENT)).code).toBe(0)
      expect(await calls()).toEqual(['sf.js agents outcome capture --host claude-code'])
      // Another project that happens to have a bin/sf.js is not asked to run it
      await put('package.json', '{\n  "name": "something-else"\n}\n')
      await rm(join(root, 'calls.log'))
      await runHook(CLAUDE_CAPTURE_COMMAND, SUBAGENT)
      expect(await calls()).toEqual([])
    })

    it('never runs a bare sf: another CLI by that name (Salesforce) is not the SaaSFoundry one', async () => {
      await program('bin/sf')
      const result = await runHook(CLAUDE_CAPTURE_COMMAND, SUBAGENT)
      expect(result).toEqual({ code: 0, stdout: '', stderr: '' })
      expect(await calls()).toEqual([])
    })

    // #1105: the CLI's stdout is the host's: it carries the decision that keeps a delegate running. Its stderr is not.
    // #1228: a CLI that fails on the command (too old to know it) is said in one line of the hook's own, not in silence.
    const NOTICE = (code: number) => `saasfoundryai: ./node_modules/.bin/saasfoundryai cannot run agents outcome capture (exit ${code}): upgrade saasfoundryai-cli\n`
    it('exits 0, keeps the CLI error out of the host, and says in one line that the CLI is too old to know the command', async () => {
      await program('node_modules/.bin/saasfoundryai', 1, 'echo "error: unknown command outcome" >&2')
      expect(await runHook(CLAUDE_CAPTURE_COMMAND, SUBAGENT)).toEqual({ code: 0, stdout: '', stderr: NOTICE(1) })
    })

    it('lets what the CLI prints on stdout reach the host and nothing of its stderr, and still exits 0 when the CLI fails', async () => {
      const decision = '{"decision":"block","reason":"add the line"}'
      await program('node_modules/.bin/saasfoundryai', 3, `echo '${decision}'; echo "a warning" >&2`)
      expect(await runHook(CLAUDE_CAPTURE_COMMAND, SUBAGENT)).toEqual({ code: 0, stdout: `${decision}\n`, stderr: NOTICE(3) })
      await rm(join(root, 'calls.log'))
      expect(await runHook(CODEX_CAPTURE_COMMAND, SUBAGENT)).toEqual({ code: 0, stdout: `${decision}\n`, stderr: NOTICE(3) })
    })

    it('writes a CLI that cannot run the command to the capture error log of the clone, where sf status counts it', async () => {
      await new Promise<void>((resolve, reject) => spawn('git', ['init', '-q'], { cwd: root }).on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git init ${code}`)))))
      await program('node_modules/.bin/saasfoundryai', 1, 'echo "error: unknown command outcome" >&2')
      expect((await runHook(CODEX_CAPTURE_COMMAND, SUBAGENT)).code).toBe(0)
      const summary = await readCaptureErrors(join(root, '.git', 'saasfoundry'), { since: new Date(Date.now() - 60_000) })
      expect(summary.count).toBe(1)
      expect(summary.last).toMatchObject({
        host: 'codex',
        event: 'capture',
        stage: 'cli',
        message: './node_modules/.bin/saasfoundryai cannot run agents outcome capture (exit 1): upgrade saasfoundryai-cli in the project or on the PATH'
      })
      // A CLI that runs the command leaves nothing
      await program('node_modules/.bin/saasfoundryai', 0)
      await runHook(CODEX_CAPTURE_COMMAND, SUBAGENT)
      expect((await readCaptureErrors(join(root, '.git', 'saasfoundry'), { since: new Date(Date.now() - 60_000) })).count).toBe(1)
    })

    it('prints the decision once, whichever CLI answers first: the first one that resolves is the only one that runs', async () => {
      await program('node_modules/.bin/saasfoundryai', 0, 'echo \'{"decision":"block","reason":"first"}\'')
      await program('node_modules/.bin/sf', 0, 'echo \'{"decision":"block","reason":"second"}\'')
      const result = await runHook(CLAUDE_CAPTURE_COMMAND, SUBAGENT)
      expect(result.stdout).toBe('{"decision":"block","reason":"first"}\n')
      expect(await calls()).toHaveLength(1)
    })

    it('exits 0 and says nothing when no CLI can be found, a project that never installed it among them', async () => {
      expect(await runHook(CLAUDE_CAPTURE_COMMAND, SUBAGENT)).toEqual({ code: 0, stdout: '', stderr: '' })
    })

    it('runs saasfoundryai from the PATH when the project carries none', async () => {
      await program('bin/saasfoundryai')
      await runHook(CODEX_CAPTURE_COMMAND, SUBAGENT)
      expect((await calls())[0]).toContain(`${root}/bin/saasfoundryai agents outcome capture --host codex`)
    })
  })

  // The commands v1.1.0 shipped sit in every project it installed or updated. They are replaced, never duplicated (#1105).
  describe('the commands v1.1.0 shipped', () => {
    const V110 = join(__dirname, '../../fixtures/harness/v1.1.0')
    const fixtureText = (name: string) => readFile(join(V110, name), 'utf8')
    /** Every command of an event, flattened. */
    const commands = (config: { hooks: Record<string, { hooks: { command: string }[] }[]> }, event: string) => config.hooks[event].flatMap((group) => group.hooks.map((hook) => hook.command))

    it('are written out as the golden bytes of the tag, and are not today command', async () => {
      const claude = JSON.parse(await fixtureText('claude-settings.json'))
      const codex = JSON.parse(await fixtureText('codex-hooks.json'))
      expect(commands(claude, 'SubagentStop')).toEqual([V1_1_0_CAPTURE_COMMANDS[0]])
      expect(commands(claude, 'PostToolUse')).toEqual([V1_1_0_CAPTURE_COMMANDS[0]])
      expect(commands(codex, 'SubagentStop')).toEqual([V1_1_0_CAPTURE_COMMANDS[1]])
      expect(V1_1_0_CAPTURE_COMMANDS[0]).toContain('--host claude-code >/dev/null 2>&1; exit 0; }')
      expect(V1_1_0_CAPTURE_COMMANDS[1]).toContain('--host codex >/dev/null 2>&1; exit 0; }')
      expect(V1_1_0_CAPTURE_COMMANDS).not.toContain(CLAUDE_CAPTURE_COMMAND)
      expect(V1_1_0_CAPTURE_COMMANDS).not.toContain(CODEX_CAPTURE_COMMAND)
      // v1.2.0 only changed the redirection that discarded the CLI stdout
      expect(V1_2_0_CAPTURE_COMMANDS[0]).toBe(V1_1_0_CAPTURE_COMMANDS[0].replace('>/dev/null 2>&1', '2>/dev/null'))
      expect(V1_2_0_CAPTURE_COMMANDS[1]).toBe(V1_1_0_CAPTURE_COMMANDS[1].replace('>/dev/null 2>&1', '2>/dev/null'))
    })

    it('are legacy commands, and a hand-edited copy or today command is not', () => {
      for (const command of V1_1_0_CAPTURE_COMMANDS) {
        expect(isLegacyCaptureCommand(command)).toBe(true)
        expect(isLegacyCaptureCommand(`${command} # mine`)).toBe(false)
      }
      expect(isLegacyCaptureCommand(CLAUDE_CAPTURE_COMMAND)).toBe(false)
      expect(isLegacyCaptureCommand(CODEX_CAPTURE_COMMAND)).toBe(false)
    })

    it('are replaced in a Claude Code settings file by one capture hook per event, keeping everything else', async () => {
      const original = await fixtureText('claude-settings.json')
      await put('.claude/settings.json', original)
      expect(await mergeClaudeSettingsHooks(root, CLAUDE_CAPTURE_HOOKS, { supersedes: isLegacyCaptureCommand })).toBe(true)
      const merged = JSON.parse(await get('.claude/settings.json'))
      expect(commands(merged, 'SubagentStop')).toEqual([CLAUDE_CAPTURE_COMMAND])
      expect(commands(merged, 'PostToolUse')).toEqual([CLAUDE_CAPTURE_COMMAND])
      expect(commands(merged, 'UserPromptSubmit')).toEqual(['.claude/skills/sf-srs/scripts/srs-intent-hook.sh'])
      expect(merged.permissions).toEqual(JSON.parse(original).permissions)
      // and the next run has nothing to do
      expect(await mergeClaudeSettingsHooks(root, CLAUDE_CAPTURE_HOOKS, { supersedes: isLegacyCaptureCommand })).toBe(false)
    })

    it('are replaced in a Codex hooks file, which keeps its other hooks, says Codex has to trust the new one, and then changes nothing', async () => {
      const original = await fixtureText('codex-hooks.json')
      const first = renderCodexHooks(original) as { content: string; replaced?: true }
      expect(first.replaced).toBe(true)
      const config = JSON.parse(first.content)
      expect(commands(config, 'SubagentStop')).toEqual([CODEX_CAPTURE_COMMAND])
      expect(commands(config, 'UserPromptSubmit')).toEqual(['.claude/skills/sf-srs/scripts/srs-intent-hook.sh'])
      expect(commands(config, 'SessionStart')).toEqual(JSON.parse(original).hooks.SessionStart.map((group: { hooks: { command: string }[] }) => group.hooks[0].command))
      const again = renderCodexHooks(first.content) as { content: string; replaced?: true }
      expect(again).toEqual({ content: first.content })
      expect(CODEX_RETRUST_NOTICE).toContain('/hooks')
    })

    it('are an outdated hook, not a missing one, and a refresh makes the new one enforced', async () => {
      await put('.claude/settings.json', await fixtureText('claude-settings.json'))
      await put(CODEX_HOOKS_PATH, await fixtureText('codex-hooks.json'))
      expect(await captureState(root, 'claude-code', async () => true)).toBe('outdated')
      expect(await captureState(root, 'codex', async () => true)).toBe('outdated')
      await mergeClaudeSettingsHooks(root, CLAUDE_CAPTURE_HOOKS, { supersedes: isLegacyCaptureCommand })
      await put(CODEX_HOOKS_PATH, (renderCodexHooks(await fixtureText('codex-hooks.json')) as { content: string }).content)
      expect(await captureState(root, 'claude-code', async () => true)).toBe('enforced')
      expect(await captureState(root, 'codex', async () => true)).toBe('declared')
    })
  })

  // The commands v1.2.0 shipped exited silently on a CLI that could not run them. They are replaced, never duplicated (#1228).
  describe('the commands v1.2.0 shipped', () => {
    const fixtureText = (name: string) => readFile(join(__dirname, '../../fixtures/harness/v1.2.0', name), 'utf8')
    const commands = (config: { hooks: Record<string, { hooks: { command: string }[] }[]> }, event: string) => config.hooks[event].flatMap((group) => group.hooks.map((hook) => hook.command))

    it('are the golden bytes of the tag, legacy commands, and not today command', async () => {
      const claude = JSON.parse(await fixtureText('claude-settings.json'))
      const codex = JSON.parse(await fixtureText('codex-hooks.json'))
      expect(commands(claude, 'SubagentStop')).toEqual([V1_2_0_CAPTURE_COMMANDS[0]])
      expect(commands(claude, 'PostToolUse')).toEqual([V1_2_0_CAPTURE_COMMANDS[0]])
      expect(commands(codex, 'SubagentStop')).toEqual([V1_2_0_CAPTURE_COMMANDS[1]])
      for (const command of V1_2_0_CAPTURE_COMMANDS) {
        expect(isLegacyCaptureCommand(command)).toBe(true)
        expect(isLegacyCaptureCommand(`${command} # mine`)).toBe(false)
      }
      expect(V1_2_0_CAPTURE_COMMANDS).not.toContain(CLAUDE_CAPTURE_COMMAND)
      // The only difference with today is the note on a CLI that fails
      expect(CLAUDE_CAPTURE_COMMAND).toContain('2>/dev/null || note "$*" $?; exit 0; }')
      expect(CLAUDE_CAPTURE_COMMAND).toContain('"host":"claude-code","event":"capture","stage":"cli"')
    })

    it('are replaced in a Claude Code settings file and a Codex hooks file, and are an outdated hook until then', async () => {
      await put('.claude/settings.json', await fixtureText('claude-settings.json'))
      expect(await captureState(root, 'claude-code', async () => true)).toBe('outdated')
      // An outdated hook still runs the CLI it reaches: one that cannot run the command is said first
      expect(await captureState(root, 'claude-code', async () => false)).toBe('declared-not-runnable')
      expect(await mergeClaudeSettingsHooks(root, CLAUDE_CAPTURE_HOOKS, { supersedes: isLegacyCaptureCommand })).toBe(true)
      const merged = JSON.parse(await get('.claude/settings.json'))
      expect(commands(merged, 'SubagentStop')).toEqual([CLAUDE_CAPTURE_COMMAND])
      expect(commands(merged, 'PostToolUse')).toEqual([CLAUDE_CAPTURE_COMMAND])
      const codex = renderCodexHooks(await fixtureText('codex-hooks.json')) as { content: string; replaced?: true }
      expect(codex.replaced).toBe(true)
      expect(commands(JSON.parse(codex.content), 'SubagentStop')).toEqual([CODEX_CAPTURE_COMMAND])
    })
  })

  describe('the CLI the project resolves', () => {
    it('finds it in the order the hook does, and nothing when there is none', async () => {
      expect(await resolveCaptureCli(root, SYSTEM_PATH)).toBeUndefined()
      await program('bin/saasfoundryai')
      expect(await resolveCaptureCli(root, `${root}/bin:${SYSTEM_PATH}`)).toEqual({ command: `${root}/bin/saasfoundryai`, args: [] })
      await program('node_modules/.bin/sf')
      expect(await resolveCaptureCli(root, `${root}/bin:${SYSTEM_PATH}`)).toEqual({ command: `${root}/node_modules/.bin/sf`, args: [] })
      await program('node_modules/.bin/saasfoundryai')
      expect(await resolveCaptureCli(root, SYSTEM_PATH)).toEqual({ command: `${root}/node_modules/.bin/saasfoundryai`, args: [] })
    })

    it('asks it whether it knows the command: a release before outcome capture does not', async () => {
      const cli = `${root}/node_modules/.bin/saasfoundryai`
      await program('node_modules/.bin/saasfoundryai', 0, 'echo "Usage: sf agents outcome capture --host <agent>"')
      expect(await defaultCaptureProbe(root)).toEqual({ runnable: true, cli })
      await program('node_modules/.bin/saasfoundryai', 1, 'echo "error: unknown command capture" >&2')
      expect(await defaultCaptureProbe(root)).toEqual({ runnable: false, cli })
      await rm(join(root, 'node_modules'), { recursive: true })
      // The probe falls back to the PATH: keep a CLI installed on the machine out of the assertion.
      const hostPath = process.env.PATH
      process.env.PATH = SYSTEM_PATH
      try {
        expect(await defaultCaptureProbe(root)).toEqual({ runnable: false })
      } finally {
        process.env.PATH = hostPath
      }
    })

    // #1228 — the version of the CLI the hook reaches, read from its package without a process.
    it('reads the version of the saasfoundryai-cli package the CLI belongs to, through the bin link', async () => {
      await put('node_modules/saasfoundryai-cli/package.json', JSON.stringify({ name: 'saasfoundryai-cli', version: '1.0.1' }))
      await put('node_modules/saasfoundryai-cli/bin/sf.js', '#!/bin/sh\necho "error: unknown command agents" >&2\nexit 1\n')
      await chmod(join(root, 'node_modules/saasfoundryai-cli/bin/sf.js'), 0o755)
      await mkdir(join(root, 'node_modules/.bin'), { recursive: true })
      await symlink('../saasfoundryai-cli/bin/sf.js', join(root, 'node_modules/.bin/saasfoundryai'))
      expect(await defaultCaptureProbe(root)).toEqual({ runnable: false, cli: `${root}/node_modules/.bin/saasfoundryai`, version: '1.0.1' })
      expect(await captureStanding(root, 'claude-code', async () => ({ runnable: true, cli: 'x', version: '1.0.1' }), '1.2.1')).toEqual({ state: 'missing' })
      await put('.claude/settings.json', JSON.stringify({ hooks: CLAUDE_CAPTURE_HOOKS }))
      expect(await captureStanding(root, 'claude-code', async () => ({ runnable: true, cli: 'x', version: '1.0.1' }), '1.2.1')).toEqual({
        state: 'declared-outdated-cli',
        cli: 'x',
        cliVersion: '1.0.1'
      })
      expect(await captureState(root, 'claude-code', async () => ({ runnable: true, cli: 'x', version: '1.2.1' }), '1.2.1')).toBe('enforced')
    })
  })

  describe('Claude Code settings', () => {
    it('declares the stop of the routed agents and the result of the delegation tool, on one command', () => {
      expect(CLAUDE_CAPTURE_HOOKS.SubagentStop[0]).toMatchObject({ matcher: 'sf-.*', hooks: [{ command: CLAUDE_CAPTURE_COMMAND }] })
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

    it('replaces the bare-sf command an earlier build wrote instead of adding a second hook beside it', async () => {
      const legacy = { type: 'command', command: 'sf agents outcome capture --host claude-code', timeout: 30 }
      await put(
        '.claude/settings.json',
        JSON.stringify({ hooks: { SubagentStop: [{ hooks: [legacy] }], PostToolUse: [{ matcher: 'Agent|Task', hooks: [legacy, { type: 'command', command: 'echo mine' }] }] } })
      )
      expect(await mergeClaudeSettingsHooks(root, CLAUDE_CAPTURE_HOOKS, { supersedes: isLegacyCaptureCommand })).toBe(true)
      const { hooks } = JSON.parse(await get('.claude/settings.json'))
      expect(hooks.SubagentStop).toEqual([{ matcher: 'sf-.*', hooks: [{ type: 'command', command: CLAUDE_CAPTURE_COMMAND, timeout: 30 }] }])
      expect(hooks.PostToolUse.flatMap((group: { hooks: { command: string }[] }) => group.hooks.map((hook) => hook.command))).toEqual(['echo mine', CLAUDE_CAPTURE_COMMAND])
      expect(await mergeClaudeSettingsHooks(root, CLAUDE_CAPTURE_HOOKS, { supersedes: isLegacyCaptureCommand })).toBe(false)
    })

    it('leaves the formatting of a settings file alone when there is nothing to add', async () => {
      const compact = JSON.stringify({ hooks: CLAUDE_CAPTURE_HOOKS })
      await put('.claude/settings.json', compact)
      expect(await mergeClaudeSettingsHooks(root, CLAUDE_CAPTURE_HOOKS)).toBe(false)
      expect(await get('.claude/settings.json')).toBe(compact)
    })

    it('writes the settings whole or not at all: no partial file, no temporary left behind', async () => {
      await put('.claude/settings.json', JSON.stringify({ model: 'opus' }))
      await mergeClaudeSettingsHooks(root, CLAUDE_CAPTURE_HOOKS)
      const entries = await import('fs/promises').then((fs) => fs.readdir(join(root, '.claude')))
      expect(entries).toEqual(['settings.json'])
      expect(JSON.parse(await get('.claude/settings.json')).model).toBe('opus')
    })

    it('reports whether the permissions changed, and takes away the rules an earlier build pre-approved', async () => {
      expect(await mergeClaudeSettingsPermissions(root, ['Bash(sf agents route *)'])).toBe(true)
      expect(await mergeClaudeSettingsPermissions(root, ['Bash(sf agents route *)'])).toBe(false)
      await put('.claude/settings.json', JSON.stringify({ permissions: { allow: ['Bash(sf agents route *)', 'Bash(sf agents outcome record *)', 'Bash(npm test)'] } }))
      expect(await mergeClaudeSettingsPermissions(root, ['Bash(sf agents route *)'], ['Bash(sf agents outcome record *)'])).toBe(true)
      expect(JSON.parse(await get('.claude/settings.json')).permissions.allow).toEqual(['Bash(sf agents route *)', 'Bash(npm test)'])
      expect(await mergeClaudeSettingsPermissions(root, ['Bash(sf agents route *)'], ['Bash(sf agents outcome record *)'])).toBe(false)
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

    it('replaces the bare-sf command an earlier build wrote, keeping the hooks around it', () => {
      const existing = JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: 'sf status --claude-friendly --no-network' }] }],
          UserPromptSubmit: [{ hooks: [{ type: 'command', command: '.claude/skills/sf-srs/scripts/srs-intent-hook.sh' }] }],
          SubagentStop: [{ hooks: [{ type: 'command', command: 'sf agents outcome capture --host codex', timeout: 30 }] }]
        }
      })
      const config = JSON.parse((renderCodexHooks(existing) as { content: string }).content)
      expect(config.hooks.SubagentStop).toEqual([{ hooks: [{ type: 'command', command: CODEX_CAPTURE_COMMAND, timeout: 30 }] }])
      expect(config.hooks.SessionStart).toHaveLength(1)
      expect(config.hooks.UserPromptSubmit).toHaveLength(1)
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
      expect(await captureState(root, 'codex', async () => true)).toBe('declared')
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

    // Codex runs a project hook only once it is trusted, and trust follows the text of the hook (#1105)
    it('tells the developer to trust the replaced hook again, once: a second refresh has nothing to say', async () => {
      await put(CODEX_HOOKS_PATH, await readFile(join(__dirname, '../../fixtures/harness/v1.1.0/codex-hooks.json'), 'utf8'))
      const first = await installAgentInstructions({ targetPath: root, agents: ['codex'] })
      expect(first.warnings).toContain(CODEX_RETRUST_NOTICE)
      expect(JSON.parse(await get(CODEX_HOOKS_PATH)).hooks.SubagentStop).toEqual([{ hooks: [{ type: 'command', command: CODEX_CAPTURE_COMMAND, timeout: 30 }] }])
      const second = await installAgentInstructions({ targetPath: root, agents: ['codex'] })
      expect(second.warnings).not.toContain(CODEX_RETRUST_NOTICE)
      expect(second.written).not.toContain(CODEX_HOOKS_PATH)
    })

    it('does not mention the trust of a hook it only adds', async () => {
      const first = await installAgentInstructions({ targetPath: root, agents: ['codex'] })
      expect(first.written).toContain(CODEX_HOOKS_PATH)
      expect(first.warnings).not.toContain(CODEX_RETRUST_NOTICE)
    })

    // #1106 — the PreToolUse guard goes in the same file as the capture hook, and Codex trusts it the same way
    it('adds the PreToolUse guard hook beside the capture hook, says once that it has to be trusted, and then changes nothing', async () => {
      const first = await installAgentInstructions({ targetPath: root, agents: ['codex'] })
      const config = JSON.parse(await get(CODEX_HOOKS_PATH))
      expect(config.hooks.PreToolUse).toEqual([{ matcher: 'Bash', hooks: [{ type: 'command', command: CODEX_GUARD_COMMAND, timeout: 10 }] }])
      expect(config.hooks.SubagentStop).toHaveLength(1)
      expect(first.warnings).toContain(CODEX_GUARD_TRUST_NOTICE)
      expect(await guardState(root, 'codex', async () => true)).toBe('declared')
      const second = await installAgentInstructions({ targetPath: root, agents: ['codex'], manifest: { fileHashes: first.fileHashes } })
      expect(second.warnings).not.toContain(CODEX_GUARD_TRUST_NOTICE)
      expect(second.written).not.toContain(CODEX_HOOKS_PATH)
    })

    it('adds the guard after the PreToolUse hooks a project wrote, and keeps them', async () => {
      const own = { matcher: 'apply_patch', hooks: [{ type: 'command', command: './check.sh' }] }
      await put(CODEX_HOOKS_PATH, JSON.stringify({ hooks: { PreToolUse: [own] } }))
      await installAgentInstructions({ targetPath: root, agents: ['codex'] })
      const config = JSON.parse(await get(CODEX_HOOKS_PATH))
      expect(config.hooks.PreToolUse).toHaveLength(2)
      expect(config.hooks.PreToolUse[0]).toEqual(own)
      expect(config.hooks.PreToolUse[1].hooks[0].command).toBe(CODEX_GUARD_COMMAND)
    })

    it('is not added for Claude Code alone, which keeps its hooks in .claude/settings.json', async () => {
      await installAgentInstructions({ targetPath: root, agents: ['claude-code'] })
      expect(await readFile(join(root, CODEX_HOOKS_PATH), 'utf8').catch(() => '')).toBe('')
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

  describe('what is enforced (Examine finding 13)', () => {
    const runnable = async () => true
    const notRunnable = async () => false

    it('reads the hook declarations and asks the project CLI whether it can run them', async () => {
      expect(await captureState(root, 'claude-code', runnable)).toBe('missing')
      expect(await captureState(root, 'codex', runnable)).toBe('missing')
      await put('.claude/settings.json', JSON.stringify({ hooks: CLAUDE_CAPTURE_HOOKS }))
      expect(await captureState(root, 'claude-code', runnable)).toBe('enforced')
    })

    it('does not call a declared hook enforced when no CLI can run it', async () => {
      await put('.claude/settings.json', JSON.stringify({ hooks: CLAUDE_CAPTURE_HOOKS }))
      expect(await captureState(root, 'claude-code', notRunnable)).toBe('declared-not-runnable')
      await put(CODEX_HOOKS_PATH, (renderCodexHooks() as { content: string }).content)
      expect(await captureState(root, 'codex', notRunnable)).toBe('declared-not-runnable')
    })

    it('says a Codex hook is declared, not enforced: Codex runs it once its hook is trusted, which nothing here can see', async () => {
      await put(CODEX_HOOKS_PATH, (renderCodexHooks() as { content: string }).content)
      expect(await captureState(root, 'codex', runnable)).toBe('declared')
    })

    it('calls the bare-sf hook an earlier build wrote outdated: a refresh replaces it', async () => {
      await put('.claude/settings.json', JSON.stringify({ hooks: { SubagentStop: [{ hooks: [{ type: 'command', command: 'sf agents outcome capture --host claude-code' }] }] } }))
      expect(await captureState(root, 'claude-code', runnable)).toBe('outdated')
    })

    it('says a host without hooks is not enforced: its delegations are recorded by hand', async () => {
      expect(await captureState(root, 'gemini-cli')).toBe('not-enforced')
      expect(await captureState(root, 'kimi')).toBe('not-enforced')
    })

    it('treats a settings file that cannot be read as missing rather than failing', async () => {
      await put('.claude/settings.json', '{ nope')
      expect(await captureState(root, 'claude-code', runnable)).toBe('missing')
    })
  })
})
