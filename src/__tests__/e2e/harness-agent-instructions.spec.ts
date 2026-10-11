import { execFileSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

import { GENERATED_INSTRUCTIONS } from '../../harness/agent-instructions'

const ROOT = resolve(__dirname, '../../..')

describe('compiled shared harness installer', () => {
  let project: string

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'sf-agent-e2e-'))
  })

  afterEach(async () => {
    await rm(project, { recursive: true, force: true })
  })

  function runInstaller(): { written: string[]; conflicts: string[] } {
    const script = `
      const { installHarness } = require(process.argv[1]);
      installHarness({ targetPath: process.cwd(), projectName: 'shared-demo', version: 'test',
        agents: ['claude-code', 'codex', 'kimi'],
        workflow: { tool: 'github-projects', workingBranch: 'develop', statuses: [{ name: 'Backlog' }, { name: 'Done' }] }
      }).then(report => process.stdout.write(JSON.stringify(report))).catch(error => { console.error(error); process.exitCode = 1; });
    `
    const output = execFileSync(process.execPath, ['-e', script, join(ROOT, 'dist/installers/harness.installer.js')], { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return JSON.parse(output)
  }

  it('discovers packaged resources from another working directory and never rewrites a user-authored AGENTS.md', async () => {
    expect(runInstaller().conflicts).toEqual([])
    await expect(readFile(join(project, 'CLAUDE.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const agents = await readFile(join(project, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('# shared-demo')
    expect(agents).toContain(GENERATED_INSTRUCTIONS)
    expect(agents).toContain('sf status --agent-friendly --no-network')
    expect(await readFile(join(project, '.claude/rules/claude-code.md'), 'utf8')).not.toBe('')
    await expect(readFile(join(project, 'GEMINI.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const shared = await readFile(join(project, '.agents/skills/sf-workflow/SKILL.md'), 'utf8')
    expect(shared).toContain('name: sf-workflow')
    expect(shared).toContain('../../../.claude/docs/manifest-schema.md')
    expect(await readFile(join(project, '.claude/docs/manifest-schema.md'), 'utf8')).not.toBe('')
    expect(runInstaller().written).toEqual([])
    expect(await readFile(join(project, 'AGENTS.md'), 'utf8')).toBe(agents)

    await writeFile(join(project, 'AGENTS.md'), '# Personal instructions\n')
    expect(runInstaller().conflicts).toEqual([])
    expect(await readFile(join(project, 'AGENTS.md'), 'utf8')).toBe('# Personal instructions\n')
    await expect(readFile(join(project, 'AGENTS.md.saasfoundry.new'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(project, 'CLAUDE.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
