import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Hook lives at `.claude/skills/sf-srs/scripts/srs-intent-hook.sh` (a symlink
// into `scaffolds/skills-templates/sf-srs/scripts/`). It runs on every
// UserPromptSubmit; if it spammed or blocked the user's turn the agent UX
// would degrade silently. This spec pins the contract from #316:
//   - never blocks (always exits 0)
//   - silent on trivial / non-firing signals
//   - silent when opted out (env var or manifest flag)
//   - emits a single <system-reminder> for ur / fr / ds / tc with non-low
//     confidence
const HOOK = path.resolve(__dirname, '../../../../.claude/skills/sf-srs/scripts/srs-intent-hook.sh')

// The budget test starts the hook 20 times, and each start is several processes: a loaded machine takes
// more than the former 20 s of the unit project (#1205). The bound is a hang guard, not what the tests check.
jest.setTimeout(90_000)

interface RunResult {
  stdout: string
  stderr: string
  code: number
  ms: number
}

function runHook(prompt: string, opts: { cwd?: string; env?: NodeJS.ProcessEnv; argv?: string[] } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint()
    const child = spawn('/bin/bash', opts.argv ?? [HOOK], {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) }
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      stdout += String(d)
    })
    child.stderr.on('data', (d) => {
      stderr += String(d)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      resolve({ stdout, stderr, code: code ?? -1, ms })
    })
    // Hook reads a JSON envelope on stdin. Use null prompt to simulate the
    // "missing prompt" path. Opt-out paths (e.g. SF_DISABLE_SRS_HOOK=1) exit
    // before reading stdin, so the write is best-effort: swallow the EPIPE
    // that races with the child closing its stdin (#461).
    const envelope = prompt === null ? '{}' : JSON.stringify({ prompt })
    child.stdin.on('error', () => {})
    child.stdin.write(envelope, () => {})
    child.stdin.end()
  })
}

/**
 * The CPU time (user + system) of the processes a bash wrapper waited for, from the last line of its
 * `times` builtin: `0m0.014s 0m0.026s`. Unlike elapsed time, it does not grow while a loaded machine
 * keeps the processes waiting for a core (#1205).
 */
function childCpuMs(timesOutput: string): number {
  const last = timesOutput.trim().split('\n').pop() ?? ''
  const fields = [...last.matchAll(/(\d+)m(\d+)[.,](\d+)s/g)]
  if (fields.length !== 2) throw new Error(`Unexpected output of bash's times builtin: ${JSON.stringify(timesOutput)}`)
  return fields.reduce((total, [, minutes, seconds, fraction]) => total + Number(minutes) * 60_000 + Number(`${seconds}.${fraction}`) * 1000, 0)
}

