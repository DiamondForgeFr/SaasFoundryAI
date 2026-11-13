import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'

import { CODEX_HOOKS_PATH } from '../../../harness/delegation-hooks'
import { HARNESS_HOOKS, HARNESS_SUPERSEDED_HOOKS, renderHarnessSettings } from '../../../harness/harness-settings'
import {
  CLAUDE_GUARD_COMMAND,
  CLAUDE_GUARD_HOOKS,
  CODEX_GUARD_COMMAND,
  guardCommand,
  guardStanding,
  guardState,
  isLegacyGuardCommand,
  resolveGuardCli,
  V1_2_0_GUARD_COMMANDS,
  withCodexGuard
} from '../../../harness/guard-hook'

// #1106 — the PreToolUse hook that refuses an agent's own bypass of a guard: the line the host runs, how it is
// added to a Codex hooks file, and how `sf status` reads its state.

describe('guardCommand', () => {
  it('is one line for each host, and only the host differs', () => {
    expect(CLAUDE_GUARD_COMMAND).toContain('agents guard --host claude-code')
    expect(CODEX_GUARD_COMMAND).toContain('agents guard --host codex')
    expect(CLAUDE_GUARD_COMMAND.replaceAll('claude-code', '@')).toBe(CODEX_GUARD_COMMAND.replaceAll('codex', '@'))
    expect(guardCommand('codex')).toBe(CODEX_GUARD_COMMAND)
    expect(CLAUDE_GUARD_COMMAND).not.toContain('\n')
  })

  it('leaves before Node starts unless the payload mentions what a refused call needs', () => {
    expect(CLAUDE_GUARD_COMMAND.startsWith('p=$(cat); case "$p" in ')).toBe(true)
    for (const word of ['SF_WORKFLOW_BYPASS_', 'skip-local-ci', 'delegation', 'ready', 'merge', 'addLabels']) expect(CLAUDE_GUARD_COMMAND).toContain(`*${word}*`)
    // the nature label is matched whatever its case
    expect(CLAUDE_GUARD_COMMAND).toContain('*[Nn][Aa][Tt][Uu][Rr][Ee]*')
    expect(CLAUDE_GUARD_COMMAND).toContain('*) exit 0;; esac')
  })

  it('runs the CLI the project resolves, never a bare sf, and always exits 0', () => {
    expect(CLAUDE_GUARD_COMMAND).toContain('"$d/node_modules/.bin/saasfoundryai"')
    expect(CLAUDE_GUARD_COMMAND).toContain('node "$d/bin/sf.js"')
    expect(CLAUDE_GUARD_COMMAND).toContain('[ -f "$d/dist/index.js" ]')
    expect(CLAUDE_GUARD_COMMAND).toContain('command -v saasfoundryai')
    expect(CLAUDE_GUARD_COMMAND).not.toMatch(/(^|[;&|{]\s*)sf\s/)
    expect(CLAUDE_GUARD_COMMAND.endsWith('; exit 0')).toBe(true)
    expect(CLAUDE_GUARD_COMMAND).toContain('2>/dev/null || note "$*" $?; exit 0; }')
  })

  // #1228 — a CLI that has no `agents guard` (an older global install) used to leave the guard open without a word.
  it('notes a CLI that cannot run the command, in the capture error log, stage cli, for its own host', () => {
    expect(CLAUDE_GUARD_COMMAND).toContain('note() { ')
    expect(CLAUDE_GUARD_COMMAND).toContain('"host":"claude-code","event":"PreToolUse","stage":"cli"')
    expect(CODEX_GUARD_COMMAND).toContain('"host":"codex","event":"PreToolUse","stage":"cli"')
    expect(CLAUDE_GUARD_COMMAND).toContain('saasfoundry/capture-errors.jsonl')
    expect(CLAUDE_GUARD_COMMAND).not.toContain('@HOST@')
  })
})

describe('the guard commands v1.2.0 shipped', () => {
  const V120 = join(__dirname, '../../fixtures/harness/v1.2.0')
  const commands = (config: { hooks: Record<string, { hooks: { command: string }[] }[]> }, event: string) => config.hooks[event].flatMap((group) => group.hooks.map((hook) => hook.command))

  it('are the golden bytes of the tag, and are not today command', async () => {
    const claude = JSON.parse(await readFile(join(V120, 'claude-settings.json'), 'utf8'))
    const codex = JSON.parse(await readFile(join(V120, 'codex-hooks.json'), 'utf8'))
    expect(commands(claude, 'PreToolUse')).toEqual([V1_2_0_GUARD_COMMANDS[0]])
    expect(commands(codex, 'PreToolUse')).toEqual([V1_2_0_GUARD_COMMANDS[1]])
    expect(V1_2_0_GUARD_COMMANDS).not.toContain(CLAUDE_GUARD_COMMAND)
    expect(V1_2_0_GUARD_COMMANDS).not.toContain(CODEX_GUARD_COMMAND)
  })

  it('are legacy commands a merge replaces, and a hand-edited copy or today command is not', () => {
    for (const command of V1_2_0_GUARD_COMMANDS) {
      expect(isLegacyGuardCommand(command)).toBe(true)
      expect(HARNESS_SUPERSEDED_HOOKS.supersedes(command)).toBe(true)
      expect(isLegacyGuardCommand(`${command} # mine`)).toBe(false)
    }
    expect(isLegacyGuardCommand(CLAUDE_GUARD_COMMAND)).toBe(false)
    expect(isLegacyGuardCommand(CODEX_GUARD_COMMAND)).toBe(false)
  })

  it('is replaced in a Claude settings file, never kept next to the new one', () => {
    const rendered = renderHarnessSettings(JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: V1_2_0_GUARD_COMMANDS[0], timeout: 10 }] }] } }))
    if ('error' in rendered) throw new Error(rendered.error)
    expect(commands(JSON.parse(rendered.content), 'PreToolUse')).toEqual([CLAUDE_GUARD_COMMAND])
  })

  it('is replaced in a Codex hooks file, which has to be trusted again', () => {
    const result = withCodexGuard(JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: V1_2_0_GUARD_COMMANDS[1], timeout: 10 }] }] } }))
    if ('error' in result) throw new Error(result.error)
    expect(result.added).toBe(true)
    expect(commands(JSON.parse(result.content), 'PreToolUse')).toEqual([CODEX_GUARD_COMMAND])
  })
})

