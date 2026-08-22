import { execFile } from 'child_process'
import path from 'path'

const SCRIPT = path.resolve(__dirname, '../../../../scaffolds/skills-templates/tool-saasfoundry/scripts/recap.js')
const NODE = process.execPath

interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

async function run(input: unknown): Promise<ExecResult> {
  const child = execFile(NODE, [SCRIPT])
  const out: string[] = []
  const err: string[] = []
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (c: string) => out.push(c))
  child.stderr?.on('data', (c: string) => err.push(c))
  child.stdin?.write(typeof input === 'string' ? input : JSON.stringify(input))
  child.stdin?.end()
  const code = await new Promise<number>((resolve) => child.on('close', (c) => resolve(c ?? 0)))
  return { stdout: out.join(''), stderr: err.join(''), code }
}

type State = 'done' | 'pending' | 'unknown' | 'not-applicable'
interface Phase {
  phase: number
  name: string
  state: State
  exit: string | null
  blockedBy: { precondition: string; status: string; details: string | null; remediation: string | null } | null
}
interface Recap {
  current: { phase: number; name: string; state: State; next: string }
  phases: Phase[]
  blockers: Phase[]
  network: boolean
  notes: string[]
}

interface Signals {
  pocFiled?: boolean
  intakeEntries?: number | null
  manifestPath?: string | null
  srsPages?: number | null
  boardTickets?: number | null
}

async function recap(signals: Signals, opts: { network?: boolean; preconditions?: unknown[] } = {}): Promise<Recap> {
  const payload: Record<string, unknown> = {
    signals: { pocFiled: false, intakeEntries: null, manifestPath: null, srsPages: null, boardTickets: null, ...signals },
    network: opts.network !== false
  }
  if (opts.preconditions) payload.status = { report: {}, preconditions: opts.preconditions }
  const res = await run(payload)
  if (res.code !== 0) throw new Error(`expected 0, got ${res.code}: ${res.stderr}`)
  return JSON.parse(res.stdout) as Recap
}

const stateOf = (r: Recap, n: number): State => r.phases.find((p) => p.phase === n)!.state