describe('sf-srs intent-detector hook (#316)', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), 'sf-intent-hook-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  const writeManifest = (body: unknown): void => {
    writeFileSync(path.join(cwd, '.saasfoundry.json'), JSON.stringify(body))
  }

  describe('always non-blocking', () => {
    it('exits 0 on a firing prompt', async () => {
      const r = await runHook('users should be able to reset their password', { cwd })
      expect(r.code).toBe(0)
    })

    it('exits 0 on a trivial prompt', async () => {
      const r = await runHook('merci', { cwd })
      expect(r.code).toBe(0)
      expect(r.stdout).toBe('')
    })

    it('exits 0 on a missing prompt field in the envelope', async () => {
      // Send an envelope without `.prompt` — hook should bail silently.
      const r = await runHook(null as unknown as string, { cwd })
      expect(r.code).toBe(0)
      expect(r.stdout).toBe('')
    })

    it('exits 0 on garbage stdin', async () => {
      const child = spawn('/bin/bash', [HOOK], { cwd })
      child.stdin.write('not json at all')
      child.stdin.end()
      const code: number = await new Promise((resolve) => child.on('close', (c) => resolve(c ?? -1)))
      expect(code).toBe(0)
    })
  })

  describe('opt-out paths', () => {
    it('SF_DISABLE_SRS_HOOK=1 short-circuits before any work', async () => {
      const r = await runHook('users should be able to reset their password', { cwd, env: { SF_DISABLE_SRS_HOOK: '1' } })
      expect(r.code).toBe(0)
      expect(r.stdout).toBe('')
      expect(r.stderr).toBe('')
    })

    it('manifest tools.srs.enabled = false silences a firing prompt', async () => {
      writeManifest({ tools: { srs: { enabled: false } } })
      const r = await runHook('users should be able to reset their password', { cwd })
      expect(r.code).toBe(0)
      expect(r.stdout).toBe('')
    })

    it('manifest tools.srs.intentDetectorEnabled = false silences a firing prompt', async () => {
      writeManifest({ tools: { srs: { intentDetectorEnabled: false } } })
      const r = await runHook('users should be able to reset their password', { cwd })
      expect(r.code).toBe(0)
      expect(r.stdout).toBe('')
    })

    it('manifest with srs enabled but unrelated keys does NOT silence', async () => {
      writeManifest({ tools: { srs: { backend: 'notion' } } })
      const r = await runHook('users should be able to reset their password', { cwd })
      expect(r.code).toBe(0)
      expect(r.stdout).toContain('<system-reminder>')
    })

    it('a malformed manifest does not silence the hook (fails open)', async () => {
      writeFileSync(path.join(cwd, '.saasfoundry.json'), '{not valid json')
      const r = await runHook('users should be able to reset their password', { cwd })
      expect(r.code).toBe(0)
      expect(r.stdout).toContain('<system-reminder>')
    })

    it('no manifest at all does not silence the hook (works outside SaaSFoundryAI projects too)', async () => {
      const r = await runHook('users should be able to reset their password', { cwd })
      expect(r.code).toBe(0)
      expect(r.stdout).toContain('<system-reminder>')
    })
  })

  describe('classification gate', () => {
    it('fires on a UR-shaped prompt', async () => {
      const r = await runHook('users should be able to reset their password', { cwd })
      expect(r.stdout).toContain('<system-reminder>')
      expect(r.stdout).toContain('signal=ur')
      expect(r.stdout).toContain('sf-srs')
    })

    it('fires on an FR-shaped prompt', async () => {
      const r = await runHook('add a feature that allows users to export their data', { cwd })
      expect(r.stdout).toContain('signal=fr')
    })

    it('fires on a DS-shaped prompt', async () => {
      const r = await runHook("let's use bcrypt for password hashing", { cwd })
      expect(r.stdout).toContain('signal=ds')
    })

    it('fires on a TC-shaped prompt', async () => {
      const r = await runHook('we should test that login rejects empty passwords', { cwd })
      expect(r.stdout).toContain('signal=tc')
    })

    it('stays silent on trivial acknowledgement', async () => {
      const r = await runHook('merci', { cwd })
      expect(r.stdout).toBe('')
    })

    it('stays silent on a read-only request', async () => {
      const r = await runHook('show me the config', { cwd })
      expect(r.stdout).toBe('')
    })

    it('stays silent on a "none"-classed prompt', async () => {
      const r = await runHook('deployed to staging', { cwd })
      expect(r.stdout).toBe('')
    })

    it('stays silent on a low-confidence revision (revision is low → suppressed in v1)', async () => {
      // The classifier marks `reconsider …` as revision/low — the hook MUST
      // suppress low-confidence calls per the conservative fire rule.
      const r = await runHook('reconsider the session TTL decision', { cwd })
      expect(r.stdout).toBe('')
    })

    it('exposes target text in the emitted reminder so the agent can act', async () => {
      const r = await runHook('users should be able to reset their password', { cwd })
      expect(r.stdout).toMatch(/target="[^"]+"/)
    })
  })

  // The hook runs on every prompt, so it must stay a handful of bash, jq and tr processes. The point is to
  // fail loud if someone sneaks an HTTP call or a heavy node import into it. #316 bounded its wall-clock
  // p95 at 500 ms, and a loaded machine broke that bound on its own (#1205: 542 ms and 1445 ms at a load
  // average of 40 to 76 on 10 cores, against about 70 ms idle). What such a regression adds is measured
  // here without the scheduler: the CPU time the work costs, and the programs the hook starts.
  describe('performance budget', () => {
    const PROMPTS = ['merci', 'users should be able to reset their password']

    it('spends under 110 ms of CPU per prompt, the hook and its children together (median over 20 runs)', async () => {
      const samples: number[] = []
      for (let i = 0; i < 20; i++) {
        const r = await runHook(PROMPTS[i % PROMPTS.length], { cwd, argv: ['-c', '/bin/bash "$1" >/dev/null 2>&1; times', 'srs-hook-cpu', HOOK] })
        samples.push(childCpuMs(r.stdout))
      }
      samples.sort((a, b) => a - b)
      const median = samples[Math.floor(samples.length / 2)]
      // 50 to 55 ms today, at a load average of 16 as at 60: the bound is twice that. Starting Node to import
      // the TypeScript compiler brings the median to about 160 ms (measured for #1205). A regression costs
      // that on every run and moves the median, where one run slowed by a busy core does not.
      expect(median).toBeLessThan(110)
    })

    it('starts no Node runtime and no network client, whether it fires or not', async () => {
      const spyDir = mkdtempSync(path.join(tmpdir(), 'sf-intent-hook-spy-'))
      const calls = path.join(spyDir, 'calls.log')
      try {
        for (const program of ['node', 'npx', 'npm', 'curl', 'wget', 'nc', 'gh', 'python', 'python3']) {
          writeFileSync(path.join(spyDir, program), `#!/bin/sh\necho ${program} >> "${calls}"\nexit 1\n`, { mode: 0o755 })
        }
        const env = { PATH: `${spyDir}${path.delimiter}${process.env.PATH ?? ''}` }
        const fired = await runHook(PROMPTS[1], { cwd, env })
        const silent = await runHook(PROMPTS[0], { cwd, env })
        // The spies sit first on PATH and the hook still classifies, so they shadowed nothing it needs.
        expect(fired.stdout).toContain('<system-reminder>')
        expect(silent.stdout).toBe('')
        expect(existsSync(calls) ? readFileSync(calls, 'utf8') : '').toBe('')
      } finally {
        rmSync(spyDir, { recursive: true, force: true })
      }
    })
  })
})
