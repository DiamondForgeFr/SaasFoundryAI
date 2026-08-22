import { execFile } from 'child_process'
import path from 'path'

const SCRIPT = path.resolve(__dirname, '../../../../scaffolds/skills-templates/tool-saasfoundry/scripts/plan-challenge.js')
const NODE = process.execPath

interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

async function run(input: string): Promise<ExecResult> {
  const child = execFile(NODE, [SCRIPT])
  const out: string[] = []
  const err: string[] = []
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (c: string) => out.push(c))
  child.stderr?.on('data', (c: string) => err.push(c))
  child.stdin?.write(input)
  child.stdin?.end()
  const code = await new Promise<number>((resolve) => child.on('close', (c) => resolve(c ?? 0)))
  return { stdout: out.join(''), stderr: err.join(''), code }
}

interface Seed {
  dimension: string
  observation: string
  evidence: string
  probe: string
}
interface Plan {
  root: string | null
  revealing: boolean
  reason: string | null
  seeds: Seed[]
  cap: number
  considered: number
  dropped: number
  notes: string[]
}

/** A minimal read-poc report. Every probe reads from these fields, so overrides drive the rules. */
function report(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    root: '/tmp/poc',
    recognisable: true,
    reason: null,
    anchors: ['manifest: package.json'],
    stacks: ['node'],
    manifests: ['package.json'],
    package: { name: 'poc', description: '', scripts: {}, dependencies: [] },
    readme: { present: false, path: null, firstParagraph: null },
    entryPoints: [],
    tests: { present: true, evidence: ['test directory'] },
    git: { isRepo: false, ownRepo: false, enclosingRoot: null },
    inventory: { files: 5, directories: 1, sourceFiles: 3, authoredFiles: 5, bytes: 100, topLevel: ['src', 'package.json'], generatedPresent: [], truncated: false },
    ...overrides
  }
}

async function plan(r: Record<string, unknown>): Promise<Plan> {
  const res = await run(JSON.stringify(r))
  if (res.code !== 0) throw new Error(`expected 0, got ${res.code}: ${res.stderr}`)
  return JSON.parse(res.stdout) as Plan
}

const dimensions = (p: Plan): string[] => p.seeds.map((s) => s.dimension)

