import { spawn } from 'child_process'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

import { GENERATED_REGION_END, GENERATED_REGION_START, installAgentInstructions } from '../../../harness/agent-instructions'
import { CODEX_HOOKS_PATH } from '../../../harness/delegation-hooks'
import { isLegacySessionStartCommand, SESSION_START_COMMAND, SESSION_START_HOOKS, withCodexSessionStart } from '../../../harness/session-start-hook'

const SYSTEM_PATH = '/usr/bin:/bin'
const STATUS_ARGS = 'status --agent-friendly --no-network'

describe('the session-start hook (#1103)', () => {
  let root: string
  const put = async (path: string, content: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
  /** A program that says how it was called and with which environment, then exits with `code`. */
  const program = async (path: string, label: string, code = 0) => {
    await put(path, `#!/bin/sh\nprintf '%s\\n' "${label} $* [no-warn=$SF_SKILL_NO_WARN]"\nexit ${code}\n`)
    await chmod(join(root, path), 0o755)
  }
  /** The PATH the host gives the hook: node, the system tools, and whatever the test puts in `pathbin`. */
  const PATHBIN = () => join(root, 'pathbin')

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'sf-session-start-')))
    await mkdir(PATHBIN())
    await symlink(process.execPath, join(PATHBIN(), 'node'))
  })
  afterEach(async () => rm(root, { recursive: true, force: true }))

  /** Run the hook command the way a host does: through a shell, in a directory, with the environment it gives. */
  const runHook = (env: Record<string, string> = {}, cwd = root) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn('sh', ['-c', SESSION_START_COMMAND], { cwd, env: { PATH: `${PATHBIN()}:${SYSTEM_PATH}`, ...env } })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += chunk))
      child.stderr.on('data', (chunk) => (stderr += chunk))
      child.on('error', reject)
      child.on('close', (code) => resolve({ code, stdout, stderr }))
      child.stdin.end()
    })
  const lines = (stdout: string) => stdout.trim().split('\n').filter(Boolean)

  /** The layout of the SaaSFoundryAI CLI's own repository, with a `bin/sf.js` that reports how it was called. */
  const cliRepository = async (built = true) => {
    await put('package.json', '{\n  "name": "saasfoundryai-cli"\n}\n')
    await put('bin/sf.js', "console.log('sf.js ' + process.argv.slice(2).join(' '))\n")
    if (built) await put('dist/index.js', '\n')
  }

  describe('the command', () => {
    it('is one self-contained shell line that never runs a bare sf', () => {
      expect(SESSION_START_COMMAND).not.toContain('\n')
      expect(SESSION_START_COMMAND).not.toMatch(/(^|[;|&{]\s*)"?sf"? status/)
      // Neither the project's .bin/sf (it may be the Salesforce CLI) nor the PATH's sf is a candidate
      expect(SESSION_START_COMMAND).not.toMatch(/\.bin\/sf\b/)
      expect(SESSION_START_COMMAND).not.toMatch(/command -v sf\b/)
      expect(isLegacySessionStartCommand(SESSION_START_COMMAND)).toBe(false)
    })

    it('is declared for SessionStart with no matcher, so it runs on startup, resume, clear and compact, and a timeout', () => {
      expect(SESSION_START_HOOKS).toEqual({ SessionStart: [{ hooks: [{ type: 'command', command: SESSION_START_COMMAND, timeout: 30 }] }] })
    })
  })

  describe('which CLI it runs', () => {
    it('runs the saasfoundryai the project installed, with the agent-friendly flag, offline, and the stale-skill advisory silenced', async () => {
      await program('node_modules/.bin/saasfoundryai', 'local')
      expect(await runHook()).toEqual({ code: 0, stdout: `local ${STATUS_ARGS} [no-warn=1]\n`, stderr: '' })
    })

    it('prefers it to this repository, to the PATH, and to a bin/sf of the project', async () => {
      await program('node_modules/.bin/saasfoundryai', 'local')
      await program('node_modules/.bin/sf', 'salesforce')
      await program('pathbin/saasfoundryai', 'path')
      await program('pathbin/sf', 'path-sf')
      await cliRepository()
      expect(lines((await runHook()).stdout)).toEqual([`local ${STATUS_ARGS} [no-warn=1]`])
    })

    it('runs the build of this repository when the project is SaaSFoundryAI itself', async () => {
      await cliRepository()
      await program('pathbin/saasfoundryai', 'path')
      expect(await runHook()).toEqual({ code: 0, stdout: `sf.js ${STATUS_ARGS}\n`, stderr: '' })
    })

    it('does not run a bin/sf.js that belongs to another project', async () => {
      await cliRepository()
      await put('package.json', '{\n  "name": "something-else"\n}\n')
      await program('pathbin/saasfoundryai', 'path')
      expect(lines((await runHook()).stdout)).toEqual([`path ${STATUS_ARGS} [no-warn=1]`])
    })

    it('falls back to saasfoundryai on the PATH, and says what it did, when this repository is not built', async () => {
      await cliRepository(false)
      await program('pathbin/saasfoundryai', 'path')
      expect(lines((await runHook()).stdout)).toEqual(['- cli: bin/sf.js is not built (run npm run build); trying saasfoundryai on the PATH', `path ${STATUS_ARGS} [no-warn=1]`])
    })

    it('says both facts when this repository is not built and no other CLI exists', async () => {
      await cliRepository(false)
      const result = await runHook()
      expect(result.code).toBe(0)
      expect(lines(result.stdout)).toEqual([
        '- cli: bin/sf.js is not built (run npm run build); trying saasfoundryai on the PATH',
        '- cli: no SaaSFoundryAI CLI found (looked for node_modules/.bin/saasfoundryai, bin/sf.js and saasfoundryai on the PATH)'
      ])
    })

    it('runs saasfoundryai from the PATH in a project that installed none', async () => {
      await program('pathbin/saasfoundryai', 'path')
      expect(lines((await runHook()).stdout)).toEqual([`path ${STATUS_ARGS} [no-warn=1]`])
    })

    it('never runs a bare sf: another CLI by that name (Salesforce) is not the SaaSFoundry one', async () => {
      await program('pathbin/sf', 'salesforce')
      await program('node_modules/.bin/sf', 'salesforce-local')
      const result = await runHook()
      expect(result.stdout).not.toContain('salesforce')
      expect(lines(result.stdout)).toEqual(['- cli: no SaaSFoundryAI CLI found (looked for node_modules/.bin/saasfoundryai, bin/sf.js and saasfoundryai on the PATH)'])
    })
  })

  describe('what it prints, and its exit code', () => {
    it('prints what the CLI printed and nothing of its own', async () => {
      await put('node_modules/.bin/saasfoundryai', '#!/bin/sh\necho "# SaaSFoundryAI project status"\necho "- delegation: allowed (shared, 2026-10-19)"\n')
      await chmod(join(root, 'node_modules/.bin/saasfoundryai'), 0o755)
      expect(await runHook()).toEqual({ code: 0, stdout: '# SaaSFoundryAI project status\n- delegation: allowed (shared, 2026-10-19)\n', stderr: '' })
    })

    it('names the exit code of a CLI that fails, and still exits 0', async () => {
      await program('node_modules/.bin/saasfoundryai', 'broken', 3)
      const result = await runHook()
      expect(result.code).toBe(0)
      expect(lines(result.stdout)).toEqual([`broken ${STATUS_ARGS} [no-warn=1]`, '- status: node_modules/.bin/saasfoundryai exited 3'])
    })

    it('names the build it ran when that fails', async () => {
      await cliRepository()
      await put('bin/sf.js', 'process.exit(5)\n')
      const result = await runHook()
      expect(result.code).toBe(0)
      expect(lines(result.stdout)).toEqual(['- status: node bin/sf.js exited 5'])
    })

    it('says so, and exits 0, when no CLI can be found', async () => {
      expect(await runHook()).toEqual({
        code: 0,
        stdout: '- cli: no SaaSFoundryAI CLI found (looked for node_modules/.bin/saasfoundryai, bin/sf.js and saasfoundryai on the PATH)\n',
        stderr: ''
      })
    })

    it('never instructs: every line it adds starts with "- cli:" or "- status:"', async () => {
      await cliRepository(false)
      for (const line of lines((await runHook()).stdout)) expect(line).toMatch(/^- (cli|status): /)
    })
  })

  describe('where it runs', () => {
    it('finds the project from CLAUDE_PROJECT_DIR when the host runs the hook from another directory', async () => {
      await program('node_modules/.bin/saasfoundryai', 'local')
      const elsewhere = join(root, 'elsewhere')
      await mkdir(elsewhere)
      const result = await runHook({ CLAUDE_PROJECT_DIR: root }, elsewhere)
      expect(result).toEqual({ code: 0, stdout: `local ${STATUS_ARGS} [no-warn=1]\n`, stderr: '' })
    })

    it('runs the CLI from the project directory, where sf status reads the manifest', async () => {
      await put('node_modules/.bin/saasfoundryai', '#!/bin/sh\npwd -P\n')
      await chmod(join(root, 'node_modules/.bin/saasfoundryai'), 0o755)
      const elsewhere = join(root, 'elsewhere')
      await mkdir(elsewhere)
      expect(lines((await runHook({ CLAUDE_PROJECT_DIR: root }, elsewhere)).stdout)).toEqual([root])
    })

    it('uses the current directory when the host sets no project directory (Codex)', async () => {
      await program('node_modules/.bin/saasfoundryai', 'local')
      expect(lines((await runHook()).stdout)).toEqual([`local ${STATUS_ARGS} [no-warn=1]`])
    })

    it('says so, and exits 0, when the project directory cannot be entered', async () => {
      const result = await runHook({ CLAUDE_PROJECT_DIR: join(root, 'missing') })
      expect(result.code).toBe(0)
      expect(lines(result.stdout)).toEqual([`- cli: cannot enter the project directory ${join(root, 'missing')}`])
    })
  })
})