describe('the Claude Code hook', () => {
  it('is a PreToolUse group on the Bash and PowerShell tools with a 10 second timeout, part of the harness hooks', () => {
    expect(CLAUDE_GUARD_HOOKS).toEqual({ PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: CLAUDE_GUARD_COMMAND, timeout: 10 }] }] })
    expect(HARNESS_HOOKS.PreToolUse).toEqual(CLAUDE_GUARD_HOOKS.PreToolUse)
  })
})

describe('withCodexGuard', () => {
  const parse = (text: string) => JSON.parse(text) as { hooks: Record<string, { matcher?: string; hooks: { command: string; timeout?: number }[] }[]>; [key: string]: unknown }
  const added = (text: string) => {
    const result = withCodexGuard(text)
    if ('error' in result) throw new Error(result.error)
    return result
  }

  it('adds a PreToolUse group on the Bash tool to a file with no hooks', () => {
    const result = added('{}')
    expect(result.added).toBe(true)
    expect(parse(result.content).hooks.PreToolUse).toEqual([{ matcher: 'Bash', hooks: [{ type: 'command', command: CODEX_GUARD_COMMAND, timeout: 10 }] }])
    expect(result.content.endsWith('\n')).toBe(true)
  })

  it('keeps the other hooks, the other keys and the own PreToolUse hooks of the project', () => {
    const own = {
      model: 'gpt',
      hooks: { SubagentStop: [{ hooks: [{ type: 'command', command: './a.sh' }] }], PreToolUse: [{ matcher: 'apply_patch', hooks: [{ type: 'command', command: './b.sh' }] }] }
    }

    const result = parse(added(JSON.stringify(own)).content)

    expect(result.model).toBe('gpt')
    expect(result.hooks.SubagentStop).toEqual(own.hooks.SubagentStop)
    expect(result.hooks.PreToolUse[0]).toEqual(own.hooks.PreToolUse[0])
    expect(result.hooks.PreToolUse.map((group) => group.hooks[0].command)).toEqual(['./b.sh', CODEX_GUARD_COMMAND])
  })

  it('is idempotent: a file that has the hook is returned as it is', () => {
    const once = added('{"hooks":{}}')
    const twice = added(once.content)
    expect(twice.added).toBe(false)
    expect(twice.content).toBe(once.content)
  })

  it('reports a file it cannot read as a hooks object, and does not rewrite it', () => {
    expect(withCodexGuard('not json')).toEqual({ error: `${CODEX_HOOKS_PATH} is not valid JSON` })
    expect(withCodexGuard('[]')).toEqual({ error: `${CODEX_HOOKS_PATH} is not a hooks object` })
    expect(withCodexGuard('{"hooks":[]}')).toEqual({ error: `${CODEX_HOOKS_PATH} is not a hooks object` })
  })
})

