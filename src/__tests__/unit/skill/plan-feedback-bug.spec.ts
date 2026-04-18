import { execFile } from 'child_process'
import path from 'path'

const SCRIPT = path.resolve(__dirname, '../../../../scaffolds/skills-templates/tool-saasfoundry/scripts/plan-feedback-bug.js')
const DISPATCHER = path.resolve(__dirname, '../../../../scaffolds/skills-templates/tool-saasfoundry/scripts/plan-feedback-bug.sh')
const NODE = process.execPath
const BASH = '/bin/bash'

interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

async function runWithInput(bin: string, args: string[], input: unknown): Promise<ExecResult> {
  const child = execFile(bin, args)
  const stdoutChunks: string[] = []
  const stderrChunks: string[] = []
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (c: string) => stdoutChunks.push(c))
  child.stderr?.on('data', (c: string) => stderrChunks.push(c))
  child.stdin?.write(typeof input === 'string' ? input : JSON.stringify(input))
  child.stdin?.end()
  const code = await new Promise<number>((resolve) => child.on('close', (c) => resolve(c ?? 0)))
  return { stdout: stdoutChunks.join(''), stderr: stderrChunks.join(''), code }
}

interface DetectionEvent {
  source: 'cli-invocation' | 'scaffold-build' | 'manual'
  title: string
  description?: string
  command?: string
  exitCode?: number
  stderr?: string
  context?: 'cli' | 'scaffold'
  userConfirmed?: boolean
}

interface BugReportPlan {
  source: string
  label: 'cli-bug' | 'scaffold-bug'
  title: string
  description: string
  redactedStderr: string
  decision: 'file-bug' | 'refuse'
  recommendation: {
    action: 'run-command' | 'refuse'
    command: string | null
    message: string
  }
}

async function runAndParse(input: DetectionEvent): Promise<BugReportPlan & ExecResult> {
  const res = await runWithInput(NODE, [SCRIPT], input)
  if (res.code !== 0) {
    throw new Error(`Expected success, got code=${res.code}, stderr=${res.stderr}`)
  }
  return { ...res, ...(JSON.parse(res.stdout) as BugReportPlan) }
}