describe('plan-challenge.js', () => {
  describe('input handling', () => {
    it('exits 2 on empty stdin', async () => {
      const res = await run('')
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('empty input')
    })

    it('exits 2 on something that is not a read-poc report', async () => {
      const res = await run(JSON.stringify({ nope: 1 }))
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('report.inventory is missing')
    })

    it('accepts a wrapped report as well as a bare one', async () => {
      const res = await run(JSON.stringify({ report: report({ tests: { present: false, evidence: [] } }) }))
      expect(res.code).toBe(0)
      expect((JSON.parse(res.stdout) as Plan).seeds.length).toBeGreaterThan(0)
    })
  })

  describe('every seed is grounded in something the report actually says', () => {
    it('carries the observation and the field it came from', async () => {
      const p = await plan(report({ tests: { present: false, evidence: [] } }))
      const seed = p.seeds.find((s) => s.dimension === 'what has to be guaranteed')
      expect(seed).toBeDefined()
      expect(seed?.observation).toContain('nothing in the POC is tested')
      expect(seed?.evidence).toBe('tests.present')
      expect(seed?.probe.length).toBeGreaterThan(20)
    })

    it('quotes the POC s own words when it claims to prove something', async () => {
      const p = await plan(report({ readme: { present: true, path: 'README.md', firstParagraph: 'Proves a browser can stream mic audio under 400ms.' } }))
      const seed = p.seeds.find((s) => s.dimension === 'what was actually proven')
      expect(seed?.observation).toContain('Proves a browser can stream mic audio')
      expect(seed?.evidence).toBe('readme.firstParagraph')
    })

    it('names the dependencies behind a privacy observation', async () => {
      const p = await plan(report({ package: { name: 'p', description: '', scripts: {}, dependencies: ['@xenova/transformers', 'fluent-ffmpeg'] } }))
      const seed = p.seeds.find((s) => s.dimension === 'privacy stance')
      expect(seed?.observation).toContain('@xenova/transformers')
    })
  })

  describe('each probe stays silent when its evidence is absent', () => {
    it('does not ask about tests when the POC has them', async () => {
      const p = await plan(report({ tests: { present: true, evidence: ['test directory'] } }))
      expect(dimensions(p)).not.toContain('what has to be guaranteed')
    })

    it('does not ask about persistence when a database dependency is present', async () => {
      const p = await plan(report({ package: { name: 'p', description: '', scripts: {}, dependencies: ['@prisma/client', 'pg'] } }))
      expect(dimensions(p)).not.toContain('persistence and multi-user')
    })

    it('does not ask who the users are when an auth dependency is present', async () => {
      const p = await plan(report({ package: { name: 'p', description: '', scripts: {}, dependencies: ['jsonwebtoken', 'passport'] } }))
      expect(dimensions(p)).not.toContain('who the users are')
    })

    it('does not ask service-or-script when an HTTP framework is present', async () => {
      const p = await plan(report({ entryPoints: ['src/index.js'], package: { name: 'p', description: '', scripts: {}, dependencies: ['express'] } }))
      expect(dimensions(p)).not.toContain('service or script')
    })

    it('does not ask about layout when the source is already under src/', async () => {
      const p = await plan(report({ inventory: { ...(report().inventory as object), topLevel: ['src', 'package.json'] } }))
      expect(dimensions(p)).not.toContain('how settled the shape is')
    })

    it('asks about layout when the source sits flat', async () => {
      const p = await plan(
        report({ inventory: { files: 6, directories: 0, sourceFiles: 4, authoredFiles: 6, bytes: 1, topLevel: ['a.js', 'b.js', 'c.js', 'd.js'], generatedPresent: [], truncated: false } })
      )
      expect(dimensions(p)).toContain('how settled the shape is')
    })

    it('asks which stack survives only when there is more than one, docker aside', async () => {
      const single = await plan(report({ stacks: ['node', 'docker'] }))
      expect(dimensions(single)).not.toContain('which stack survives')
      const several = await plan(report({ stacks: ['node', 'python'] }))
      expect(dimensions(several)).toContain('which stack survives')
    })
  })

  describe('this is a conversation, not an interrogation', () => {
    it('caps the seeds and never hides what it dropped', async () => {
      // Everything true at once: proving-language, local media, no db, no auth, entry point
      // with no framework, cloud SDK, no tests, two stacks, flat layout.
      const p = await plan(
        report({
          stacks: ['node', 'python'],
          readme: { present: true, path: 'README.md', firstParagraph: 'Can we do this at all?' },
          entryPoints: ['main.js'],
          tests: { present: false, evidence: [] },
          package: { name: 'p', description: '', scripts: {}, dependencies: ['@xenova/transformers', '@aws-sdk/client-s3'] },
          inventory: { files: 6, directories: 0, sourceFiles: 4, authoredFiles: 6, bytes: 1, topLevel: ['main.js', 'a.js'], generatedPresent: [], truncated: false }
        })
      )
      expect(p.seeds.length).toBe(p.cap)
      expect(p.considered).toBeGreaterThan(p.cap)
      expect(p.dropped).toBe(p.considered - p.cap)
      expect(p.dropped).toBeGreaterThan(0)
    })

    it('keeps the most product-shaping probe first', async () => {
      const p = await plan(
        report({
          readme: { present: true, path: 'README.md', firstParagraph: 'Proves the sync survives offline.' },
          tests: { present: false, evidence: [] }
        })
      )
      expect(p.seeds[0].dimension).toBe('what was actually proven')
    })
  })

  describe('a thin POC gets honesty, not filler', () => {
    it('reveals nothing when the POC could not be read', async () => {
      const p = await plan(report({ recognisable: false, reason: 'the directory holds no files' }))
      expect(p.revealing).toBe(false)
      expect(p.seeds).toEqual([])
      expect(p.reason).toContain('could not be read')
    })

    it('refuses to call a single observation a challenge', async () => {
      const p = await plan(report({ package: { name: 'p', description: '', scripts: {}, dependencies: ['express', 'pg', 'passport'] }, tests: { present: false, evidence: [] } }))
      expect(p.seeds.length).toBe(1)
      expect(p.revealing).toBe(false)
      expect(p.reason).toContain('reveals too little')
    })

    it('says when a stack it cannot read dependencies for made the reading thinner', async () => {
      // Only package.json is parsed today, so a python POC looks emptier than it is.
      // Saying so beats letting the user think their POC was uninteresting.
      const p = await plan(report({ stacks: ['python'], manifests: ['requirements.txt'], package: null, tests: { present: false, evidence: [] } }))
      expect(p.notes.join(' ')).toContain('no dependency list was available for python')
      expect(p.revealing).toBe(false)
    })
  })
})