describe('the bare sf status command an earlier release wrote (#1103)', () => {
  it('is recognised with either spelling of the flag, and nothing else', () => {
    expect(isLegacySessionStartCommand('sf status --claude-friendly --no-network')).toBe(true)
    expect(isLegacySessionStartCommand('sf status --agent-friendly --no-network')).toBe(true)
    for (const other of [
      'sf status --claude-friendly',
      'sf status --no-network',
      'sf status --claude-friendly --no-network --check-gh',
      'echo sf status --claude-friendly --no-network',
      'saasfoundryai status --agent-friendly --no-network',
      SESSION_START_COMMAND,
      undefined,
      3
    ]) {
      expect(isLegacySessionStartCommand(other)).toBe(false)
    }
  })
})

// The Codex deposit: `.codex/hooks.json` is the project's file, so the planner only replaces the bare command.
describe('the Codex deposit (#1103)', () => {
  let root: string
  const get = (path: string) => readFile(join(root, path), 'utf8')
  const hooksOf = async () => JSON.parse(await get(CODEX_HOOKS_PATH)).hooks as Record<string, { hooks: { command: string; timeout?: number }[] }[]>
  const install = (fileHashes?: Record<string, string>) => installAgentInstructions({ targetPath: root, agents: ['codex'], ...(fileHashes ? { manifest: { fileHashes } } : {}) })

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'sf-session-start-codex-')))
    await writeFile(join(root, 'AGENTS.md'), `# Project\n\n${GENERATED_REGION_START}\n${GENERATED_REGION_END}\n`)
  })
  afterEach(async () => rm(root, { recursive: true, force: true }))

  it('replaces the bare sf status command a project wired by hand, keeping its other hooks', async () => {
    await mkdir(join(root, '.codex'))
    await writeFile(
      join(root, CODEX_HOOKS_PATH),
      JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'sf status --claude-friendly --no-network' }] }], UserPromptSubmit: [{ hooks: [{ type: 'command', command: './mine.sh' }] }] }
      })
    )

    const result = await install()

    expect(result.conflicts).toEqual([])
    const hooks = await hooksOf()
    expect(hooks.SessionStart).toEqual([{ hooks: [{ type: 'command', command: SESSION_START_COMMAND, timeout: 30 }] }])
    expect(hooks.UserPromptSubmit).toHaveLength(1)
    expect(hooks.SubagentStop).toHaveLength(1)
    // A second install changes nothing
    const second = await install(result.fileHashes)
    expect(second.written).not.toContain(CODEX_HOOKS_PATH)
    expect(second.unchanged).toContain(CODEX_HOOKS_PATH)
  })

  it('adds no session-start hook to a file that has none, and writes none to a new file', async () => {
    await install()
    expect((await hooksOf()).SessionStart).toBeUndefined()

    await writeFile(join(root, CODEX_HOOKS_PATH), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'sf status --agent-friendly' }] }] } }))
    await install()
    expect((await hooksOf()).SessionStart).toEqual([{ hooks: [{ type: 'command', command: 'sf status --agent-friendly' }] }])
  })
})

