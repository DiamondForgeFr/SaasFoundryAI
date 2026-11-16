import { execFileSync, spawnSync } from 'child_process'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const ROOT = resolve(__dirname, '../../..')
// A commit hook exports GIT_* variables: a fixture repository must never inherit them.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))

// #1106 — the command the PreToolUse hook of a host runs: the tool event on stdin, the deny decision on stdout,
// nothing to allow, and an exit code of 0 whatever happens.
describe('compiled sf agents guard', () => {
  let project: string
  const git = (...args: string[]) => execFileSync('git', args, { cwd: project, env: cleanEnv, stdio: 'pipe' })
  const guard = (host: string, input: string) => spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', 'guard', '--host', host], { cwd: project, encoding: 'utf8', env: cleanEnv, input })
  const event = (command: unknown, extra: Record<string, unknown> = {}, toolName = 'Bash') =>
    JSON.stringify({ session_id: 's1', hook_event_name: 'PreToolUse', cwd: project, tool_name: toolName, tool_input: { command }, tool_use_id: 'toolu_1', ...extra })

  beforeEach(async () => {
    project = await realpath(await mkdtemp(join(tmpdir(), 'sf-agents-guard-')))
    git('init', '-q', '-b', 'main')
  })
  afterEach(async () => rm(project, { recursive: true, force: true }))

  it('prints the deny decision of Claude Code for a bypass variable, and exits 0', () => {
    const result = guard('claude-code', event('SF_WORKFLOW_BYPASS_COMPLEXITY_GUARD=1 echo hi'))

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    const decision = JSON.parse(result.stdout)
    expect(decision).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: expect.stringContaining('Refused by the SaaSFoundry guard hook') }
    })
    expect(decision.hookSpecificOutput.permissionDecisionReason).toContain('SF_WORKFLOW_BYPASS_COMPLEXITY_GUARD')
    expect(result.stdout.trim().split('\n')).toHaveLength(1)
  })

  it('prints the same shape for Codex', () => {
    const result = guard('codex', event('SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog'))

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' })
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason).toContain('their own terminal')

    const label = guard('codex', event('gh issue edit 1 --add-label nature:internal'))
    expect(JSON.parse(label.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
  })

  it.each([
    ['claude-code', 'npm test'],
    ['claude-code', 'grep -rn SF_WORKFLOW_BYPASS_PUSHED_GUARD src'],
    ['claude-code', 'gh pr merge 12'],
    ['codex', 'ls -la']
  ])('prints nothing for an ordinary call, or one only a delegated agent may not make (%s: %s)', (host, command) => {
    const result = guard(host, event(command))

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  it('refuses a merge when the event carries an agent id, and when it runs in a worktree of an agent', () => {
    for (const extra of [{ agent_id: 'agent-a1', agent_type: 'sf-build' }, { cwd: join(project, '.claude', 'worktrees', 'agent-a1') }]) {
      const result = guard('claude-code', event('gh pr merge 12', extra))
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason).toContain('a delegated agent never merges')
    }
  })

  it('reads the argument vector of a shell tool, and the cmd of an exec_command', () => {
    const vector = guard('codex', event(['bash', '-lc', 'SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog'], {}, 'Bash'))
    expect(JSON.parse(vector.stdout).hookSpecificOutput.permissionDecision).toBe('deny')

    const exec = guard('codex', JSON.stringify({ hook_event_name: 'PreToolUse', cwd: project, tool_name: 'exec_command', tool_input: { cmd: 'SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog' } }))
    expect(JSON.parse(exec.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
  })

  // #1251 — a line that is not one plain command is refused, with the split to make
  describe('the shape of the line', () => {
    it('refuses a chain on Claude Code, and names the commands to run one by one', () => {
      const result = guard('claude-code', event('cd apps/site && npm install'))

      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason as string
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
      expect(reason).toContain('chains commands with &&')
      expect(reason).toContain('1. `cd apps/site` 2. `npm install`')
    })

    it.each([
      ['a substitution', 'kill $(lsof -tiTCP:4325 -sTCP:LISTEN)', 'command substitution'],
      ['a loop', 'for p in 1 2; do echo $p; done', 'loop'],
      ['an inline script', 'python3 -c "print(1)"', 'inline script']
    ])('refuses %s on Codex', (_name, command, said) => {
      const result = guard('codex', event(command))

      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason).toContain(said)
    })

    it('leaves a PowerShell line, a plain pipe and a quoted ; alone', () => {
      expect(guard('claude-code', event('a; b && c', {}, 'PowerShell')).stdout).toBe('')
      expect(guard('claude-code', event('npm test 2>&1 | tail -20')).stdout).toBe('')
      expect(guard('claude-code', event('git commit -m "a; b && c"')).stdout).toBe('')
    })

    it('reads the line of a Codex argument vector `bash -lc`, not the wrapper', () => {
      expect(guard('codex', event(['bash', '-lc', 'ls -la'])).stdout).toBe('')
      expect(guard('codex', event(['bash', '-lc', 'git commit -m "a; b"'])).stdout).toBe('')
      const chained = guard('codex', event(['bash', '-lc', 'cd x && ls']))
      expect(JSON.parse(chained.stdout).hookSpecificOutput.permissionDecisionReason).toContain('chains commands with &&')
      // any other vector is a command, each word quoted: a word with a ; in it is not a chain
      expect(guard('codex', event(['git', 'commit', '-m', 'a; b && c'])).stdout).toBe('')
    })

    it('leaves a commit message written through a quoted heredoc to Claude Code, which does not ask about it', () => {
      const message = 'git commit -m "$(cat <<\'EOF\'\nfix(#1): x\nEOF\n)"'
      expect(guard('claude-code', event(message)).stdout).toBe('')
      expect(JSON.parse(guard('codex', event(message)).stdout).hookSpecificOutput.permissionDecisionReason).toContain('git commit -F <file>')
    })
  })

  it.each([
    ['a file edit', () => event('SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog', {}, 'Edit')],
    ['a tool event without a command', () => JSON.stringify({ hook_event_name: 'PreToolUse', cwd: project, tool_name: 'Bash', tool_input: {} })],
    ['an event without a tool', () => JSON.stringify({ hook_event_name: 'SessionStart', cwd: project })]
  ])('has no objection to %s', (_name, input) => {
    const result = guard('claude-code', input())

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })

  describe('a payload it cannot read', () => {
    const errorLog = () => join(project, '.git', 'saasfoundry', 'capture-errors.jsonl')

    it('lets the call through with an exit code of 0, and leaves a line in the capture error log', async () => {
      const result = guard('claude-code', 'this is not json, SF_WORKFLOW_BYPASS_NATURE_GUARD=1 secret')

      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('sf agents guard: the call was let through')
      expect(result.stderr).not.toContain('secret')
      const [line] = (await readFile(errorLog(), 'utf8')).trim().split('\n')
      expect(JSON.parse(line)).toMatchObject({ host: 'claude-code', event: 'PreToolUse', stage: 'payload', message: expect.stringContaining('not valid JSON') })
      expect(line).not.toContain('secret')
    })

    it('lets a payload that is not an object through', () => {
      const result = guard('codex', '"just a string"')

      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
    })

    it('lets a payload larger than 1 MiB through', () => {
      const result = guard('claude-code', event(`echo ${'x'.repeat(1024 * 1024 + 1)}`))

      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('larger than 1 MiB')
    })

    it('lets an empty payload through', async () => {
      const result = guard('claude-code', '')

      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
      await expect(readFile(errorLog(), 'utf8')).resolves.toContain('not valid JSON')
    })
  })

  // #1251 — the hook runs this on every call whose payload might need a check: it has its own entry, which loads only the guard
  describe('the dedicated entry', () => {
    /** The files Node loaded while `bin/sf.js` ran with these arguments, recorded by a preloaded script when the process exits. */
    const loaded = async (args: string[], input: string): Promise<{ files: string[]; stdout: string; status: number | null }> => {
      const out = join(project, 'loaded.json')
      const recorder = join(project, 'record-loaded.js')
      await writeFile(recorder, `process.on('exit', () => require('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(Object.keys(require.cache))))\n`)
      const result = spawnSync(process.execPath, ['-r', recorder, join(ROOT, 'bin/sf.js'), ...args], { cwd: project, encoding: 'utf8', env: cleanEnv, input })
      return { files: JSON.parse(await readFile(out, 'utf8')) as string[], stdout: result.stdout, status: result.status }
    }
    const matches = (files: string[], pattern: RegExp): string[] => files.filter((file) => pattern.test(file.replace(/\\/g, '/')))

    it('answers `agents guard --host <host>` without loading commander, any other command or the ledger', async () => {
      const { files, stdout, status } = await loaded(['agents', 'guard', '--host', 'claude-code'], event('cd apps/site && npm install'))

      expect(status).toBe(0)
      expect(JSON.parse(stdout).hookSpecificOutput.permissionDecision).toBe('deny')
      expect(matches(files, /\/dist\/commands\/agents\.guard-main\.js$/)).toHaveLength(1)
      expect(matches(files, /\/node_modules\/commander\//)).toEqual([])
      expect(matches(files, /\/dist\/(index|commands\/(update|new|status|workflow|agents|srs|docs))\.js$/)).toEqual([])
      expect(matches(files, /\/dist\/harness\/(delegation-ledger|capture-errors|agent-support|agent-instructions)\.js$/)).toEqual([])
    })

    it('does the same for Codex, and for a call it has nothing to say about', async () => {
      const codex = await loaded(['agents', 'guard', '--host', 'codex'], event('npm test'))
      expect(codex.status).toBe(0)
      expect(codex.stdout).toBe('')
      expect(matches(codex.files, /\/node_modules\/commander\//)).toEqual([])
    })

    it('loads the ledger only when a call goes wrong, to write the capture error log', async () => {
      const { files, status } = await loaded(['agents', 'guard', '--host', 'claude-code'], 'not json')
      expect(status).toBe(0)
      expect(matches(files, /\/dist\/harness\/capture-errors\.js$/)).toHaveLength(1)
      expect(matches(files, /\/node_modules\/commander\//)).toEqual([])
    })

    it('is the full CLI for every other form: the help, a host it does not know, a missing host', async () => {
      for (const args of [
        ['agents', 'guard', '--help'],
        ['agents', 'guard', '--host', 'nobody'],
        ['agents', 'guard']
      ]) {
        const { files } = await loaded(args, '')
        expect(matches(files, /\/node_modules\/commander\//).length).toBeGreaterThan(0)
      }
    })

    it('is several times faster than the full CLI answering the same call', () => {
      const best = (script: string): number => {
        const times: number[] = []
        for (let i = 0; i < 3; i++) {
          const start = process.hrtime.bigint()
          spawnSync(process.execPath, [script, 'agents', 'guard', '--host', 'claude-code'], { cwd: project, encoding: 'utf8', env: cleanEnv, input: event('cd apps/site && npm install') })
          times.push(Number(process.hrtime.bigint() - start) / 1e6)
        }
        return Math.min(...times)
      }
      expect(best(join(ROOT, 'bin/sf.js'))).toBeLessThan(best(join(ROOT, 'dist/index.js')) / 2)
    })
  })

  it('exits 0 with a message for a host it does not know, and lists --host in its help', () => {
    const unknown = guard('nobody', event('gh pr merge 1', { agent_id: 'a' }))
    expect(unknown.status).toBe(0)
    expect(unknown.stdout).toBe('')
    expect(unknown.stderr).toContain('--host must be claude-code or codex')

    const help = spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', 'guard', '--help'], { cwd: project, encoding: 'utf8', env: cleanEnv })
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('--host')
  })
})