describe('skill/plan-feedback-bug', () => {
  describe('Detection: CLI failure → cli-bug', () => {
    it('labels a cli-invocation event as cli-bug and embeds command + exit code in the body', async () => {
      const out = await runAndParse({
        source: 'cli-invocation',
        title: 'sf new crashes on empty project name',
        command: 'sf new --non-interactive --name=""',
        exitCode: 1,
        stderr: 'Error: project name is required',
        userConfirmed: true
      })
      expect(out.decision).toBe('file-bug')
      expect(out.label).toBe('cli-bug')
      expect(out.recommendation.action).toBe('run-command')
      expect(out.recommendation.command).toContain('--source cli')
      expect(out.description).toContain('**Command:**')
      expect(out.description).toContain('**Exit code:** 1')
      expect(out.description).toContain('Error: project name is required')
    })
  })

  describe('Detection: scaffold build failure → scaffold-bug', () => {
    it('labels a scaffold-build event as scaffold-bug', async () => {
      const out = await runAndParse({
        source: 'scaffold-build',
        title: 'Generated NestJS project fails to build',
        command: 'cd apps/api && nest build',
        exitCode: 1,
        stderr: "TS2304: Cannot find name 'AppModule'",
        userConfirmed: true
      })
      expect(out.decision).toBe('file-bug')
      expect(out.label).toBe('scaffold-bug')
      expect(out.recommendation.command).toContain('--source scaffold')
      expect(out.redactedStderr).toContain('TS2304')
    })
  })

  describe('Detection: user-initiated (manual) → context routing', () => {
    it('defaults manual reports to cli-bug when no context is provided', async () => {
      const out = await runAndParse({
        source: 'manual',
        title: 'something feels off with sf update merges',
        userConfirmed: true
      })
      expect(out.label).toBe('cli-bug')
      expect(out.recommendation.command).toContain('--source cli')
    })

    it('honours an explicit scaffold context override on manual reports', async () => {
      const out = await runAndParse({
        source: 'manual',
        context: 'scaffold',
        title: 'generated web app has a routing bug',
        userConfirmed: true
      })
      expect(out.label).toBe('scaffold-bug')
      expect(out.recommendation.command).toContain('--source scaffold')
    })

    it('rejects an unknown context value so the skill cannot smuggle in typos', async () => {
      const res = await runWithInput(NODE, [SCRIPT], {
        source: 'manual',
        context: 'server',
        title: 'bad context',
        userConfirmed: true
      })
      expect(res.code).toBe(2)
      expect(res.stderr).toMatch(/context.*cli.*scaffold/i)
    })
  })

  describe('Redaction: credentials must never leave the process', () => {
    it('redacts GitHub tokens, bearer auth, JWTs, query-string tokens, home paths, emails, env-style secrets', async () => {
      const dirty = [
        'fetch https://api.github.com with Bearer ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 failed',
        'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.XYZsignature_part_goes_here123',
        'url=https://example.com/callback?token=ghp_1234567890abcdef1234567890abcdef12345&foo=1',
        'user ran --token=SECRET_VALUE_HERE against the api',
        'OPENAI_API_KEY=sk-proj-1234567890abcdef1234567890abcdef1234567890',
        'at /Users/alice.smith/Projects/app/src/index.js:12 and /home/bob_dev/repo/app.ts:5',
        'contact: alice.dev+bug@example.com for details',
        // String concat so GitHub secret scanning doesn't flag the literal;
        // the runtime value still matches our redaction regex.
        'STRIPE_SECRET_KEY=' + 'sk_live_' + '1234567890abcdef1234567890abcdef'
      ].join('\n')

      const out = await runAndParse({
        source: 'cli-invocation',
        title: 'secrets must be scrubbed',
        stderr: dirty,
        userConfirmed: true
      })

      // Positive: redaction placeholders appear
      expect(out.redactedStderr).toContain('<github-token>')
      expect(out.redactedStderr).toContain('<jwt>')
      expect(out.redactedStderr).toContain('<redacted>') // token=, --token=, env var
      expect(out.redactedStderr).toContain('<email>')
      expect(out.redactedStderr).toContain('/Users/<user>')
      expect(out.redactedStderr).toContain('/home/<user>')
      expect(out.redactedStderr).toMatch(/<stripe-key>|<redacted>/) // either pattern wins first

      // Negative: raw secrets must NOT survive anywhere in the output
      const raw = JSON.stringify(out)
      expect(raw).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345')
      expect(raw).not.toContain('ghp_1234567890abcdef1234567890abcdef12345')
      expect(raw).not.toContain('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.XYZsignature_part_goes_here123')
      expect(raw).not.toContain('SECRET_VALUE_HERE')
      expect(raw).not.toContain('sk-proj-1234567890abcdef1234567890abcdef1234567890')
      expect(raw).not.toContain('sk_live_' + '1234567890abcdef1234567890abcdef')
      expect(raw).not.toContain('alice.dev+bug@example.com')
      expect(raw).not.toContain('/Users/alice.smith')
      expect(raw).not.toContain('/home/bob_dev')
    })

    it('leaves stack-trace keywords and error messages intact so triage stays useful', async () => {
      const out = await runAndParse({
        source: 'cli-invocation',
        title: 'redaction must preserve triage signal',
        stderr: 'TypeError: Cannot read properties of undefined (reading "foo")\n    at processInput (/Users/x/a.ts:4)',
        userConfirmed: true
      })
      expect(out.redactedStderr).toContain('TypeError: Cannot read properties of undefined')
      expect(out.redactedStderr).toContain('(reading "foo")')
      expect(out.redactedStderr).toContain('processInput')
      expect(out.redactedStderr).toContain('/Users/<user>/a.ts:4')
    })
  })

  describe('Gate: userConfirmed must be true before filing', () => {
    it('refuses when userConfirmed is absent', async () => {
      const out = await runAndParse({
        source: 'cli-invocation',
        title: 'no confirmation'
      })
      expect(out.decision).toBe('refuse')
      expect(out.recommendation.action).toBe('refuse')
      expect(out.recommendation.command).toBeNull()
      expect(out.recommendation.message).toMatch(/userConfirmed/)
    })

    it('refuses when userConfirmed is false', async () => {
      const out = await runAndParse({
        source: 'cli-invocation',
        title: 'explicit refusal',
        userConfirmed: false
      })
      expect(out.decision).toBe('refuse')
    })

    it('still redacts the stderr even when refusing, so nothing sensitive leaks into the refusal message', async () => {
      const out = await runAndParse({
        source: 'cli-invocation',
        title: 'refusal still scrubs',
        stderr: 'token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
        userConfirmed: false
      })
      expect(JSON.stringify(out)).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345')
    })
  })

  describe('Input validation: fail fast on malformed intent', () => {
    it('exits 2 with a clear message on empty stdin', async () => {
      const res = await runWithInput(NODE, [SCRIPT], '')
      expect(res.code).toBe(2)
      expect(res.stderr).toMatch(/empty input/i)
    })

    it('exits 2 on invalid JSON', async () => {
      const res = await runWithInput(NODE, [SCRIPT], '{not json')
      expect(res.code).toBe(2)
      expect(res.stderr).toMatch(/invalid JSON/i)
    })

    it('exits 2 on an unknown source value', async () => {
      const res = await runWithInput(NODE, [SCRIPT], { source: 'network-timeout', title: 't', userConfirmed: true })
      expect(res.code).toBe(2)
      expect(res.stderr).toMatch(/source must be one of/i)
    })

    it('exits 2 on an empty title', async () => {
      const res = await runWithInput(NODE, [SCRIPT], { source: 'cli-invocation', title: '   ', userConfirmed: true })
      expect(res.code).toBe(2)
      expect(res.stderr).toMatch(/title must be a non-empty string/i)
    })
  })

  describe('Dispatcher (plan-feedback-bug.sh)', () => {
    it('forwards stdin to the classifier and surfaces the same decision', async () => {
      const res = await runWithInput(BASH, [DISPATCHER], {
        source: 'cli-invocation',
        title: 'dispatcher smoke',
        userConfirmed: true
      })
      expect(res.code).toBe(0)
      const parsed = JSON.parse(res.stdout) as BugReportPlan
      expect(parsed.decision).toBe('file-bug')
      expect(parsed.label).toBe('cli-bug')
    })

    it('rejects empty stdin with exit code 2', async () => {
      const res = await runWithInput(BASH, [DISPATCHER], '')
      expect(res.code).toBe(2)
      expect(res.stderr).toMatch(/empty input on stdin/i)
    })
  })
})