describe('recap.js', () => {
  describe('input handling', () => {
    it('exits 2 on empty stdin', async () => {
      const res = await run('')
      expect(res.code).toBe(2)
    })

    it('refuses to guess when no signals are supplied', async () => {
      const res = await run({ network: true })
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('recap reads state, it does not guess')
    })
  })

  describe('the phase is read from state, never from the conversation', () => {
    it('starts a workspace with nothing in it at phase 1', async () => {
      const r = await recap({})
      expect(r.current.phase).toBe(1)
      expect(r.current.name).toBe('Read the POC')
      expect(r.current.next).toContain('read-poc.sh')
    })

    it('moves to the challenge once the POC is filed', async () => {
      const r = await recap({ pocFiled: true })
      expect(r.current.phase).toBe(2)
      expect(stateOf(r, 1)).toBe('done')
    })

    it('moves to the setup once the intake holds answers', async () => {
      const r = await recap({ pocFiled: true, intakeEntries: 3 })
      expect(r.current.phase).toBe(3)
      expect(stateOf(r, 2)).toBe('done')
    })

    it('does not count an intake record with no answers as a completed challenge', async () => {
      const r = await recap({ pocFiled: true, intakeEntries: 0 })
      expect(r.current.phase).toBe(2)
      expect(stateOf(r, 2)).toBe('pending')
    })

    it('moves to the SRS once a manifest exists', async () => {
      const r = await recap({ pocFiled: true, intakeEntries: 2, manifestPath: '/w/p/.saasfoundry.json', srsPages: 0, boardTickets: 0 })
      expect(stateOf(r, 3)).toBe('done')
      expect(r.current.phase).toBe(4)
    })

    it('moves to the tickets once the SRS has pages', async () => {
      const r = await recap({ pocFiled: true, intakeEntries: 2, manifestPath: '/w/p/.saasfoundry.json', srsPages: 12, boardTickets: 0 })
      expect(stateOf(r, 4)).toBe('done')
      expect(r.current.phase).toBe(5)
    })

    it('reaches the base setup once the board carries tickets', async () => {
      const r = await recap({ pocFiled: true, intakeEntries: 2, manifestPath: '/w/p/.saasfoundry.json', srsPages: 12, boardTickets: 25 })
      expect(stateOf(r, 5)).toBe('done')
      expect(r.current.phase).toBe(6)
    })
  })

  describe('a project that never had a POC is not told to go and find one', () => {
    // Without this, every existing SaaSFoundryAI project resuming the flow would be sent
    // back to phase 1 to read a POC it never had.
    it('marks phases 1 and 2 not-applicable when a manifest exists but no POC was filed', async () => {
      const r = await recap({ manifestPath: '/w/p/.saasfoundry.json', srsPages: 0, boardTickets: 0 })
      expect(stateOf(r, 1)).toBe('not-applicable')
      expect(stateOf(r, 2)).toBe('not-applicable')
      expect(r.current.phase).toBe(4)
      expect(r.notes.join(' ')).toContain('did not apply to this project')
    })

    it('still treats them as real work when a POC was filed', async () => {
      const r = await recap({ pocFiled: true, manifestPath: '/w/p/.saasfoundry.json', srsPages: 0, boardTickets: 0 })
      expect(stateOf(r, 1)).toBe('done')
      expect(stateOf(r, 2)).toBe('pending')
      expect(r.current.phase).toBe(2)
    })
  })

  describe('offline, "I could not check" beats "not done"', () => {
    it('reports the remote phases as unknown rather than pending', async () => {
      const r = await recap({ pocFiled: true, intakeEntries: 2, manifestPath: '/w/p/.saasfoundry.json' }, { network: false })
      expect(stateOf(r, 4)).toBe('unknown')
      expect(stateOf(r, 5)).toBe('unknown')
      expect(r.notes.join(' ')).toContain('do not restart work that may already exist')
    })

    it('stops the walk at the first phase it could not verify', async () => {
      // Claiming to be past a phase we could not check is how work gets redone.
      const r = await recap({ pocFiled: true, intakeEntries: 2, manifestPath: '/w/p/.saasfoundry.json' }, { network: false })
      expect(r.current.phase).toBe(4)
      expect(r.current.state).toBe('unknown')
    })

    it('treats a null count as unknown even with the network up', async () => {
      const r = await recap({ pocFiled: true, intakeEntries: 2, manifestPath: '/w/p/.saasfoundry.json', srsPages: null })
      expect(stateOf(r, 4)).toBe('unknown')
    })
  })

  describe('a failing precondition routes to the install path', () => {
    const srsMissing = [
      { name: 'manifest', description: 'Manifest present', status: 'ok', details: 'v1' },
      { name: 'srs', description: 'SRS module installed', status: 'skip', details: 'Not installed', remediation: 'Run `sf update --add-modules srs` to install the SRS module.' },
      { name: 'workflow', description: 'Workflow configured', status: 'warn', details: 'none', remediation: 'Run `sf workflow use <template>` to configure a workflow.' }
    ]

    it('attaches the precondition and its own remediation to the phase it gates', async () => {
      const r = await recap({ pocFiled: true, intakeEntries: 2, manifestPath: '/w/p/.saasfoundry.json', srsPages: 0, boardTickets: 0 }, { preconditions: srsMissing })
      const tickets = r.phases.find((p) => p.phase === 5)!
      expect(tickets.blockedBy?.precondition).toBe('workflow')
      expect(tickets.blockedBy?.remediation).toContain('sf workflow use')
    })

    it('does not treat a skipped precondition as a blocker', async () => {
      // `skip` means "not applicable / not requested", so it must not stop the flow.
      const r = await recap({ pocFiled: true, intakeEntries: 2, manifestPath: '/w/p/.saasfoundry.json', srsPages: 0, boardTickets: 0 }, { preconditions: srsMissing })
      expect(r.phases.find((p) => p.phase === 4)!.blockedBy).toBeNull()
    })

    it('reports the manifest failure that sends a fresh workspace to sf new', async () => {
      const r = await recap(
        {},
        {
          preconditions: [
            {
              name: 'manifest',
              description: 'Manifest present',
              status: 'fail',
              details: 'not found',
              remediation: 'Run `sf new` to create a new project, or `cd` into an existing SaaSFoundryAI project.'
            }
          ]
        }
      )
      const setup = r.phases.find((p) => p.phase === 3)!
      expect(setup.blockedBy?.status).toBe('fail')
      expect(setup.blockedBy?.remediation).toContain('sf new')
      expect(r.blockers.map((b) => b.phase)).toContain(3)
    })

    it('does not surface blockers for phases already behind us', async () => {
      const r = await recap(
        { pocFiled: true, intakeEntries: 2, manifestPath: '/w/p/.saasfoundry.json', srsPages: 5, boardTickets: 3 },
        { preconditions: [{ name: 'manifest', description: 'Manifest present', status: 'warn', details: 'x', remediation: 'y' }] }
      )
      expect(r.current.phase).toBe(6)
      expect(r.blockers).toEqual([])
    })

    it('says so when no preconditions could be read at all', async () => {
      const r = await recap({ pocFiled: true })
      expect(r.notes.join(' ')).toContain('no sf status payload was supplied')
    })
  })

  describe('every phase carries a checkable exit', () => {
    it('names an exit for each phase that has one', async () => {
      const r = await recap({})
      for (const phase of r.phases.slice(0, 6)) {
        expect(typeof phase.exit).toBe('string')
        expect((phase.exit as string).length).toBeGreaterThan(10)
      }
    })
  })
})