describe('withCodexSessionStart (#1103)', () => {
  const legacy = (extra: object = {}) => JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'sf status --claude-friendly --no-network' }] }], ...extra } }, null, 2)
  const parse = (result: { content: string } | { error: string }) => {
    if ('error' in result) throw new Error(result.error)
    return JSON.parse(result.content) as { hooks: Record<string, { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] }[]> }
  }

  it('replaces the bare command with the resolved one, in place', () => {
    const config = parse(withCodexSessionStart(legacy()))
    expect(config.hooks.SessionStart).toEqual([{ hooks: [{ type: 'command', command: SESSION_START_COMMAND, timeout: 30 }] }])
  })

  it('keeps the other hooks of the file, the other hooks of the same group, and their order', () => {
    const content = JSON.stringify({
      other: true,
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: 'command', command: 'echo before' },
              { type: 'command', command: 'sf status --agent-friendly --no-network' },
              { type: 'command', command: 'echo after' }
            ]
          }
        ],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: '.claude/skills/sf-srs/scripts/srs-intent-hook.sh' }] }]
      }
    })
    const config = parse(withCodexSessionStart(content))
    expect(config.hooks.SessionStart[0].hooks.map((hook) => hook.command)).toEqual(['echo before', SESSION_START_COMMAND, 'echo after'])
    expect(config.hooks.UserPromptSubmit).toEqual([{ hooks: [{ type: 'command', command: '.claude/skills/sf-srs/scripts/srs-intent-hook.sh' }] }])
    expect(config).toMatchObject({ other: true })
  })

  it('is idempotent: a second render changes nothing', () => {
    const first = withCodexSessionStart(legacy())
    if ('error' in first) throw new Error(first.error)
    expect(withCodexSessionStart(first.content)).toEqual(first)
  })

  it('drops the bare command when the resolved one is already there, and adds it once', () => {
    const both = JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: 'command', command: 'sf status --claude-friendly --no-network' },
              { type: 'command', command: SESSION_START_COMMAND, timeout: 30 }
            ]
          }
        ]
      }
    })
    expect(parse(withCodexSessionStart(both)).hooks.SessionStart[0].hooks.map((hook) => hook.command)).toEqual([SESSION_START_COMMAND])
    const twice = JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'sf status --claude-friendly --no-network' }] }, { hooks: [{ type: 'command', command: 'sf status --agent-friendly --no-network' }] }]
      }
    })
    const groups = parse(withCodexSessionStart(twice)).hooks.SessionStart
    expect(groups.flatMap((group) => group.hooks.map((hook) => hook.command))).toEqual([SESSION_START_COMMAND])
  })

  it('leaves a file without the bare command exactly as it is: the project owns it, and no hook is added', () => {
    for (const content of [
      '{}',
      '{"hooks":{}}',
      JSON.stringify({ hooks: { SubagentStop: [] } }),
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } })
    ]) {
      expect(withCodexSessionStart(content)).toEqual({ content })
    }
  })

  it('reports a file that is not JSON or not a hooks object, and rewrites nothing', () => {
    expect(withCodexSessionStart('{ nope')).toEqual({ error: 'is not valid JSON' })
    expect(withCodexSessionStart('[]')).toEqual({ error: 'is not a hooks object' })
    expect(withCodexSessionStart('"text"')).toEqual({ error: 'is not a hooks object' })
    expect(withCodexSessionStart('{"hooks": []}')).toEqual({ error: 'is not a hooks object' })
  })
})
