import { execFile } from 'child_process'
import path from 'path'

const SCRIPT = path.resolve(__dirname, '../../../../scaffolds/skills-templates/tool-saasfoundry/scripts/plan-feedback-request.js')
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

type Answer = 'yes' | 'no' | 'unclear'

interface Scorecard {
  scopeFit: Answer
  reusability: Answer
  notAlreadySolvable: Answer
  opinionOwnership: Answer
  maintenanceRealism: Answer
}

interface ExistingIssue {
  number: number
  title: string
  state?: string
  url?: string
}

interface Decision {
  intent: string
  name: string
  decision: 'file-request' | 'route-to-existing' | 'refuse'
  redFlags: Array<{ criterion: string; answer: Answer; reason: string }>
  duplicate: { number: number; title: string; url: string | null; state: string | null } | null
  recommendation: {
    action: 'run-command' | 'route-to-existing' | 'refuse'
    command: string | null
    message: string
  }
}

function allGreen(): Scorecard {
  return {
    scopeFit: 'yes',
    reusability: 'yes',
    notAlreadySolvable: 'yes',
    opinionOwnership: 'yes',
    maintenanceRealism: 'yes'
  }
}

async function runAndParse(input: unknown): Promise<Decision & ExecResult> {
  const res = await runWithInput(input)
  if (res.code !== 0) {
    throw new Error(`Expected success, got code=${res.code}, stderr=${res.stderr}`)
  }
  return { ...res, ...(JSON.parse(res.stdout) as Decision) }
}

