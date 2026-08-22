import { execFile } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const READ = path.resolve(__dirname, '../../../../scaffolds/skills-templates/tool-saasfoundry/scripts/read-poc.js')
const PLAN = path.resolve(__dirname, '../../../../scaffolds/skills-templates/tool-saasfoundry/scripts/plan-poc-move.js')
const NODE = process.execPath

interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

async function run(script: string, args: string[], input?: string): Promise<ExecResult> {
  const child = execFile(NODE, [script, ...args])
  const out: string[] = []
  const err: string[] = []
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (c: string) => out.push(c))
  child.stderr?.on('data', (c: string) => err.push(c))
  if (input !== undefined) {
    child.stdin?.write(input)
    child.stdin?.end()
  }
  const code = await new Promise<number>((resolve) => child.on('close', (c) => resolve(c ?? 0)))
  return { stdout: out.join(''), stderr: err.join(''), code }
}

interface Plan {
  root: string
  destination: string
  refused: boolean
  refusals: string[]
  warnings: string[]
  moves: Array<{ from: string; to: string; type: 'file' | 'dir' }>
  keepsGit: boolean
  entriesMoved: number
  resultingTree: string[]
  undo: string
}

function fixture(tree: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sf-poc-plan-'))
  for (const [rel, content] of Object.entries(tree)) {
    const abs = path.join(root, rel)
    if (rel.endsWith('/')) {
      mkdirSync(abs, { recursive: true })
      continue
    }
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

async function planFor(dir: string, destination?: string): Promise<{ plan: Plan; code: number }> {
  const report = await run(READ, [dir])
  expect(report.code).toBe(0)
  const payload = destination ? JSON.stringify({ report: JSON.parse(report.stdout), destination }) : report.stdout
  const res = await run(PLAN, [], payload)
  return { plan: JSON.parse(res.stdout) as Plan, code: res.code }
}

describe('plan-poc-move.js', () => {
  describe('input handling', () => {
    it('exits 2 on empty stdin', async () => {
      const res = await run(PLAN, [], '')
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('empty input')
    })

    it('exits 2 on malformed JSON', async () => {
      const res = await run(PLAN, [], '{ nope')
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('invalid JSON')
    })

    it('exits 2 when the payload is not a read-poc report', async () => {
      const res = await run(PLAN, [], JSON.stringify({ something: 'else' }))
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('report.root is missing')
    })

    it('accepts a bare read-poc report, not only a wrapped one', async () => {
      const { plan, code } = await planFor(fixture({ 'package.json': '{}', 'i.js': 'x' }))
      expect(code).toBe(0)
      expect(plan.destination).toBe('POC')
    })

    it('rejects a destination that is a path rather than a name', async () => {
      const report = await run(READ, [fixture({ 'a.js': 'x' })])
      const res = await run(PLAN, [], JSON.stringify({ report: JSON.parse(report.stdout), destination: '../escape' }))
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('single directory name')
    })
  })

  describe('the plan', () => {
    it('lists every top-level entry, dotfiles and .git included', async () => {
      const { plan } = await planFor(
        fixture({ 'package.json': '{}', 'src/a.js': 'x', '.env': 'K=v', '.git/HEAD': 'ref: refs/heads/main\n', 'README.md': '# r\n\nProves X.\n' })
      )
      expect(plan.moves.map((m) => m.from).sort()).toEqual(['.env', '.git', 'README.md', 'package.json', 'src'])
      expect(plan.entriesMoved).toBe(5)
      expect(plan.moves.find((m) => m.from === 'src')?.type).toBe('dir')
      expect(plan.moves.find((m) => m.from === '.env')?.type).toBe('file')
    })

    it('says the folder holds exactly the destination afterwards', async () => {
      const { plan } = await planFor(fixture({ 'a.js': 'x', 'b.js': 'y', 'c.js': 'z' }))
      expect(plan.resultingTree).toEqual(['POC/'])
      expect(plan.undo).toContain('reverses exactly')
    })

    it('honours a custom destination', async () => {
      const { plan, code } = await planFor(fixture({ 'a.js': 'x', 'b.js': 'y', 'c.js': 'z' }), 'prototype')
      expect(code).toBe(0)
      expect(plan.destination).toBe('prototype')
      expect(plan.moves[0].to.startsWith('prototype/')).toBe(true)
    })

    it('flags that the repository travels with its files', async () => {
      const { plan } = await planFor(fixture({ 'package.json': '{}', '.git/HEAD': 'ref: refs/heads/main\n' }))
      expect(plan.keepsGit).toBe(true)
      expect(plan.warnings.join(' ')).toContain('history is preserved in full')
    })

    it('does not describe .git as a generated directory', async () => {
      // It gets its own note; calling a repository "generated" would be wrong and alarming.
      const { plan } = await planFor(fixture({ 'package.json': '{}', '.git/HEAD': 'x' }))
      expect(plan.warnings.join(' ')).not.toContain('generated directories')
    })
  })

  describe('refusals — each one guards work that exists in no other copy', () => {
    it('refuses when the destination already exists, rather than merging into it', async () => {
      const { plan, code } = await planFor(fixture({ 'package.json': '{}', 'i.js': 'x', 'POC/old.txt': 'previous' }))
      expect(code).toBe(2)
      expect(plan.refused).toBe(true)
      expect(plan.refusals.join(' ')).toContain('already exists')
      expect(plan.refusals.join(' ')).toContain('Nothing is merged or overwritten')
    })

    it('refuses on a folder that is already a SaaSFoundryAI project', async () => {
      const { plan, code } = await planFor(fixture({ '.saasfoundry.json': '{"projectName":"x"}', 'package.json': '{}' }))
      expect(code).toBe(2)
      expect(plan.refusals.join(' ')).toContain('already a SaaSFoundryAI project')
      expect(plan.refusals.join(' ')).toContain('sf update')
    })

    it('refuses when there is nothing to move', async () => {
      const { plan, code } = await planFor(fixture({ 'placeholder/': '' }))
      expect(code).toBe(2)
      expect(plan.refusals.join(' ')).toContain('nothing to move')
    })

    it('refuses when the POC sits inside another repository', async () => {
      // The destructive case: moving it rewrites paths in a repo nobody pointed us at.
      const root = fixture({ '.git/HEAD': 'ref: refs/heads/main\n', 'sub/package.json': '{}', 'sub/i.js': 'x' })
      const { plan, code } = await planFor(path.join(root, 'sub'))
      expect(code).toBe(2)
      expect(plan.refusals.join(' ')).toContain('inside another git repository')
    })
  })

  describe('warnings never block', () => {
    it('plans the move of an unreadable folder, but says it could not be read', async () => {
      const { plan, code } = await planFor(fixture({ 'notes.txt': 'a', 'data.csv': 'b' }))
      expect(code).toBe(0)
      expect(plan.refused).toBe(false)
      expect(plan.warnings.join(' ')).toContain('not recognisable as a POC')
      expect(plan.entriesMoved).toBe(2)
    })
  })
})
