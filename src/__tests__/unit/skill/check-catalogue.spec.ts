import { execFile } from 'child_process'
import path from 'path'

const SCRIPT = path.resolve(__dirname, '../../../../scaffolds/skills-templates/tool-saasfoundry/scripts/check-catalogue.js')
const NODE = process.execPath

interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

async function runWithInput(input: unknown): Promise<ExecResult> {
  const child = execFile(NODE, [SCRIPT])
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

interface Recommendation {
  intent: string
  tier: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'
  topMatch: {
    name: string
    displayName: string
    category: string
    score: number
    reasons: string[]
  } | null
  recommendation: {
    action: 'propose-update' | 'confirm-with-user' | 'route-to-feedback'
    command: string | null
    message: string
  }
}

async function runAndParse(input: unknown): Promise<Recommendation & ExecResult> {
  const res = await runWithInput(input)
  if (res.code !== 0) {
    throw new Error(`Expected success, got code=${res.code}, stderr=${res.stderr}`)
  }
  return { ...res, ...(JSON.parse(res.stdout) as Recommendation) }
}

function match(intent: string, results: Array<Partial<Recommendation['topMatch']> & { score: number }>) {
  return {
    intent,
    match: {
      cliVersion: '1.0.0-beta',
      intent,
      results: results.map((r) => ({
        name: r?.name ?? 'email',
        displayName: r?.displayName ?? 'Email Service',
        category: r?.category ?? 'communication',
        score: r.score,
        reasons: r?.reasons ?? []
      }))
    }
  }
}

describe('skill/check-catalogue', () => {
  describe('HIGH tier — strong match', () => {
    it('emits propose-update with a sf update command at score >= 6', async () => {
      const out = await runAndParse(
        match('send transactional emails', [
          {
            name: 'email',
            displayName: 'Email Service',
            score: 15,
            reasons: ['keywords: send, emails']
          }
        ])
      )
      expect(out.tier).toBe('HIGH')
      expect(out.recommendation.action).toBe('propose-update')
      expect(out.recommendation.command).toBe('sf update --add-modules email')
      expect(out.recommendation.message).toMatch(/Strong match/)
      expect(out.topMatch?.score).toBe(15)
    })

    it('uses the top result (highest score) when multiple modules match', async () => {
      const out = await runAndParse(
        match('email notifications', [
          { name: 'email', displayName: 'Email Service', score: 12 },
          { name: 'analytics', displayName: 'Analytics', score: 4 }
        ])
      )
      expect(out.tier).toBe('HIGH')
      expect(out.topMatch?.name).toBe('email')
      expect(out.recommendation.command).toBe('sf update --add-modules email')
    })
  })

  describe('MEDIUM tier — needs confirmation', () => {
    it('emits confirm-with-user at score 3–5', async () => {
      const out = await runAndParse(match('track usage', [{ name: 'analytics', displayName: 'Analytics', score: 4, reasons: ['description: track'] }]))
      expect(out.tier).toBe('MEDIUM')
      expect(out.recommendation.action).toBe('confirm-with-user')
      expect(out.recommendation.command).toBe('sf update --add-modules analytics')
      expect(out.recommendation.message).toMatch(/Confirm with the user/)
    })
  })

  describe('LOW tier — route to feedback with warning', () => {
    it('emits route-to-feedback at score 1–2', async () => {
      const out = await runAndParse(match('ambiguous', [{ name: 'email', displayName: 'Email', score: 2 }]))
      expect(out.tier).toBe('LOW')
      expect(out.recommendation.action).toBe('route-to-feedback')
      expect(out.recommendation.command).toBeNull()
      expect(out.recommendation.message).toMatch(/Weak match/)
    })
  })

  describe('NONE tier — no catalogue results', () => {
    it('routes to feedback when results is empty', async () => {
      const out = await runAndParse(match('totally novel idea', []))
      expect(out.tier).toBe('NONE')
      expect(out.topMatch).toBeNull()
      expect(out.recommendation.action).toBe('route-to-feedback')
      expect(out.recommendation.command).toBeNull()
      expect(out.recommendation.message).toMatch(/No catalogue match/)
    })
  })

  describe('Validation — malformed input', () => {
    it('exits 2 on empty stdin', async () => {
      const { code, stderr } = await runWithInput('')
      expect(code).toBe(2)
      expect(stderr).toMatch(/empty input on stdin/)
    })

    it('exits 2 on invalid JSON', async () => {
      const { code, stderr } = await runWithInput('{not json')
      expect(code).toBe(2)
      expect(stderr).toMatch(/invalid JSON on stdin/)
    })

    it('exits 2 on a top-level array', async () => {
      const { code, stderr } = await runWithInput([])
      expect(code).toBe(2)
      expect(stderr).toMatch(/input must be a JSON object/)
    })

    it('exits 2 when intent is missing or empty', async () => {
      const { code, stderr } = await runWithInput({ intent: '', match: { results: [] } })
      expect(code).toBe(2)
      expect(stderr).toMatch(/input.intent must be a non-empty string/)
    })

    it('exits 2 when match is missing', async () => {
      const { code, stderr } = await runWithInput({ intent: 'foo' })
      expect(code).toBe(2)
      expect(stderr).toMatch(/input.match must be the sf modules match --json object/)
    })

    it('exits 2 when match.results is not an array', async () => {
      const { code, stderr } = await runWithInput({ intent: 'foo', match: { results: 'oops' } })
      expect(code).toBe(2)
      expect(stderr).toMatch(/input.match.results must be an array/)
    })
  })

  describe('Top-match payload shape', () => {
    it('passes through name, displayName, category, score and reasons', async () => {
      const out = await runAndParse(
        match('file uploads', [
          {
            name: 'storage',
            displayName: 'S3 Storage',
            category: 'infra',
            score: 9,
            reasons: ['keywords: file, uploads', 'alternatives: storage']
          }
        ])
      )
      expect(out.topMatch).toEqual({
        name: 'storage',
        displayName: 'S3 Storage',
        category: 'infra',
        score: 9,
        reasons: ['keywords: file, uploads', 'alternatives: storage']
      })
    })

    it('defaults reasons to [] when the match result omits them', async () => {
      const out = await runAndParse({
        intent: 'foo',
        match: { cliVersion: '1.0', intent: 'foo', results: [{ name: 'x', displayName: 'X', category: 'c', score: 7 }] }
      })
      expect(out.topMatch?.reasons).toEqual([])
    })
  })
})
