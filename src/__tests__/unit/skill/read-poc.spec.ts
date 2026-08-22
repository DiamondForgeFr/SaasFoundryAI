import { execFile } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const SCRIPT = path.resolve(__dirname, '../../../../scaffolds/skills-templates/tool-saasfoundry/scripts/read-poc.js')
const NODE = process.execPath

interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

async function run(dir: string): Promise<ExecResult> {
  const child = execFile(NODE, [SCRIPT, dir])
  const out: string[] = []
  const err: string[] = []
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (c: string) => out.push(c))
  child.stderr?.on('data', (c: string) => err.push(c))
  const code = await new Promise<number>((resolve) => child.on('close', (c) => resolve(c ?? 0)))
  return { stdout: out.join(''), stderr: err.join(''), code }
}

interface Report {
  root: string
  recognisable: boolean
  reason: string | null
  anchors: string[]
  stacks: string[]
  manifests: string[]
  package: { name: string | null; description: string | null; scripts: Record<string, string>; dependencies: string[]; malformed?: boolean } | null
  readme: { present: boolean; path: string | null; firstParagraph: string | null }
  entryPoints: string[]
  tests: { present: boolean; evidence: string[] }
  git: { isRepo: boolean; ownRepo: boolean; enclosingRoot: string | null }
  inventory: {
    files: number
    directories: number
    sourceFiles: number
    authoredFiles: number
    bytes: number
    topLevel: string[]
    generatedPresent: string[]
    truncated: boolean
  }
}

async function read(dir: string): Promise<Report> {
  const res = await run(dir)
  if (res.code !== 0) throw new Error(`expected success, got code=${res.code} stderr=${res.stderr}`)
  return JSON.parse(res.stdout) as Report
}

