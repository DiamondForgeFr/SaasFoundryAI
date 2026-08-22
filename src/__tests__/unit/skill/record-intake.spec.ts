import { execFile } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const SCRIPT = path.resolve(__dirname, '../../../../scaffolds/skills-templates/tool-saasfoundry/scripts/record-intake.js')
const WRAPPER = path.resolve(__dirname, '../../../../scaffolds/skills-templates/tool-saasfoundry/scripts/record-intake.sh')
const NODE = process.execPath

interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

async function exec(cmd: string, args: string[], input: string): Promise<ExecResult> {
  const child = execFile(cmd, args)
  const out: string[] = []
  const err: string[] = []
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (c: string) => out.push(c))
  child.stderr?.on('data', (c: string) => err.push(c))
  child.stdin?.on('error', () => {
    /* the script may exit before reading stdin; that is the behaviour under test */
  })
  child.stdin?.write(input)
  child.stdin?.end()
  const code = await new Promise<number>((resolve) => child.on('close', (c) => resolve(c ?? 0)))
  return { stdout: out.join(''), stderr: err.join(''), code }
}

const run = (input: unknown): Promise<ExecResult> => exec(NODE, [SCRIPT], JSON.stringify(input))
const runWrapper = (args: string[], input: unknown): Promise<ExecResult> => exec('bash', [WRAPPER, ...args], JSON.stringify(input))

interface Record_ {
  version: number
  root: string | null
  entries: Array<{ dimension: string; observation: string; evidence: string | null; question: string; answer: string }>
  unanswered: string[]
  notes: string[]
}

const SEEDS = [
  { dimension: 'privacy stance', observation: 'processing runs locally — @xenova/transformers', evidence: 'package.dependencies', probe: '…' },
  { dimension: 'persistence and multi-user', observation: 'no database among the dependencies', evidence: 'package.dependencies', probe: '…' },
  { dimension: 'what has to be guaranteed', observation: 'nothing in the POC is tested', evidence: 'tests.present', probe: '…' }
]

const answer = (dimension: string) => ({ dimension, question: 'What about ' + dimension + '?', answer: 'Yes, it matters.' })

describe('record-intake.js', () => {
  describe('the link back to the observation', () => {
    // The acceptance criterion is "every question names the observation it comes from".
    // That is easy to honour while asking and easy to lose by the time anything is
    // written down, so it is enforced where the conversation becomes an artefact.
    it('refuses an answer that references no seed, and says where it belongs instead', async () => {
      const res = await run({ seeds: SEEDS, answers: [{ dimension: 'pricing model', question: 'How will you charge?', answer: 'Per seat.' }] })
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('is not one of the seeds')
      expect(res.stderr).toContain('must trace back to something the POC actually showed')
      expect(res.stderr).toContain('belongs in the SRS conversation')
      expect(res.stderr).toContain('"privacy stance"')
    })

    it('copies the observation and evidence onto every recorded answer', async () => {
      const res = await run({ seeds: SEEDS, answers: [answer('privacy stance')], root: '/tmp/poc' })
      expect(res.code).toBe(0)
      const record = JSON.parse(res.stdout) as Record_
      expect(record.entries[0].observation).toBe('processing runs locally — @xenova/transformers')
      expect(record.entries[0].evidence).toBe('package.dependencies')
      expect(record.root).toBe('/tmp/poc')
    })

    it('records what was actually asked, not just the seed', async () => {
      const res = await run({ seeds: SEEDS, answers: [{ dimension: 'privacy stance', question: '', answer: 'yes' }] })
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('record what was actually asked')
    })
  })

  describe('what it will not record', () => {
    it('rejects an empty answer rather than storing one', async () => {
      const res = await run({ seeds: SEEDS, answers: [{ dimension: 'privacy stance', question: 'q?', answer: '   ' }] })
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('leave it out entirely')
    })

    it('rejects the same dimension answered twice', async () => {
      const res = await run({ seeds: SEEDS, answers: [answer('privacy stance'), answer('privacy stance')] })
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('twice')
    })

    it('rejects seeds that did not come from plan-challenge', async () => {
      const res = await run({ seeds: [{ dimension: 'x' }], answers: [] })
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('pass plan-challenge output through unchanged')
    })

    it('exits 2 on empty stdin', async () => {
      const res = await run('')
      expect(res.code).toBe(2)
    })
  })

  describe('an unfinished conversation is still a record', () => {
    it('names what went unanswered instead of pretending it was covered', async () => {
      const res = await run({ seeds: SEEDS, answers: [answer('privacy stance')] })
      const record = JSON.parse(res.stdout) as Record_
      expect(record.entries).toHaveLength(1)
      expect(record.unanswered).toEqual(['persistence and multi-user', 'what has to be guaranteed'])
    })

    it('accepts a conversation the user declined entirely', async () => {
      const res = await run({ seeds: SEEDS, answers: [] })
      expect(res.code).toBe(0)
      const record = JSON.parse(res.stdout) as Record_
      expect(record.entries).toEqual([])
      expect(record.unanswered).toHaveLength(3)
    })

    it('carries the reading s notes through to the record', async () => {
      const res = await run({ seeds: SEEDS, answers: [], notes: ['no dependency list was available for python'] })
      expect((JSON.parse(res.stdout) as Record_).notes).toEqual(['no dependency list was available for python'])
    })
  })
})

describe('record-intake.sh', () => {
  const workspace = () => mkdtempSync(path.join(tmpdir(), 'sf-intake-'))

  it('writes the record to --out', async () => {
    const dir = workspace()
    const out = path.join(dir, 'intake.json')
    const res = await runWrapper(['--out', out], { seeds: SEEDS, answers: [answer('privacy stance')] })
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('1 answer(s) recorded')
    const record = JSON.parse(readFileSync(out, 'utf8')) as Record_
    expect(record.entries[0].dimension).toBe('privacy stance')
  })

  it('refuses to overwrite an existing record', async () => {
    // The intake is the only written trace of a conversation nobody will have twice.
    const dir = workspace()
    const out = path.join(dir, 'intake.json')
    writeFileSync(out, '{"version":1,"entries":[{"keep":"me"}]}')

    const res = await runWrapper(['--out', out], { seeds: SEEDS, answers: [answer('privacy stance')] })

    expect(res.code).toBe(2)
    expect(res.stderr).toContain('refusing to overwrite')
    expect(readFileSync(out, 'utf8')).toContain('keep')
  })

  it('writes nothing when the record is refused', async () => {
    const dir = workspace()
    const out = path.join(dir, 'intake.json')
    const res = await runWrapper(['--out', out], { seeds: SEEDS, answers: [{ dimension: 'pricing model', question: 'q?', answer: 'a' }] })
    expect(res.code).not.toBe(0)
    expect(existsSync(out)).toBe(false)
  })

  it('exits 2 on an unknown flag', async () => {
    const res = await runWrapper(['--force'], { seeds: SEEDS, answers: [] })
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('unknown flag')
  })
})
