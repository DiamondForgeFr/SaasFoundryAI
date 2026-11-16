import { spawnSync } from 'child_process'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const ROOT = resolve(__dirname, '../../..')
// A commit hook exports GIT_* variables: a fixture repository must never inherit them.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && key !== 'CLAUDE_PROJECT_DIR'))

// #1251 — `sf agents shell-guard` records what the guard hook does with a shell line that is not one plain command,
// in the manifest only; the guard hook reads it on every call. Absence means refuse and nothing else writes it.
describe('compiled sf agents shell-guard (#1251)', () => {
  let project: string
  const writeManifest = (modules: Record<string, unknown> | undefined) =>
    writeFile(
      join(project, '.saasfoundry.json'),
      JSON.stringify({ version: 'test', projectName: 'shell-guard-demo', generatedAt: '2026-11-16T00:00:00.000Z', structure: 'cli', modules }, null, 2) + '\n'
    )
  const readManifest = async () => JSON.parse(await readFile(join(project, '.saasfoundry.json'), 'utf8'))
  const run = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', 'shell-guard', ...args], { cwd: project, encoding: 'utf8', env: cleanEnv })
  const guard = (command: string, host = 'claude-code') =>
    spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', 'guard', '--host', host], {
      cwd: project,
      encoding: 'utf8',
      env: cleanEnv,
      input: JSON.stringify({ hook_event_name: 'PreToolUse', cwd: project, tool_name: 'Bash', tool_input: { command } })
    })

  beforeEach(async () => {
    project = await realpath(await mkdtemp(join(tmpdir(), 'sf-agents-shell-guard-')))
    await writeManifest({ harness: { version: 5, agents: ['claude-code'] } })
  })
  afterEach(async () => rm(project, { recursive: true, force: true }))

  it('says refuse is the default when nothing is recorded, as text and as JSON', () => {
    const text = run('status')
    expect(text.status).toBe(0)
    expect(text.stdout).toContain('Shell shape guard: refuse (the default: nothing is recorded in .saasfoundry.json, and absence means refuse)')
    expect(JSON.parse(run('status', '--json').stdout)).toEqual({ shellGuardVersion: 1, shellShape: 'refuse', source: 'default' })
  })

  it.each([['warn'], ['off'], ['refuse']])('records %s in the manifest as the shared team default and reads it back', async (mode) => {
    const recorded = run(mode)
    expect(recorded.status).toBe(0)
    expect(recorded.stdout).toContain(`Shell shape guard: ${mode} (recorded in .saasfoundry.json)`)
    expect(recorded.stdout).toContain('shared team default')
    expect(recorded.stdout).toContain("commit it with the current ticket's branch")
    expect(recorded.stdout).toContain('could not be read, so never commit it there directly')
    expect((await readManifest()).modules.harness.guard).toEqual({ shellShape: mode })
    expect(JSON.parse(run('status', '--json').stdout)).toEqual({ shellGuardVersion: 1, shellShape: mode, source: 'manifest' })
  })

  it('reports an unchanged repeat, and writes nothing', async () => {
    expect(run('warn').status).toBe(0)
    const before = await readFile(join(project, '.saasfoundry.json'), 'utf8')

    const repeat = run('warn', '--json')
    expect(repeat.status).toBe(0)
    expect(JSON.parse(repeat.stdout)).toEqual({ shellGuardVersion: 1, shellShape: 'warn', source: 'manifest', changed: false })
    expect(run('warn').stdout).toContain('Already recorded; .saasfoundry.json is unchanged.')
    expect(await readFile(join(project, '.saasfoundry.json'), 'utf8')).toBe(before)
  })

  it('keeps the other harness fields and the other keys of the guard block, and every unknown key', async () => {
    await writeManifest({
      harness: {
        version: 5,
        managed: true,
        agents: ['claude-code', 'codex'],
        routing: { kinds: { prose: { tier: 'edit' } } },
        delegation: { ticketDelivery: 'allowed', decidedAt: '2026-10-19T15:34:52.506Z' },
        guard: { allow: ['x'] },
        later: { a: 1 }
      },
      pwa: { version: 1 }
    })

    expect(run('off').status).toBe(0)

    const manifest = await readManifest()
    expect(manifest.modules.harness).toEqual({
      version: 5,
      managed: true,
      agents: ['claude-code', 'codex'],
      routing: { kinds: { prose: { tier: 'edit' } } },
      delegation: { ticketDelivery: 'allowed', decidedAt: '2026-10-19T15:34:52.506Z' },
      guard: { allow: ['x'], shellShape: 'off' },
      later: { a: 1 }
    })
    expect(manifest.modules.pwa).toEqual({ version: 1 })
  })

  it('fails with a message on a project without a harness block, and on an action it does not know', async () => {
    const unknown = run('allow')
    expect(unknown.status).toBe(1)
    expect(unknown.stderr).toContain('Choose what to do with the shell shape guard: sf agents shell-guard <refuse|warn|off|status>')

    await writeManifest(undefined)
    const none = run('warn')
    expect(none.status).toBe(1)
    expect(none.stderr).toContain('Cannot record the shell shape mode')
    expect(none.stderr).toContain('modules.harness is missing')
    expect(JSON.parse(run('warn', '--json').stdout)).toMatchObject({ error: expect.stringContaining('modules.harness is missing') })
    expect(run('status').stdout).toContain('Shell shape guard: refuse (the default')
  })

  it('refuses a manifest whose guard block holds an unknown mode, naming the field', async () => {
    await writeManifest({ harness: { version: 5, agents: ['claude-code'], guard: { shellShape: 'allow' } } })
    const result = run('status')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Invalid manifest harness guard: shellShape must be refuse, warn, off')
  })

  // the guard hook reads the mode on every call
  describe('what the guard hook does with the mode', () => {
    const CHAIN = 'cd apps/site && npm install'

    it('refuses a chained line by default, and when refuse is recorded', async () => {
      const absent = JSON.parse(guard(CHAIN).stdout).hookSpecificOutput
      expect(absent.permissionDecision).toBe('deny')
      expect(absent.permissionDecisionReason).toContain('chains commands with &&')

      expect(run('refuse').status).toBe(0)
      expect(JSON.parse(guard(CHAIN).stdout).hookSpecificOutput.permissionDecision).toBe('deny')
    })

    it('warns, with the same text as context and no denial, when warn is recorded', () => {
      expect(run('warn').status).toBe(0)
      const result = guard(CHAIN)

      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      const output = JSON.parse(result.stdout)
      expect(output).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: expect.stringContaining('1. `cd apps/site` 2. `npm install`') } })
      expect(output.hookSpecificOutput.additionalContext).toContain('guard hook warning')
      expect(result.stdout).not.toContain('permissionDecision')
    })

    it('says nothing about a chained line when off is recorded, and still refuses a bypass', () => {
      expect(run('off').status).toBe(0)

      expect(guard(CHAIN).stdout).toBe('')
      expect(JSON.parse(guard('SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog && b').stdout).hookSpecificOutput.permissionDecision).toBe('deny')
    })

    it('refuses a bypass whatever the mode', () => {
      for (const mode of ['refuse', 'warn', 'off']) {
        expect(run(mode).status).toBe(0)
        expect(JSON.parse(guard('SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog').stdout).hookSpecificOutput.permissionDecision).toBe('deny')
      }
    })

    it('treats a recorded value it does not know as refuse', async () => {
      await writeManifest({ harness: { version: 5, agents: ['claude-code'], guard: { shellShape: 'allow' } } })
      expect(JSON.parse(guard(CHAIN).stdout).hookSpecificOutput.permissionDecision).toBe('deny')
    })

    it('works the same on Codex', () => {
      expect(run('warn').status).toBe(0)
      expect(JSON.parse(guard(CHAIN, 'codex').stdout).hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', additionalContext: expect.stringContaining('chains commands') })
    })
  })
})
