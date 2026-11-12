import { cp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join, resolve } from 'path'

import { statusCommand } from '../../../commands/status'
import { createTempDir } from '../../helpers/temp-dir'

const REPOSITORY = resolve(__dirname, '../../../..')

function captureStdout(): { stop: () => string } {
  const originalWrite = process.stdout.write.bind(process.stdout)
  let buffer = ''
  process.stdout.write = ((chunk: string | Buffer) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    return true
  }) as typeof process.stdout.write
  return {
    stop: () => {
      process.stdout.write = originalWrite
      return buffer
    }
  }
}

/**
 * `sf status` reports the personal skills that shadow the project's (#1107).
 *
 * The developer's machine used to hold a personal `tool-saasfoundry` (installed on 2026-10-10, its
 * `plan-milestone.sh` differing from the project's) and a personal `tool-github-projects`. Both have been
 * removed since, so the "reported on this machine" criterion is proven here on a fixture home that
 * reproduces them next to a project that holds the skills this repository ships.
 */
describe('sf status reports the personal skills that shadow the project (#1107)', () => {
  let home: string
  let project: string
  let cleanups: Array<() => Promise<void>>
  let originalHome: string | undefined
  let originalCwd: string
  let originalExitCode: typeof process.exitCode

  const personalSkills = () => join(home, '.claude', 'skills')

  beforeEach(async () => {
    cleanups = []
    const homeDir = await createTempDir()
    const projectDir = await createTempDir()
    cleanups.push(homeDir.cleanup, projectDir.cleanup)
    home = homeDir.dir
    project = projectDir.dir
    originalHome = process.env.HOME
    originalCwd = process.cwd()
    originalExitCode = process.exitCode
    process.env.HOME = home
    process.chdir(project)

    await writeFile(
      join(project, '.saasfoundry.json'),
      JSON.stringify({ version: '1.1.0', generatedAt: '2026-11-01T00:00:00Z', structure: 'monorepo', projectName: 'demo', workflow: { tool: 'github-projects' } })
    )

    // The project's skills: what this repository ships, with the project-scope `.version` `sf skill install --project` writes.
    const projectSkills = join(project, '.claude', 'skills')
    await mkdir(projectSkills, { recursive: true })
    await cp(join(REPOSITORY, 'scaffolds', 'skills-templates', 'tool-saasfoundry'), join(projectSkills, 'tool-saasfoundry'), { recursive: true })
    await writeFile(join(projectSkills, 'tool-saasfoundry', '.version'), JSON.stringify({ cliVersion: '1.1.0', installedAt: '2026-11-01T09:00:00.000Z', scope: 'project' }))
    await cp(join(REPOSITORY, '.claude', 'skills', 'sf-tool-github-projects', 'SKILL.md'), join(projectSkills, 'sf-tool-github-projects', 'SKILL.md'))

    // The developer's machine: an older personal tool-saasfoundry whose plan-milestone.sh differs...
    await cp(join(REPOSITORY, 'scaffolds', 'skills-templates', 'tool-saasfoundry'), join(personalSkills(), 'tool-saasfoundry'), { recursive: true })
    await writeFile(join(personalSkills(), 'tool-saasfoundry', '.version'), JSON.stringify({ cliVersion: '1.0.0', installedAt: '2026-10-10T09:00:00.000Z', scope: 'user' }))
    const script = join(personalSkills(), 'tool-saasfoundry', 'scripts', 'plan-milestone.sh')
    await writeFile(script, `${await readFile(script, 'utf8')}\n# the October copy\n`)
    // ... and the project's GitHub Projects skill under its former name, with the same triggers.
    const former = (await readFile(join(REPOSITORY, '.claude', 'skills', 'sf-tool-github-projects', 'SKILL.md'), 'utf8')).replace('name: sf-tool-github-projects', 'name: tool-github-projects')
    await mkdir(join(personalSkills(), 'tool-github-projects'), { recursive: true })
    await writeFile(join(personalSkills(), 'tool-github-projects', 'SKILL.md'), former)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    process.exitCode = originalExitCode
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    await Promise.all(cleanups.map((cleanup) => cleanup()))
  })

  it('warns, in the agent-friendly report, naming both folders and what to run', async () => {
    const capture = captureStdout()
    await statusCommand({ agentFriendly: true, network: false })
    const out = capture.stop()

    const line = out.split('\n').find((entry) => entry.includes('No personal skill hides or competes with a project skill'))
    expect(line).toBeDefined()
    expect(line).toMatch(/^- \[warn\] /)
    expect(line).toContain(`${personalSkills()}/tool-saasfoundry hides the project skill of the same name (its .version 1.0.0 is older than the project's 1.1.0)`)
    expect(line).toContain(`${personalSkills()}/tool-github-projects answers the same triggers as sf-tool-github-projects ("github project", "create ticket", "create subtask", "update ticket status"`)
    expect(out).toContain(
      `  - remediation: Remove the personal copy so the project's skill applies (or move it out of ~/.claude/skills): rm -r ${personalSkills()}/tool-github-projects && sf skill uninstall --user`
    )
    // The friendly report never fails the process, whatever it reports.
    expect(process.exitCode).not.toBe(1)
  })

  it('carries the facts in --json, as a warn that does not fail the status', async () => {
    const capture = captureStdout()
    await statusCommand({ json: true, network: false })
    const parsed = JSON.parse(capture.stop()) as {
      personalSkills: { directory: string; findings: Array<{ name: string; shadows?: { older?: boolean }; overlaps: Array<{ projectSkill: string }> }> }
      preconditions: Array<{ name: string; status: string }>
    }

    expect(parsed.personalSkills.directory).toBe(personalSkills())
    expect(parsed.personalSkills.findings.map((finding) => finding.name)).toEqual(['tool-github-projects', 'tool-saasfoundry'])
    expect(parsed.personalSkills.findings.find((finding) => finding.name === 'tool-saasfoundry')?.shadows?.older).toBe(true)
    expect(parsed.personalSkills.findings.find((finding) => finding.name === 'tool-github-projects')?.overlaps.map((overlap) => overlap.projectSkill)).toEqual(['sf-tool-github-projects'])
    expect(parsed.preconditions.find((precondition) => precondition.name === 'personalSkills')?.status).toBe('warn')
  })

  it('reports ok once the two personal folders are removed', async () => {
    await rm(join(personalSkills(), 'tool-saasfoundry'), { recursive: true })
    await rm(join(personalSkills(), 'tool-github-projects'), { recursive: true })

    const capture = captureStdout()
    await statusCommand({ agentFriendly: true, network: false })
    const out = capture.stop()

    expect(out).toMatch(/^- \[ok\] No personal skill hides or competes with a project skill/m)
  })

  it('is absent from the report of a directory that is not a SaaSFoundryAI project', async () => {
    await rm(join(project, '.saasfoundry.json'))

    const capture = captureStdout()
    await statusCommand({ json: true, network: false })
    const parsed = JSON.parse(capture.stop()) as { personalSkills: unknown; preconditions: Array<{ name: string }> }

    expect(parsed.personalSkills).toBeNull()
    expect(parsed.preconditions.map((precondition) => precondition.name)).not.toContain('personalSkills')
  })
})