/** Builds a throwaway directory tree. Keys are relative paths; a trailing '/' means a directory. */
function fixture(tree: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sf-poc-'))
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

describe('read-poc.js', () => {
  describe('input handling', () => {
    it('exits 2 when no directory is given', async () => {
      const res = await run('')
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('usage')
    })

    it('exits 2 on a directory that does not exist', async () => {
      const res = await run(path.join(tmpdir(), 'sf-poc-does-not-exist-' + Date.now()))
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('cannot read directory')
    })

    it('exits 2 when the target is a file, not a directory', async () => {
      const root = fixture({ 'a.txt': 'x' })
      const res = await run(path.join(root, 'a.txt'))
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('not a directory')
    })
  })

  describe('the recognisability verdict', () => {
    // This is the load-bearing part: the whole point is that an assistant cannot invent a
    // purpose for a folder that has none. `recognisable:false` must be a finding (exit 0),
    // never an error, so the skill reports it rather than treating it as a failed read.
    it('reports a directory with no files as unrecognisable, and still exits 0', async () => {
      // An empty subdirectory is not content, so the wording says "no files" rather than
      // "empty" — the user reads this message and it should match what they see.
      const res = await run(fixture({ 'placeholder/': '' }))
      expect(res.code).toBe(0)
      const report = JSON.parse(res.stdout) as Report
      expect(report.recognisable).toBe(false)
      expect(report.reason).toBe('the directory holds no files')
    })

    it('refuses to read a purpose from loose non-source files', async () => {
      const report = await read(fixture({ 'notes.txt': 'some notes', 'data.csv': 'a,b\n1,2' }))
      expect(report.recognisable).toBe(false)
      expect(report.reason).toContain('no source file')
      expect(report.anchors).toEqual([])
    })

    it('does not count tool-authored lockfiles as authored work', async () => {
      // A folder holding only a lockfile and one script is not a readable POC. If lockfiles
      // counted, the authored-file threshold would be met by files nobody wrote.
      const report = await read(fixture({ 'package-lock.json': '{}', 'yarn.lock': '', 'run.sh': 'echo hi' }))
      expect(report.recognisable).toBe(false)
      expect(report.inventory.files).toBe(3)
      expect(report.inventory.authoredFiles).toBe(1)
    })

    it('accepts a README with prose as an anchor on its own', async () => {
      const report = await read(fixture({ 'README.md': '# thing\n\nProves the sync protocol survives a 30s offline window.\n' }))
      expect(report.recognisable).toBe(true)
      expect(report.anchors).toContain('README with prose')
      expect(report.readme.firstParagraph).toBe('Proves the sync protocol survives a 30s offline window.')
    })

    it('does not accept a README that is only headings and badges', async () => {
      const report = await read(fixture({ 'README.md': '# title\n\n![badge](x.png)\n\n> quoted\n' }))
      expect(report.readme.present).toBe(true)
      expect(report.readme.firstParagraph).toBeNull()
      expect(report.recognisable).toBe(false)
    })

    it('ignores filesystem noise when counting authored files', async () => {
      // A .DS_Store next to two loose files would otherwise reach the three-file threshold
      // and make a folder look readable on macOS but not on Linux.
      const report = await read(fixture({ '.DS_Store': 'x', 'a.js': 'let a', 'b.js': 'let b' }))
      expect(report.inventory.files).toBe(2)
      expect(report.recognisable).toBe(false)
    })

    it('accepts a manifest as an anchor even with no README', async () => {
      const report = await read(fixture({ 'go.mod': 'module example.com/poc\n' }))
      expect(report.recognisable).toBe(true)
      expect(report.stacks).toEqual(['go'])
      expect(report.anchors[0]).toContain('go.mod')
    })
  })

  describe('evidence gathering', () => {
    const nodePoc = () =>
      fixture({
        'package.json': JSON.stringify({
          name: 'live-notes-poc',
          description: 'Can we transcribe a meeting in real time?',
          scripts: { dev: 'vite' },
          dependencies: { ws: '^8' },
          devDependencies: { vite: '^5' }
        }),
        'README.md': '# live-notes\n\nProves a browser can stream mic audio and render partial transcripts under 400ms.\n',
        'src/index.js': 'console.log(1)',
        'tests/sync.spec.js': 'it("works", () => {})',
        'package-lock.json': '{}',
        'node_modules/ws/index.js': 'module.exports = {}'
      })

    it('parses the package manifest into name, description, scripts and dependencies', async () => {
      const report = await read(nodePoc())
      expect(report.package?.name).toBe('live-notes-poc')
      expect(report.package?.description).toBe('Can we transcribe a meeting in real time?')
      expect(report.package?.scripts).toEqual({ dev: 'vite' })
      expect(report.package?.dependencies).toEqual(['vite', 'ws'])
    })

    it('finds conventional entry points and test evidence', async () => {
      const report = await read(nodePoc())
      expect(report.entryPoints).toEqual(['src/index.js'])
      expect(report.tests.present).toBe(true)
      expect(report.tests.evidence).toContain('test directory')
      expect(report.tests.evidence).toContain('*.spec / *.test files')
    })

    it('records generated directories without walking into them', async () => {
      const report = await read(nodePoc())
      expect(report.inventory.generatedPresent).toContain('node_modules')
      // 4 authored + 1 lockfile; nothing from node_modules
      expect(report.inventory.files).toBe(5)
      expect(report.inventory.authoredFiles).toBe(4)
      expect(report.inventory.topLevel).not.toContain('node_modules')
    })

    it('survives a malformed package.json instead of crashing', async () => {
      const report = await read(fixture({ 'package.json': '{ this is not json', 'src/main.ts': 'export {}' }))
      expect(report.package?.malformed).toBe(true)
      expect(report.stacks).toEqual(['node'])
      expect(report.recognisable).toBe(true)
    })

    it('detects several stacks in one folder', async () => {
      const report = await read(fixture({ 'package.json': '{}', 'requirements.txt': 'flask\n', Dockerfile: 'FROM node' }))
      expect(report.stacks).toEqual(expect.arrayContaining(['node', 'python', 'docker']))
    })
  })

  describe('git detection', () => {
    it('reports a POC that owns its repository', async () => {
      const root = fixture({ 'package.json': '{}', '.git/HEAD': 'ref: refs/heads/main\n' })
      const report = await read(root)
      expect(report.git.isRepo).toBe(true)
      expect(report.git.ownRepo).toBe(true)
    })

    it('reports a POC sitting inside somebody else s repository', async () => {
      // The destructive case. Moving this POC would rewrite paths in a repository nobody
      // pointed us at, so the move planner has to be able to see it and refuse.
      const root = fixture({ '.git/HEAD': 'ref: refs/heads/main\n', 'sub/package.json': '{}' })
      const report = await read(path.join(root, 'sub'))
      expect(report.git.isRepo).toBe(true)
      expect(report.git.ownRepo).toBe(false)
      expect(report.git.enclosingRoot).not.toBeNull()
    })

    it('reports a plain local folder with no git at all — the common POC', async () => {
      const report = await read(fixture({ 'package.json': '{}', 'index.js': 'x' }))
      expect(report.git.isRepo).toBe(false)
      expect(report.git.ownRepo).toBe(false)
      expect(report.git.enclosingRoot).toBeNull()
    })
  })
})
