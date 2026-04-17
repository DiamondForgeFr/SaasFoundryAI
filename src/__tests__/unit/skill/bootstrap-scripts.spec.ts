import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { mkdtemp, rm, symlink } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileP = promisify(execFile)

const SCRIPTS_DIR = path.resolve(__dirname, '../../../../scaffolds/skills-templates/tool-saasfoundry/scripts')
const BASH = '/bin/bash'

interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

async function run(script: string, env: NodeJS.ProcessEnv = process.env): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileP(BASH, [path.join(SCRIPTS_DIR, script)], { env })
    return { stdout, stderr, code: 0 }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: typeof e.code === 'number' ? e.code : 1 }
  }
}

/**
 * Creates a temporary directory that acts as a minimal PATH: it contains
 * symlinks only to the coreutils the bootstrap scripts need (`cat`, `uname`)
 * so that `gh`, `node`, and `sf` are guaranteed to be absent regardless of
 * what is installed on the host (Ubuntu CI runners ship gh in /usr/bin).
 */
async function createMinimalPath(): Promise<{ pathDir: string; cleanup: () => Promise<void> }> {
  const pathDir = await mkdtemp(path.join(tmpdir(), 'sf-bootstrap-'))
  const needed = ['cat', 'uname']
  const candidateDirs = ['/bin', '/usr/bin']
  for (const tool of needed) {
    const source = candidateDirs.map((d) => path.join(d, tool)).find(existsSync)
    if (!source) throw new Error(`required coreutil not found on host: ${tool}`)
    await symlink(source, path.join(pathDir, tool))
  }
  return { pathDir, cleanup: () => rm(pathDir, { recursive: true, force: true }) }
}

describe('skill/bootstrap-scripts', () => {
  let minimalPath: string
  let cleanupPath: () => Promise<void>

  beforeAll(async () => {
    const created = await createMinimalPath()
    minimalPath = created.pathDir
    cleanupPath = created.cleanup
  })

  afterAll(async () => {
    await cleanupPath()
  })

  describe('detect-env.sh', () => {
    it('emits a JSON object with the expected shape', async () => {
      const { stdout, code } = await run('detect-env.sh')
      expect(code).toBe(0)
      const payload = JSON.parse(stdout)
      expect(Object.keys(payload).sort()).toEqual(['ghAuthed', 'ghInstalled', 'nodeVersion', 'os', 'sfGlobalInstalled'])
      expect(['darwin', 'linux', 'windows', 'unknown']).toContain(payload.os)
      expect(typeof payload.ghInstalled).toBe('boolean')
      expect(typeof payload.ghAuthed).toBe('boolean')
      expect(typeof payload.sfGlobalInstalled).toBe('boolean')
      expect(payload.nodeVersion === null || typeof payload.nodeVersion === 'string').toBe(true)
    })

    it('reports all booleans false when gh/node/sf are absent from PATH', async () => {
      const { stdout, code } = await run('detect-env.sh', { ...process.env, PATH: minimalPath })
      expect(code).toBe(0)
      const payload = JSON.parse(stdout)
      expect(payload.ghInstalled).toBe(false)
      expect(payload.ghAuthed).toBe(false)
      expect(payload.sfGlobalInstalled).toBe(false)
      expect(payload.nodeVersion).toBeNull()
    })
  })

  describe('bootstrap-gh.sh', () => {
    it('exits 1 with guided install instructions when gh is missing', async () => {
      const { stderr, code } = await run('bootstrap-gh.sh', { ...process.env, PATH: minimalPath })
      expect(code).toBe(1)
      expect(stderr).toMatch(/GitHub CLI.*not installed/i)
      expect(stderr).toMatch(/gh auth login/)
    })

    it('is idempotent under repeated invocations with the same environment', async () => {
      const first = await run('bootstrap-gh.sh', { ...process.env, PATH: minimalPath })
      const second = await run('bootstrap-gh.sh', { ...process.env, PATH: minimalPath })
      expect(first.code).toBe(second.code)
      expect(first.stderr).toBe(second.stderr)
    })
  })

  describe('bootstrap-cli.sh', () => {
    it('falls back to `npx saasfoundry-cli` when sf is not on PATH', async () => {
      const { stdout, code } = await run('bootstrap-cli.sh', { ...process.env, PATH: minimalPath })
      expect(code).toBe(0)
      expect(stdout.trim()).toBe('npx saasfoundry-cli')
    })

    it('returns a single non-empty line', async () => {
      const { stdout, code } = await run('bootstrap-cli.sh')
      expect(code).toBe(0)
      const lines = stdout.trim().split('\n')
      expect(lines).toHaveLength(1)
      expect(lines[0].length).toBeGreaterThan(0)
    })
  })
})
