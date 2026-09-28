import { execFile } from 'child_process'
import { chmod, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

const SCRIPT = path.resolve(__dirname, '../../../../scaffolds/skills-templates/tool-saasfoundry/scripts/read-project.js')
const WRAPPER = path.resolve(__dirname, '../../../../scaffolds/skills-templates/tool-saasfoundry/scripts/read-project.sh')
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
  return {
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
    code
  }
}

interface Report {
  project: {
    name: string
    structure: string
    cliVersion: string
    generatedAt: string | null
    capabilities: { technicalStack: string; collaborationHarness: string; effectiveProfile: string } | null
  }
  modules: {
    installed: string[]
    available: string[]
    newlyAvailable: string[]
    obsolete: Array<{ name: string; minCliVersion: string }>
  }
  upToDate: boolean
}

async function runAndParse(input: unknown): Promise<Report & ExecResult> {
  const res = await runWithInput(input)
  if (res.code !== 0) {
    throw new Error(`Expected success, got code=${res.code}, stderr=${res.stderr}`)
  }
  return { ...res, ...(JSON.parse(res.stdout) as Report) }
}

const fullCatalogue = [
  { name: 'email', minCliVersion: '1.0.0-beta', description: 'Transactional email' },
  { name: 'storage', minCliVersion: '1.0.0-beta', description: 'S3-compatible storage' },
  { name: 'analytics', minCliVersion: '1.0.0-beta', description: 'Usage analytics' },
  { name: 'sf-skill-context7', minCliVersion: '1.0.0-beta', description: 'Context7 MCP' },
  { name: 'sf-skill-notion', minCliVersion: '1.0.0-beta', description: 'Notion MCP' }
]

