import { execFile, execFileSync } from 'child_process'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const SCRIPT = path.resolve(__dirname, '../../../../scaffolds/skills-templates/tool-saasfoundry/scripts/move-poc.sh')

interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

async function move(args: string[]): Promise<ExecResult> {
  const child = execFile('bash', [SCRIPT, ...args])
  const out: string[] = []
  const err: string[] = []
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (c: string) => out.push(c))
  child.stderr?.on('data', (c: string) => err.push(c))
  const code = await new Promise<number>((resolve) => child.on('close', (c) => resolve(c ?? 0)))
  return { stdout: out.join(''), stderr: err.join(''), code }
}

function fixture(tree: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sf-move-poc-'))
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

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
  }).trim()
}

const entries = (dir: string): string[] => readdirSync(dir).sort()

describe('move-poc.sh', () => {
  describe('nothing moves without --confirm', () => {
    // The POC is normally local-only: no remote, often no history. An unconfirmed move
    // that went ahead would destroy the only copy, so the default has to be "do nothing".
    it('prints the plan, exits 2, and leaves the folder untouched', async () => {
      const root = fixture({ 'package.json': '{}', 'src/a.js': 'x', 'README.md': '# r\n\nProves X.\n' })
      const before = entries(root)

      const res = await move([root])

      expect(res.code).toBe(2)
      expect(res.stdout).toContain('POC intake plan for')
      expect(res.stdout).toContain('3 top-level entries move into POC/')
      expect(res.stderr).toContain('Re-run with --confirm')
      expect(entries(root)).toEqual(before)
      expect(existsSync(path.join(root, 'POC'))).toBe(false)
    })
  })

  describe('a confirmed move', () => {
    it('files every entry away and leaves exactly the destination behind', async () => {
      const root = fixture({ 'package.json': '{"name":"poc"}', 'src/a.js': 'x', 'README.md': '# r\n\nProves X.\n', '.env': 'K=v' })

      const res = await move([root, '--confirm'])

      expect(res.code).toBe(0)
      expect(entries(root)).toEqual(['POC'])
      expect(entries(path.join(root, 'POC'))).toEqual(['.env', 'README.md', 'package.json', 'src'])
      expect(readFileSync(path.join(root, 'POC/src/a.js'), 'utf8')).toBe('x')
      expect(res.stdout).toContain('the result matches the plan')
      expect(res.stdout).toContain('To reverse')
    })

    it('moves entries whose names contain spaces', async () => {
      // A POC folder is exactly where "my notes.md" lives.
      const root = fixture({ 'my notes.md': 'n', 'a.js': 'x', 'b.js': 'y' })

      const res = await move([root, '--confirm'])

      expect(res.code).toBe(0)
      expect(entries(path.join(root, 'POC'))).toEqual(['a.js', 'b.js', 'my notes.md'])
    })

    it('honours a custom destination', async () => {
      const root = fixture({ 'a.js': 'x', 'b.js': 'y', 'c.js': 'z' })

      const res = await move([root, '--destination', 'prototype', '--confirm'])

      expect(res.code).toBe(0)
      expect(entries(root)).toEqual(['prototype'])
    })

    it('carries a git repository across intact, with a clean tree and its history', async () => {
      // This is the property the whole layout decision rests on: git resolves tracked
      // paths relative to its own root, so moving the working tree with .git inside it
      // rewrites nothing. Asserted rather than assumed.
      const root = fixture({ 'package.json': '{}', 'src/a.js': 'x' })
      git(root, ['init', '-q'])
      git(root, ['add', '-A'])
      git(root, ['commit', '-qm', 'the poc'])

      const res = await move([root, '--confirm'])
      expect(res.code).toBe(0)

      const moved = path.join(root, 'POC')
      expect(git(moved, ['status', '--porcelain'])).toBe('')
      expect(git(moved, ['log', '--oneline'])).toContain('the poc')
      expect(git(moved, ['rev-parse', '--show-toplevel'])).toContain('POC')
    })
  })

  describe('refusals leave the folder exactly as it was', () => {
    it('refuses rather than merging into an existing destination', async () => {
      const root = fixture({ 'package.json': '{}', 'a.js': 'x', 'POC/previous.txt': 'do not lose me' })
      const before = entries(root)

      const res = await move([root, '--confirm'])

      expect(res.code).toBe(2)
      expect(res.stdout).toContain('REFUSED')
      expect(entries(root)).toEqual(before)
      // The pre-existing content is untouched — this is the whole point of the refusal.
      expect(readFileSync(path.join(root, 'POC/previous.txt'), 'utf8')).toBe('do not lose me')
    })

    it('refuses on a folder that is already a SaaSFoundryAI project', async () => {
      const root = fixture({ '.saasfoundry.json': '{"projectName":"live"}', 'package.json': '{}' })
      const before = entries(root)

      const res = await move([root, '--confirm'])

      expect(res.code).toBe(2)
      expect(res.stdout).toContain('already a SaaSFoundryAI project')
      expect(entries(root)).toEqual(before)
    })

    it('refuses when the POC sits inside another repository', async () => {
      const outer = fixture({ 'sub/package.json': '{}', 'sub/a.js': 'x' })
      git(outer, ['init', '-q'])
      const inner = path.join(outer, 'sub')
      const before = entries(inner)

      const res = await move([inner, '--confirm'])

      expect(res.code).toBe(2)
      expect(res.stdout).toContain('inside another git repository')
      expect(entries(inner)).toEqual(before)
    })

    it('exits 2 on a directory that does not exist', async () => {
      const res = await move([path.join(tmpdir(), 'sf-move-poc-absent-' + Date.now()), '--confirm'])
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('no such directory')
    })

    it('exits 2 on an unknown flag rather than guessing', async () => {
      const root = fixture({ 'a.js': 'x' })
      const res = await move([root, '--force'])
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('unknown flag')
      expect(entries(root)).toEqual(['a.js'])
    })
  })
})
