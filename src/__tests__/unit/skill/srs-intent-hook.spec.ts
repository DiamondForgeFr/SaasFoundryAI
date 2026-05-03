import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

interface RunResult {
  stdout: string
  stderr: string
  code: number
  ms: number
}

function runHook(prompt: string, opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint()
    const child = spawn('/bin/bash', [HOOK], {
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
    // "missing prompt" path.
    const envelope = prompt === null ? '{}' : JSON.stringify({ prompt })
    child.stdin.write(envelope)
    child.stdin.end()
  })
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

    it('no manifest at all does not silence the hook (works outside SaaSFoundry projects too)', async () => {
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

  describe('performance budget', () => {
    it('p95 cold-spawn latency stays under 500ms over 20 runs', async () => {
      const samples: number[] = []
      for (let i = 0; i < 20; i++) {
        const r = await runHook('merci', { cwd })
        samples.push(r.ms)
      }
      samples.sort((a, b) => a - b)
      const p95 = samples[Math.floor(samples.length * 0.95)]
      // 500ms is generous: target is ≤250ms p95 in real shells, but Jest
      // spawn overhead inflates measurements. The point is to fail loud if
      // someone sneaks an HTTP call or a heavy node import into the hook.
      expect(p95).toBeLessThan(500)
    })
  })
})
