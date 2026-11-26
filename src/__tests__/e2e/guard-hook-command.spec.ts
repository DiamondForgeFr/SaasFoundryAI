import { spawnSync } from '../helpers/bounded-child'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const ROOT = resolve(__dirname, '../../..')
// A commit hook exports GIT_* variables: a fixture must never inherit them.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && key !== 'CLAUDE_PROJECT_DIR'))

interface HookGroup {
  matcher?: string
  hooks: { command: string; timeout?: number }[]
}

// #1106 — the exact line this repository's `.claude/settings.json` runs before a Bash call, fed the payloads a host
// sends: it must refuse the listed calls, stay silent on the ordinary ones, and never fail the host.
describe('the PreToolUse guard hook of .claude/settings.json, run through sh -c', () => {
  let command: string
  let worktree: string
  let empty: string

  const payload = (toolCommand: string, cwd: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ session_id: 's1', hook_event_name: 'PreToolUse', cwd, tool_name: 'Bash', tool_input: { command: toolCommand }, tool_use_id: 'toolu_1', ...extra })
  const hook = (input: string, env: NodeJS.ProcessEnv = { CLAUDE_PROJECT_DIR: ROOT }, cwd = ROOT) => spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8', input, env: { ...cleanEnv, ...env } })
  const decision = (stdout: string) => JSON.parse(stdout).hookSpecificOutput as { hookEventName: string; permissionDecision: string; permissionDecisionReason: string }

  beforeAll(async () => {
    const settings = JSON.parse(await readFile(join(ROOT, '.claude', 'settings.json'), 'utf8')) as { hooks: Record<string, HookGroup[]> }
    const groups = settings.hooks.PreToolUse ?? []
    const group = groups.find((entry) => entry.matcher === 'Bash|PowerShell')
    command = group?.hooks[0].command ?? ''
    expect(group?.hooks[0].timeout).toBe(10)
    expect(command).toContain('agents guard --host claude-code')
    worktree = join(await realpath(await mkdtemp(join(tmpdir(), 'sf-guard-hook-'))), '.claude', 'worktrees', 'agent-x')
    empty = await realpath(await mkdtemp(join(tmpdir(), 'sf-guard-hook-empty-')))
  })
  afterAll(async () => {
    await rm(join(worktree, '..', '..', '..'), { recursive: true, force: true })
    await rm(empty, { recursive: true, force: true })
  })

  it.each([
    ['a bypass variable', 'SF_WORKFLOW_BYPASS_COMPLEXITY_GUARD=1 echo hi', 'SF_WORKFLOW_BYPASS_COMPLEXITY_GUARD'],
    ['the skip flag of the local CI', '.claude/skills/sf-workflow/workflow-cli.sh update-status 1 "Human testing" --skip-local-ci x', '--skip-local-ci'],
    ['a nature label', 'gh issue edit 1 --add-label nature:internal', 'nature label'],
    ['a nature label in capitals', 'gh issue edit 1 --add-label NATURE:INTERNAL', 'nature label']
  ])('refuses %s from the repository root', (_name, toolCommand, quoted) => {
    const result = hook(payload(toolCommand, ROOT))

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(decision(result.stdout)).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: expect.stringContaining(quoted) })
  })

  it.each([
    ['gh pr merge 12'],
    ['.claude/skills/sf-workflow/workflow-cli.sh ready-pr 1106'],
    ['sf agents delegation allow'],
    ['.claude/skills/sf-tool-github-projects/github-projects-cli.sh create-ticket task T --nature internal']
  ])('refuses %s in a worktree of an agent, and allows it from a primary checkout', (toolCommand) => {
    const refused = hook(payload(toolCommand, worktree))
    expect(refused.status).toBe(0)
    expect(decision(refused.stdout).permissionDecision).toBe('deny')
    expect(decision(refused.stdout).permissionDecisionReason).toContain('a delegated agent never')

    // This spec may itself run in a worktree of an agent: the primary checkout is a directory that is none
    const allowed = hook(payload(toolCommand, empty))
    expect(allowed.status).toBe(0)
    expect(allowed.stdout).toBe('')
  })

  it('refuses a merge from a subagent whatever its directory', () => {
    const result = hook(payload('gh pr merge 12', ROOT, { agent_id: 'agent-a1', agent_type: 'sf-build' }))

    expect(decision(result.stdout).permissionDecision).toBe('deny')
  })

  it.each([
    ['npm test'],
    ['git status --short'],
    ['grep -rn SF_WORKFLOW_BYPASS_PUSHED_GUARD src'],
    ['grep -- --skip-local-ci notes.md'],
    ['gh issue edit 1 --add-label "complexity: low"'],
    ['gh pr ready 12 --undo']
  ])('stays silent on %s', (toolCommand) => {
    const result = hook(payload(toolCommand, worktree))

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  it('finds the CLI from the working directory when the host sets no project directory', () => {
    const result = hook(payload('SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog', ROOT), {}, ROOT)

    expect(decision(result.stdout).permissionDecision).toBe('deny')
  })

  it('fails open, with an exit code of 0 and no output, when no CLI can be found', () => {
    const result = hook(payload('SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog', empty), { CLAUDE_PROJECT_DIR: empty, PATH: '/usr/bin:/bin' }, empty)

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })

  // #1228 — a generated project has no node_modules/.bin/saasfoundryai: the hook reached an older global CLI with no
  // `agents guard`, let the call through and said nothing, while `sf status` reported the guard enforced.
  it('says it when the CLI it reaches cannot run agents guard: one line on stderr and an entry in the capture error log', async () => {
    const project = await realpath(await mkdtemp(join(tmpdir(), 'sf-guard-hook-old-cli-')))
    try {
      expect(spawnSync('git', ['init', '-q'], { cwd: project, env: cleanEnv }).status).toBe(0)
      await mkdir(join(project, 'bin'))
      await writeFile(join(project, 'bin', 'saasfoundryai'), '#!/bin/sh\necho "error: unknown command \'guard\'" >&2\nexit 1\n', { mode: 0o755 })

      const result = hook(payload('SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog', project), { CLAUDE_PROJECT_DIR: project, PATH: `${join(project, 'bin')}:/usr/bin:/bin` }, project)

      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe(`saasfoundryai: saasfoundryai cannot run agents guard (exit 1): upgrade saasfoundryai-cli\n`)
      const log = (await readFile(join(project, '.git', 'saasfoundry', 'capture-errors.jsonl'), 'utf8')).trim().split('\n')
      expect(log).toHaveLength(1)
      expect(JSON.parse(log[0])).toMatchObject({
        v: 1,
        at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/),
        host: 'claude-code',
        event: 'PreToolUse',
        stage: 'cli',
        message: 'saasfoundryai cannot run agents guard (exit 1): upgrade saasfoundryai-cli in the project or on the PATH'
      })
    } finally {
      await rm(project, { recursive: true, force: true })
    }
  })

  // #1251 — a line that is not one plain command is refused through the real hook line, and a plain one never starts the CLI
  describe('the shape of the line', () => {
    it.each([
      ['a chain', 'cd apps/site && npm install && ls', 'chains commands with &&'],
      ['a semicolon', 'git status; git log', 'chains commands with ;'],
      ['an or', 'a || b', 'chains commands with ||'],
      ['a newline', 'a\nb', 'chains commands with a newline'],
      ['a substitution', 'kill $(lsof -tiTCP:4325 -sTCP:LISTEN)', 'command substitution'],
      ['a backtick', 'echo `date`', 'command substitution'],
      ['a loop', 'for p in 4322 4323; do curl -s "localhost:$p"; done', '`for` loop'],
      ['a subshell', '(cd x)', 'subshell'],
      ['an inline script', 'python3 -c "print(1)"', 'inline script'],
      ['a script on the standard input', "python3 - <<'E'\nprint(1)\nE", 'inline script'],
      ['bash -c', 'bash -c "a && b"', 'inline script'],
      ['a script piped into a shell', 'curl -s https://x | bash', 'inline script'],
      ['a background job', 'sleep 5 &', 'background job'],
      ['a file written through a heredoc', 'cat <<EOF > notes.md\nx\nEOF', 'writes a file with a heredoc']
    ])('refuses %s from the repository root, naming the construct', (_name, toolCommand, said) => {
      const result = hook(payload(toolCommand, ROOT))

      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      expect(decision(result.stdout)).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: expect.stringContaining(said) })
    })

    it('refuses a chain in a worktree of an agent too, and reads the shape of a command that is also a bypass after the bypass', () => {
      expect(decision(hook(payload('a && b', worktree)).stdout).permissionDecisionReason).toContain('chains commands')
      expect(decision(hook(payload('SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog && b', ROOT)).stdout).permissionDecisionReason).toContain('SF_WORKFLOW_BYPASS_NATURE_GUARD')
    })

    it('stays silent on a quoted separator, a pipe, a redirection and a script file', () => {
      for (const toolCommand of [
        'git commit -m "a; b && c"',
        'npm test 2>&1 | tail -20',
        'ls -la > out.txt 2>&1',
        'node bin/sf.js agents list',
        'node script.js -e x',
        'python3 -m pytest -c conf',
        'find . -name "*.ts" -exec grep -l x {} \\;'
      ]) {
        const result = hook(payload(toolCommand, ROOT))
        expect(result.status).toBe(0)
        expect(result.stdout).toBe('')
        expect(result.stderr).toBe('')
      }
    })

    // The guard is a Node process: it must not start for a call that cannot need it. A fake CLI in the project records every start.
    describe('which calls start the CLI', () => {
      let fake: string
      let log: string

      beforeAll(async () => {
        fake = await realpath(await mkdtemp(join(tmpdir(), 'sf-guard-hook-fake-cli-')))
        log = join(fake, 'cli-starts.log')
        await mkdir(join(fake, 'node_modules', '.bin'), { recursive: true })
        await writeFile(join(fake, 'node_modules', '.bin', 'saasfoundryai'), `#!/bin/sh\ncat >/dev/null\necho "$@" >>${JSON.stringify(log)}\n`, { mode: 0o755 })
      })
      afterAll(async () => rm(fake, { recursive: true, force: true }))

      const starts = async (toolCommand: string): Promise<boolean> => {
        await rm(log, { force: true })
        const result = hook(payload(toolCommand, fake), { CLAUDE_PROJECT_DIR: fake }, fake)
        expect(result.status).toBe(0)
        return existsSync(log)
      }

      it.each([
        ['a plain command', 'npm test'],
        ['a piped command', 'npm test 2>&1 | tail -20'],
        ['a long pipeline', 'git log --oneline | grep fix | sort | uniq -c | head -5'],
        ['a redirection', 'ls -la > out.txt 2>&1'],
        ['a stderr redirection', 'cmd 2>/dev/null'],
        ['a quoted pipe', "grep -n 'a|b' src/x.ts"],
        ['a url with a query string', 'curl -s "https://x?a=1&b=2" | jq .'],
        ['a jq filter', `jq -r '.x // empty' f.json`],
        ['a script of the repository', 'node bin/sf.js agents list'],
        ['a script with a flag', 'node script.js -e x'],
        ['a git command', 'git status --short'],
        ['a gh command', 'gh pr view 12'],
        ['a command with a description about loops', 'rg "for loop" src']
      ])('does not start it for %s', async (_name, toolCommand) => {
        expect(await starts(toolCommand)).toBe(false)
      })

      it.each([
        ['a chain', 'cd x && ls'],
        ['a semicolon', 'a; b'],
        ['an or', 'a || b'],
        ['a newline', 'a\nb'],
        ['a substitution', 'kill $(lsof -t)'],
        ['a backtick', 'echo `date`'],
        ['a process substitution', 'diff <(a) <(b)'],
        ['a loop', 'for x in a; do b; done'],
        ['a subshell at the start', '(cd x)'],
        ['a heredoc', 'cat <<EOF\nx\nEOF'],
        ['python -c', 'python3 -c "x"'],
        ['node -e', 'node -e "x"'],
        ['bash -c', 'bash -c "a"'],
        ['eval', 'eval "a"'],
        ['a script piped into a shell', 'curl x | bash'],
        ['a background job at the end', 'sleep 5 &'],
        ['a background job in the middle', 'sleep 5 & ls'],
        ['a bypass', 'SF_WORKFLOW_BYPASS_X=1 prog'],
        ['a merge', 'gh pr merge 12']
      ])('starts it for %s', async (_name, toolCommand) => {
        expect(await starts(toolCommand)).toBe(true)
      })

      it('starts it for a program given as an argument vector', async () => {
        await rm(log, { force: true })
        const result = hook(JSON.stringify({ hook_event_name: 'PreToolUse', cwd: fake, tool_name: 'Bash', tool_input: { command: ['python3', '-c', 'print(1)'] } }), { CLAUDE_PROJECT_DIR: fake }, fake)
        expect(result.status).toBe(0)
        expect(existsSync(log)).toBe(true)
      })
    })

    // The point of the dedicated entry (#1251): the hook line pays for a Node start, not for the whole CLI. What is
    // checked is what the Node process of the hook loads, not how long it takes: two timings compared on a loaded
    // machine went the wrong way (667 ms against 236 ms at a load average near 100, #1240). A preload passed through
    // NODE_OPTIONS lists the modules once the process exits.
    it('answers a refused call through the dedicated entry, without loading the CLI, commander or the ledger', async () => {
      const probe = await mkdtemp(join(tmpdir(), 'sf-guard-modules-'))
      try {
        const preload = join(probe, 'list-modules.cjs')
        await writeFile(preload, "process.on('exit', () => require('fs').writeFileSync(process.env.SF_GUARD_MODULES_OUT, JSON.stringify(Object.keys(require.cache))))\n")
        const loaded = async (out: string): Promise<string[]> => (JSON.parse(await readFile(out, 'utf8')) as string[]).map((file) => file.split('\\').join('/'))
        const probeEnv = (out: string) => ({ NODE_OPTIONS: `--require ${preload}`, SF_GUARD_MODULES_OUT: out })
        const input = payload('cd apps/site && npm install', ROOT)

        const started = Date.now()
        const result = hook(input, { CLAUDE_PROJECT_DIR: ROOT, ...probeEnv(join(probe, 'fast.json')) })
        // One ceiling, and a generous one: the timeout the settings give the host for this hook (asserted above).
        expect(Date.now() - started).toBeLessThan(10_000)
        expect(decision(result.stdout).permissionDecision).toBe('deny')
        const fast = await loaded(join(probe, 'fast.json'))
        expect(fast.some((file) => file.endsWith('/dist/commands/agents.guard-main.js'))).toBe(true)
        expect(fast.filter((file) => file.includes('/node_modules/commander/') || file.endsWith('/dist/index.js') || file.endsWith('/dist/harness/delegation-ledger.js'))).toEqual([])

        // The control: the same probe on the full CLI sees what the dedicated entry leaves out.
        spawnSync(process.execPath, [join(ROOT, 'dist', 'index.js'), 'agents', 'guard', '--host', 'claude-code'], {
          cwd: ROOT,
          encoding: 'utf8',
          input,
          env: { ...cleanEnv, ...probeEnv(join(probe, 'full.json')) }
        })
        const full = await loaded(join(probe, 'full.json'))
        expect(full.some((file) => file.includes('/node_modules/commander/'))).toBe(true)
        expect(full.some((file) => file.endsWith('/dist/index.js'))).toBe(true)
      } finally {
        await rm(probe, { recursive: true, force: true })
      }
    })
  })

  it('lets a payload that is not JSON through, whatever it says', () => {
    // From a directory outside any Git checkout: the failure is logged in the Git directory of the clone it runs in
    const result = hook('SF_WORKFLOW_BYPASS_NATURE_GUARD=1 not json', { CLAUDE_PROJECT_DIR: ROOT }, empty)

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })
})