describe('skill/read-project', () => {
  describe('Fresh install — only email', () => {
    it('reports email installed and other modules as newlyAvailable', async () => {
      const report = await runAndParse({
        manifest: {
          projectName: 'demo-app',
          structure: 'monorepo',
          version: '1.0.0-beta',
          generatedAt: '2026-04-01T10:00:00Z',
          modules: { email: { provider: 'mailersend', version: 1 } }
        },
        catalogue: fullCatalogue
      })
      expect(report.project).toEqual({
        name: 'demo-app',
        structure: 'monorepo',
        cliVersion: '1.0.0-beta',
        generatedAt: '2026-04-01T10:00:00Z',
        capabilities: null
      })
      expect(report.modules.installed).toEqual(['email'])
      expect(report.modules.newlyAvailable).toEqual(['storage', 'analytics', 'sf-skill-context7', 'sf-skill-notion'])
      expect(report.modules.obsolete).toEqual([])
      expect(report.upToDate).toBe(true)
    })
  })

  describe('Every module installed', () => {
    it('lists all modules, nothing newly available, up to date', async () => {
      const report = await runAndParse({
        manifest: {
          projectName: 'kitchen-sink',
          structure: 'multirepo',
          version: '1.0.0-beta',
          modules: {
            email: { provider: 'mailersend', version: 1 },
            s3Setup: 'docker',
            includeAnalytics: true,
            advancedSkills: ['context7', 'notion']
          }
        },
        catalogue: fullCatalogue
      })
      expect(report.modules.installed).toEqual(['email', 'storage', 'analytics', 'sf-skill-context7', 'sf-skill-notion'])
      expect(report.modules.newlyAvailable).toEqual([])
      expect(report.upToDate).toBe(true)
    })
  })

  describe('Advanced skills subset', () => {
    it('only lists installed skills and marks the rest newly available', async () => {
      const report = await runAndParse({
        manifest: {
          projectName: 'partial',
          structure: 'monorepo',
          version: '1.0.0-beta',
          modules: { advancedSkills: ['context7'] }
        },
        catalogue: fullCatalogue
      })
      expect(report.modules.installed).toEqual(['sf-skill-context7'])
      expect(report.modules.newlyAvailable).toContain('sf-skill-notion')
      expect(report.modules.newlyAvailable).not.toContain('sf-skill-context7')
    })
  })

  describe('Obsolete CLI version', () => {
    it('flags installed modules whose minCliVersion exceeds cliVersion', async () => {
      const report = await runAndParse({
        manifest: {
          projectName: 'stale',
          structure: 'monorepo',
          version: '1.0.0-beta',
          modules: { email: { provider: 'mailersend', version: 1 }, s3Setup: 'docker' }
        },
        catalogue: [
          { name: 'email', minCliVersion: '1.1.0' },
          { name: 'storage', minCliVersion: '1.0.0-beta' }
        ]
      })
      expect(report.modules.obsolete).toEqual([{ name: 'email', minCliVersion: '1.1.0' }])
      expect(report.upToDate).toBe(false)
    })

    it('ignores obsolete entries for modules the project does not have', async () => {
      const report = await runAndParse({
        manifest: {
          projectName: 'lean',
          structure: 'monorepo',
          version: '1.0.0-beta',
          modules: { email: { provider: 'mailersend', version: 1 } }
        },
        catalogue: [
          { name: 'email', minCliVersion: '1.0.0-beta' },
          { name: 'analytics', minCliVersion: '9.9.9' }
        ]
      })
      expect(report.modules.obsolete).toEqual([])
      expect(report.upToDate).toBe(true)
    })
  })

  describe('Empty catalogue', () => {
    it('emits a report with available=[] and upToDate=true', async () => {
      const report = await runAndParse({
        manifest: {
          projectName: 'offline',
          structure: 'monorepo',
          version: '1.0.0-beta',
          modules: { email: { provider: 'mailersend', version: 1 } }
        },
        catalogue: []
      })
      expect(report.modules.available).toEqual([])
      expect(report.modules.newlyAvailable).toEqual([])
      expect(report.modules.installed).toEqual(['email'])
      expect(report.upToDate).toBe(true)
    })
  })

  describe('Manifest defaults', () => {
    it('falls back to unknown/null when optional fields are absent', async () => {
      const report = await runAndParse({
        manifest: { modules: {} },
        catalogue: []
      })
      expect(report.project).toEqual({
        name: 'unknown',
        structure: 'unknown',
        cliVersion: 'unknown',
        generatedAt: null,
        capabilities: null
      })
      expect(report.modules.installed).toEqual([])
    })

    it('treats email.provider="none" as not installed', async () => {
      const report = await runAndParse({
        manifest: {
          projectName: 'no-email',
          version: '1.0.0-beta',
          modules: { email: { provider: 'none', version: 1 }, includeAnalytics: true }
        },
        catalogue: fullCatalogue
      })
      expect(report.modules.installed).toEqual(['analytics'])
    })
  })

  describe('Canonical project capabilities', () => {
    it('copies the sf status classification and treats a managed harness as installed', async () => {
      const capabilities = { technicalStack: 'present', collaborationHarness: 'managed', effectiveProfile: 'full' }
      const report = await runAndParse({
        manifest: { projectName: 'managed', structure: 'monorepo', version: '1.0.0', modules: {} },
        catalogue: [{ name: 'harness', minCliVersion: '1.0.0' }],
        status: { capabilities }
      })
      expect(report.project.capabilities).toEqual(capabilities)
      expect(report.modules.installed).toContain('harness')
      expect(report.modules.newlyAvailable).not.toContain('harness')
    })

    it('does not infer capabilities when status is unavailable', async () => {
      const report = await runAndParse({
        manifest: { projectName: 'legacy', structure: 'cli', version: '1.0.0', modules: { harness: { version: 1, managed: true } } },
        catalogue: []
      })
      expect(report.project.capabilities).toBeNull()
    })

    it('the wrapper keeps canonical status JSON even when an unrelated precondition makes status exit non-zero', async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'sf-read-project-'))
      const fakeCli = path.join(root, 'sf-test')
      const capabilities = { technicalStack: 'absent', collaborationHarness: 'managed', effectiveProfile: 'harness' }
      try {
        await writeFile(
          fakeCli,
          `#!/bin/sh
if [ "$1" = "modules" ]; then
  printf '%s\n' '[]'
  exit 0
fi
if [ "$1" = "status" ]; then
  printf '%s\n' '${JSON.stringify({ capabilities })}'
  exit 1
fi
exit 2
`
        )
        await chmod(fakeCli, 0o755)
        await writeFile(
          path.join(root, '.saasfoundry.json'),
          JSON.stringify({ projectName: 'external', structure: 'cli', version: '1.0.0', generatedAt: 'x', modules: { harness: { version: 1, managed: true } } })
        )
        const child = execFile('/bin/bash', [WRAPPER], { cwd: root, env: { ...process.env, SF_CLI: fakeCli } })
        const stdout: string[] = []
        const stderr: string[] = []
        child.stdout?.setEncoding('utf8')
        child.stderr?.setEncoding('utf8')
        child.stdout?.on('data', (chunk: string) => stdout.push(chunk))
        child.stderr?.on('data', (chunk: string) => stderr.push(chunk))
        const code = await new Promise<number>((resolve) => child.on('close', (value) => resolve(value ?? 0)))
        expect(code).toBe(0)
        expect(stderr.join('')).toBe('')
        expect(JSON.parse(stdout.join('')).project.capabilities).toEqual(capabilities)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
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

    it('exits 2 when manifest is missing', async () => {
      const { code, stderr } = await runWithInput({ catalogue: [] })
      expect(code).toBe(2)
      expect(stderr).toMatch(/input.manifest must be the .saasfoundry.json object/)
    })

    it('exits 2 when catalogue is not an array', async () => {
      const { code, stderr } = await runWithInput({ manifest: { modules: {} }, catalogue: 'oops' })
      expect(code).toBe(2)
      expect(stderr).toMatch(/input.catalogue must be an array/)
    })
  })
})