describe('guardState', () => {
  let root: string
  const yes = async () => true
  const no = async () => false
  const claudeSettings = (config: object) => writeFile(join(root, '.claude', 'settings.json'), JSON.stringify(config))
  const codexHooks = (config: object) => writeFile(join(root, CODEX_HOOKS_PATH), JSON.stringify(config))
  const withGuard = (command: string) => ({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command }] }] } })

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-guard-state-'))
    await mkdir(join(root, '.claude'), { recursive: true })
    await mkdir(join(root, '.codex'), { recursive: true })
  })
  afterEach(async () => rm(root, { recursive: true, force: true }))

  it('is enforced for Claude Code when the hook is declared and the project CLI has the command', async () => {
    await claudeSettings(withGuard(CLAUDE_GUARD_COMMAND))
    expect(await guardState(root, 'claude-code', yes)).toBe('enforced')
  })

  it('is declared-not-runnable when no CLI can run it', async () => {
    await claudeSettings(withGuard(CLAUDE_GUARD_COMMAND))
    expect(await guardState(root, 'claude-code', no)).toBe('declared-not-runnable')
  })

  it('is missing without the hook: no file, another hook, or the hook of the other host', async () => {
    expect(await guardState(root, 'claude-code', yes)).toBe('missing')
    await claudeSettings(withGuard('./mine.sh'))
    expect(await guardState(root, 'claude-code', yes)).toBe('missing')
    await claudeSettings(withGuard(CODEX_GUARD_COMMAND))
    expect(await guardState(root, 'claude-code', yes)).toBe('missing')
  })

  it('is declared for Codex, which runs a project hook only once it is trusted, and never enforced', async () => {
    await codexHooks(withGuard(CODEX_GUARD_COMMAND))
    expect(await guardState(root, 'codex', yes)).toBe('declared')
    expect(await guardState(root, 'codex', no)).toBe('declared-not-runnable')
    await codexHooks({ hooks: {} })
    expect(await guardState(root, 'codex', yes)).toBe('missing')
  })

  it('is not-enforced for an agent that has no guard hook', async () => {
    expect(await guardState(root, 'cursor' as never, yes)).toBe('not-enforced')
  })

  // #1228 — the CLI the hook reaches is named, and one older than the project is not taken for a working guard.
  describe('with the CLI the hook reaches', () => {
    const old = async () => ({ runnable: true, cli: '/usr/local/bin/saasfoundryai', version: '1.2.0' })
    const ancient = async () => ({ runnable: false, cli: '/usr/local/bin/saasfoundryai', version: '1.0.1' })

    it('is declared-outdated-cli when the CLI has the command but is older than the version that last updated the project', async () => {
      await claudeSettings(withGuard(CLAUDE_GUARD_COMMAND))
      expect(await guardStanding(root, 'claude-code', old, '1.2.1')).toEqual({ state: 'declared-outdated-cli', cli: '/usr/local/bin/saasfoundryai', cliVersion: '1.2.0' })
      expect(await guardState(root, 'claude-code', old, '1.2.0')).toBe('enforced')
      expect(await guardState(root, 'claude-code', old)).toBe('enforced')
    })

    it('is declared-not-runnable, with the CLI it reaches, when that CLI has no agents guard', async () => {
      await claudeSettings(withGuard(CLAUDE_GUARD_COMMAND))
      expect(await guardStanding(root, 'claude-code', ancient, '1.2.1')).toEqual({ state: 'declared-not-runnable', cli: '/usr/local/bin/saasfoundryai', cliVersion: '1.0.1' })
    })

    it('is outdated for the v1.2.0 hook, unless the CLI it reaches cannot run it', async () => {
      await claudeSettings(withGuard(V1_2_0_GUARD_COMMANDS[0]))
      expect(await guardState(root, 'claude-code', yes)).toBe('outdated')
      expect(await guardState(root, 'claude-code', ancient)).toBe('declared-not-runnable')
    })
  })
})

describe('resolveGuardCli', () => {
  let root: string
  let bin: string
  let npx: string
  const script = async (dir: string) => {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'saasfoundryai'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-guard-cli-'))
    bin = join(root, 'global-bin')
    npx = join(root, '.npm', '_npx', 'abc123', 'node_modules', '.bin')
    await script(bin)
    await script(npx)
  })
  afterEach(async () => rm(root, { recursive: true, force: true }))

  // `npx saasfoundryai-cli@1.2.0 status` puts its own copy first on the PATH: the hook's shell does not have it.
  it('skips the PATH entries a package runner added for its own process, and finds the one the hook would run', async () => {
    const project = join(root, 'project')
    await mkdir(project)
    expect(await resolveGuardCli(project, [npx, bin].join(delimiter))).toEqual({ command: join(bin, 'saasfoundryai'), args: [] })
    expect(await resolveGuardCli(project, npx)).toBeUndefined()
  })

  it('prefers the project dependency to the PATH, as the hook does', async () => {
    const project = join(root, 'project')
    await script(join(project, 'node_modules', '.bin'))
    expect(await resolveGuardCli(project, bin)).toEqual({ command: join(project, 'node_modules', '.bin', 'saasfoundryai'), args: [] })
  })
})
