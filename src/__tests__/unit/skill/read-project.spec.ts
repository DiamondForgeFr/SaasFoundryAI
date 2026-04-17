import { execFile } from 'child_process'
import path from 'path'

const SCRIPT = path.resolve(
  __dirname,
  '../../../../scaffolds/skills-templates/tool-saasfoundry/scripts/read-project.js'
)
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
  project: { name: string; structure: string; cliVersion: string; generatedAt: string | null }
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
          modules: { emailService: 'mailersend' }
        },
        catalogue: fullCatalogue
      })
      expect(report.project).toEqual({
        name: 'demo-app',
        structure: 'monorepo',
        cliVersion: '1.0.0-beta',
        generatedAt: '2026-04-01T10:00:00Z'
      })
      expect(report.modules.installed).toEqual(['email'])
      expect(report.modules.newlyAvailable).toEqual([
        'storage',
        'analytics',
        'sf-skill-context7',
        'sf-skill-notion'
      ])
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
            emailService: 'mailersend',
            s3Setup: 'docker',
            includeAnalytics: true,
            advancedSkills: ['context7', 'notion']
          }
        },
        catalogue: fullCatalogue
      })
      expect(report.modules.installed).toEqual([
        'email',
        'storage',
        'analytics',
        'sf-skill-context7',
        'sf-skill-notion'
      ])
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
          modules: { emailService: 'mailersend', s3Setup: 'docker' }
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
          modules: { emailService: 'mailersend' }
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
          modules: { emailService: 'mailersend' }
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
        generatedAt: null
      })
      expect(report.modules.installed).toEqual([])
    })

    it('treats emailService="none" as not installed', async () => {
      const report = await runAndParse({
        manifest: {
          projectName: 'no-email',
          version: '1.0.0-beta',
          modules: { emailService: 'none', includeAnalytics: true }
        },
        catalogue: fullCatalogue
      })
      expect(report.modules.installed).toEqual(['analytics'])
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