describe('skill/plan-feedback-request', () => {
  describe('Decision: file-request (all-green, no duplicate)', () => {
    it('emits the sf feedback request command when scorecard is fully green', async () => {
      const out = await runAndParse({
        intent: 'real-time chat between project members',
        name: 'chat',
        scorecard: allGreen(),
        existingIssues: []
      })
      expect(out.decision).toBe('file-request')
      expect(out.redFlags).toEqual([])
      expect(out.duplicate).toBeNull()
      expect(out.recommendation.action).toBe('run-command')
      expect(out.recommendation.command).toBe('sf feedback request chat')
      expect(out.recommendation.message).toMatch(/Scorecard all green/)
    })

    it('appends --description when provided and escapes inner double quotes', async () => {
      const out = await runAndParse({
        intent: 'invoicing',
        name: 'billing',
        description: 'first-party "billing" with Stripe adapter',
        scorecard: allGreen(),
        existingIssues: []
      })
      expect(out.recommendation.command).toBe('sf feedback request billing --description "first-party \\"billing\\" with Stripe adapter"')
    })
  })

  describe('Decision: route-to-existing (duplicate found)', () => {
    it('routes to a duplicate when the name appears in an existing title', async () => {
      const out = await runAndParse({
        intent: 'real-time chat',
        name: 'chat',
        scorecard: allGreen(),
        existingIssues: [{ number: 42, title: '[request] chat module', state: 'OPEN', url: 'https://example/42' }]
      })
      expect(out.decision).toBe('route-to-existing')
      expect(out.recommendation.action).toBe('route-to-existing')
      expect(out.recommendation.command).toBeNull()
      expect(out.duplicate).toEqual({ number: 42, title: '[request] chat module', state: 'OPEN', url: 'https://example/42' })
      expect(out.recommendation.message).toMatch(/Duplicate found/)
      expect(out.recommendation.message).toMatch(/#42/)
    })

    it('matches on intent tokens (≥4 chars) when the title does not contain the name', async () => {
      const out = await runAndParse({
        intent: 'billing and invoicing with Stripe',
        name: 'stripe',
        scorecard: allGreen(),
        existingIssues: [{ number: 7, title: '[request] invoicing workflow', state: 'OPEN' }]
      })
      expect(out.decision).toBe('route-to-existing')
      expect(out.duplicate?.number).toBe(7)
    })

    it('ignores existing issues whose titles do not match name or intent tokens', async () => {
      const out = await runAndParse({
        intent: 'presence indicators',
        name: 'presence',
        scorecard: allGreen(),
        existingIssues: [{ number: 99, title: '[request] dark-mode preset', state: 'OPEN' }]
      })
      expect(out.decision).toBe('file-request')
      expect(out.duplicate).toBeNull()
    })
  })

  describe('Decision: refuse (red flags)', () => {
    it('refuses when one criterion is "no" and lists the red flag', async () => {
      const out = await runAndParse({
        intent: 'send emails',
        name: 'smtp',
        scorecard: { ...allGreen(), notAlreadySolvable: 'no' },
        existingIssues: []
      })
      expect(out.decision).toBe('refuse')
      expect(out.redFlags).toHaveLength(1)
      expect(out.redFlags[0].criterion).toBe('notAlreadySolvable')
      expect(out.redFlags[0].answer).toBe('no')
      expect(out.redFlags[0].reason).toMatch(/Already solvable/)
      expect(out.recommendation.action).toBe('refuse')
      expect(out.recommendation.command).toBeNull()
      expect(out.recommendation.message).toMatch(/1 red flag/)
    })

    it('refuses on "unclear" — treats it as an open question, not a soft-pass', async () => {
      const out = await runAndParse({
        intent: 'multiplayer whiteboard',
        name: 'whiteboard',
        scorecard: { ...allGreen(), maintenanceRealism: 'unclear' },
        existingIssues: []
      })
      expect(out.decision).toBe('refuse')
      expect(out.redFlags[0]).toMatchObject({ criterion: 'maintenanceRealism', answer: 'unclear' })
      expect(out.redFlags[0].reason).toMatch(/Maintenance risk/)
    })

    it('accumulates multiple red flags when several criteria fail', async () => {
      const out = await runAndParse({
        intent: 'bespoke crypto wallet',
        name: 'wallet',
        scorecard: {
          scopeFit: 'no',
          reusability: 'no',
          notAlreadySolvable: 'yes',
          opinionOwnership: 'unclear',
          maintenanceRealism: 'yes'
        },
        existingIssues: []
      })
      expect(out.decision).toBe('refuse')
      expect(out.redFlags.map((f) => f.criterion)).toEqual(['scopeFit', 'reusability', 'opinionOwnership'])
      expect(out.recommendation.message).toMatch(/3 red flags/)
    })

    it('prefers refusal over dedup when both would apply', async () => {
      const out = await runAndParse({
        intent: 'chat',
        name: 'chat',
        scorecard: { ...allGreen(), scopeFit: 'no' },
        existingIssues: [{ number: 42, title: '[request] chat' } as ExistingIssue]
      })
      expect(out.decision).toBe('refuse')
      expect(out.duplicate).toBeNull()
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
      const { code, stderr } = await runWithInput({ intent: '', name: 'x', scorecard: allGreen() })
      expect(code).toBe(2)
      expect(stderr).toMatch(/input.intent must be a non-empty string/)
    })

    it('exits 2 when name is missing', async () => {
      const { code, stderr } = await runWithInput({ intent: 'foo', scorecard: allGreen() })
      expect(code).toBe(2)
      expect(stderr).toMatch(/input.name must be a non-empty string/)
    })

    it('exits 2 when scorecard is missing', async () => {
      const { code, stderr } = await runWithInput({ intent: 'foo', name: 'bar' })
      expect(code).toBe(2)
      expect(stderr).toMatch(/input.scorecard must be an object with 5 criteria/)
    })

    it('exits 2 when a scorecard criterion is absent', async () => {
      const partial = { ...allGreen() } as Partial<Scorecard>
      delete partial.reusability
      const { code, stderr } = await runWithInput({ intent: 'foo', name: 'bar', scorecard: partial })
      expect(code).toBe(2)
      expect(stderr).toMatch(/input.scorecard.reusability must be one of/)
    })

    it('exits 2 when a scorecard criterion has an unexpected value', async () => {
      const { code, stderr } = await runWithInput({
        intent: 'foo',
        name: 'bar',
        scorecard: { ...allGreen(), opinionOwnership: 'maybe' }
      })
      expect(code).toBe(2)
      expect(stderr).toMatch(/input.scorecard.opinionOwnership must be one of/)
    })
  })

  describe('Output payload shape', () => {
    it('passes through the full duplicate fields when the issue carries them', async () => {
      const out = await runAndParse({
        intent: 'chat',
        name: 'chat',
        scorecard: allGreen(),
        existingIssues: [{ number: 42, title: '[request] chat', state: 'OPEN', url: 'https://gh/42' }]
      })
      expect(out.duplicate).toEqual({ number: 42, title: '[request] chat', state: 'OPEN', url: 'https://gh/42' })
    })

    it('defaults duplicate.url and duplicate.state to null when not provided', async () => {
      const out = await runAndParse({
        intent: 'chat',
        name: 'chat',
        scorecard: allGreen(),
        existingIssues: [{ number: 7, title: '[request] chat' }]
      })
      expect(out.duplicate).toEqual({ number: 7, title: '[request] chat', url: null, state: null })
    })
  })
})
