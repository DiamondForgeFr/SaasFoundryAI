import { mkdir, symlink, writeFile } from 'fs/promises'
import { join } from 'path'

import { collectStatus } from '../../../status/collect'
import { checkPersonalSkills, collectPersonalSkills, skillDescription, skillVersion, triggerPhrases } from '../../../status/personal-skills'
import { evaluatePreconditions } from '../../../status/preconditions'
import type { SaaSFoundryManifest } from '../../../types'
import { createTempDir } from '../../helpers/temp-dir'

const MANIFEST: SaaSFoundryManifest = { version: '1.1.0', generatedAt: '2026-11-01T00:00:00Z', structure: 'monorepo', projectName: 'demo' } as SaaSFoundryManifest

/** The descriptions the project ships today, so the fixtures below hold the triggers the real skills declare. */
const PROJECT_GITHUB_PROJECTS =
  'GitHub Projects V2 adapter of the workflow: create tickets, subtasks and epics, put tickets on the board, move statuses, set complexity, issue types and milestones, open and track pull requests, through github-projects-cli.sh. Triggers on "github project", "create ticket", "create subtask", "update ticket status", "github issue", "project board", "set complexity".'
const PROJECT_TOOL_SAASFOUNDRY =
  'Use when the user wants to scaffold a new SaaSFoundryAI project, add or remove modules in an existing SaaSFoundryAI project. Triggers on keywords and phrases like "saasfoundry", "sf new", "sf update", "scaffold a SaaS", "add a module", ".saasfoundry.json".'

interface SkillOptions {
  description?: string
  /** Content of the `.version` file, written as is. */
  version?: string
  /** Write the description as a folded block (`>-`) the way the shipped skills do. */
  folded?: boolean
}

async function writeSkill(skillsRoot: string, name: string, options: SkillOptions = {}): Promise<string> {
  const dir = join(skillsRoot, name)
  await mkdir(dir, { recursive: true })
  const description = options.description ?? `Does ${name} things.`
  const frontmatter = options.folded ? `description: >-\n  ${description}` : `description: ${description}`
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\n${frontmatter}\n---\n\n# ${name}\n`)
  if (options.version !== undefined) await writeFile(join(dir, '.version'), options.version)
  return dir
}

const versionFile = (cliVersion: string, scope: 'user' | 'project' = 'user') => JSON.stringify({ cliVersion, installedAt: '2026-10-10T09:00:00.000Z', scope })

describe('personal skills that shadow the project skills (#1107)', () => {
  let home: string
  let project: string
  let cleanups: Array<() => Promise<void>>

  const personalRoot = () => join(home, '.claude', 'skills')
  const projectRoot = () => join(project, '.claude', 'skills')

  beforeEach(async () => {
    cleanups = []
    for (const assign of [(dir: string) => (home = dir), (dir: string) => (project = dir)]) {
      const temp = await createTempDir()
      cleanups.push(temp.cleanup)
      assign(temp.dir)
    }
    await writeFile(join(project, '.saasfoundry.json'), JSON.stringify(MANIFEST))
  })

  afterEach(async () => {
    await Promise.all(cleanups.map((cleanup) => cleanup()))
  })

  describe('reading a SKILL.md', () => {
    it('reads a one-line description, a folded block and a quoted scalar', () => {
      expect(skillDescription('---\nname: a\ndescription: Does a thing. Triggers on "do it".\n---\n')).toBe('Does a thing. Triggers on "do it".')
      expect(skillDescription('---\nname: a\ndescription: >-\n  Does a thing.\n  Triggers on "do it".\n---\n')).toBe('Does a thing. Triggers on "do it".')
      expect(skillDescription('---\nname: a\ndescription: "Does a thing. Triggers on \\"do it\\"."\n---\n')).toBe('Does a thing. Triggers on "do it".')
      expect(skillDescription('---\nname: a\n---\n')).toBe('')
      expect(skillDescription('# no frontmatter at all')).toBe('')
    })

    it('extracts the quoted phrases, lower-cased, de-duplicated and trimmed of white space and trailing punctuation', () => {
      expect(triggerPhrases('Triggers on "Create  Ticket", "create ticket", “curly one”, "update ticket status.".')).toEqual(['create ticket', 'curly one', 'update ticket status'])
    })

    it('ignores phrases shorter than three characters, quotes around no word, and unquoted keywords', () => {
      expect(triggerPhrases('Triggers on "pr", "--", "", create ticket, github project')).toEqual([])
    })

    it('reads .version as the JSON `sf skill install` writes, as a bare semver text, and gives up on anything else', async () => {
      const dir = await writeSkill(personalRoot(), 'a', { version: versionFile('1.0.1') })
      expect(skillVersion(dir)).toBe('1.0.1')
      await writeFile(join(dir, '.version'), '1.2.3\n')
      expect(skillVersion(dir)).toBe('1.2.3')
      await writeFile(join(dir, '.version'), JSON.stringify({ version: '2.0.0' }))
      expect(skillVersion(dir)).toBe('2.0.0')
      await writeFile(join(dir, '.version'), '{ not json at all')
      expect(skillVersion(dir)).toBeUndefined()
      await writeFile(join(dir, '.version'), '{}')
      expect(skillVersion(dir)).toBeUndefined()
      expect(skillVersion(join(dir, 'missing'))).toBeUndefined()
    })
  })

  describe('collectPersonalSkills', () => {
    it('is absent without a manifest: there is no managed project to shadow', () => {
      expect(collectPersonalSkills(project, null, home)).toBeUndefined()
    })

    it('finds nothing when the home has no personal skills, or the project no skills', async () => {
      expect(collectPersonalSkills(project, MANIFEST, home)).toEqual({ directory: personalRoot(), checked: 0, projectSkills: [], findings: [] })

      await writeSkill(personalRoot(), 'tool-saasfoundry')
      expect(collectPersonalSkills(project, MANIFEST, home)).toMatchObject({ checked: 1, projectSkills: [], findings: [] })
    })

    it('reports a personal skill that has the name of a project skill, whatever it contains', async () => {
      await writeSkill(projectRoot(), 'sf-workflow', { description: 'Project workflow. Triggers on "workflow status".' })
      const personalDir = await writeSkill(personalRoot(), 'sf-workflow', { description: 'Something else entirely.' })

      const state = collectPersonalSkills(project, MANIFEST, home)

      expect(state).toMatchObject({ checked: 1, projectSkills: ['sf-workflow'] })
      expect((state as { findings: unknown[] }).findings).toEqual([{ name: 'sf-workflow', path: personalDir, shadows: { projectPath: join(projectRoot(), 'sf-workflow') }, overlaps: [] }])
    })

    it('says the personal copy is older when both .version files compare, and does not claim it when they do not', async () => {
      await writeSkill(projectRoot(), 'tool-saasfoundry', { version: versionFile('1.1.0', 'project') })
      await writeSkill(projectRoot(), 'sf-workflow', { version: versionFile('1.1.0', 'project') })
      await writeSkill(projectRoot(), 'sf-srs')
      await writeSkill(projectRoot(), 'sf-integration-rules', { version: 'unreadable {' })
      await writeSkill(personalRoot(), 'tool-saasfoundry', { version: versionFile('1.0.1') })
      await writeSkill(personalRoot(), 'sf-workflow', { version: versionFile('1.2.0') })
      await writeSkill(personalRoot(), 'sf-srs', { version: versionFile('1.0.0') })
      await writeSkill(personalRoot(), 'sf-integration-rules', { version: versionFile('1.0.0') })

      const findings = (collectPersonalSkills(project, MANIFEST, home) as { findings: Array<{ name: string; shadows?: Record<string, unknown> }> }).findings
      const shadows = Object.fromEntries(findings.map((finding) => [finding.name, finding.shadows]))

      expect(shadows['tool-saasfoundry']).toMatchObject({ personalVersion: '1.0.1', projectVersion: '1.1.0', older: true })
      expect(shadows['sf-workflow']).toMatchObject({ personalVersion: '1.2.0', projectVersion: '1.1.0', older: false })
      // Only one side records a version, or one side does not parse: the report still shadows, and claims nothing about age.
      expect(shadows['sf-srs']).toMatchObject({ personalVersion: '1.0.0' })
      expect(shadows['sf-srs']).not.toHaveProperty('older')
      expect(shadows['sf-integration-rules']).toMatchObject({ personalVersion: '1.0.0' })
      expect(shadows['sf-integration-rules']).not.toHaveProperty('older')
    })

    it('compares prerelease versions the way semver does', async () => {
      await writeSkill(projectRoot(), 'tool-saasfoundry', { version: '1.1.0' })
      await writeSkill(personalRoot(), 'tool-saasfoundry', { version: '1.1.0-rc.1' })

      const [finding] = (collectPersonalSkills(project, MANIFEST, home) as { findings: Array<{ shadows?: { older?: boolean } }> }).findings

      expect(finding.shadows?.older).toBe(true)
    })

    it('reports a personal skill with another name that quotes the same trigger phrases, and names the phrases', async () => {
      await writeSkill(projectRoot(), 'sf-tool-github-projects', { description: PROJECT_GITHUB_PROJECTS, folded: true })
      const personalDir = await writeSkill(personalRoot(), 'tool-github-projects', {
        description: 'Interact with GitHub Projects V2. Triggers on "GitHub Project", "create ticket", "update  ticket status", "list sprints".'
      })

      const state = collectPersonalSkills(project, MANIFEST, home) as { findings: unknown[] }

      expect(state.findings).toEqual([
        { name: 'tool-github-projects', path: personalDir, overlaps: [{ projectSkill: 'sf-tool-github-projects', phrases: ['github project', 'create ticket', 'update ticket status'] }] }
      ])
    })

    it('leaves alone a personal skill that shares no quoted trigger phrase, whatever words its description shares', async () => {
      await writeSkill(projectRoot(), 'sf-tool-github-projects', { description: PROJECT_GITHUB_PROJECTS })
      await writeSkill(personalRoot(), 'tool-notion', { description: 'Notion pages and databases: create pages, github project boards imported. Triggers on "notion.so", "notes database".' })
      await writeSkill(personalRoot(), 'plain', { description: 'No quoted phrase here, but create ticket and github project are in it.' })

      expect((collectPersonalSkills(project, MANIFEST, home) as { findings: unknown[] }).findings).toEqual([])
    })

    it('reports a same-name skill once, with the overlaps it has with the other project skills', async () => {
      await writeSkill(projectRoot(), 'tool-saasfoundry', { description: PROJECT_TOOL_SAASFOUNDRY })
      await writeSkill(projectRoot(), 'sf-srs', { description: 'SRS host. Triggers on "create SRS", "new epic", "sf update".' })
      await writeSkill(personalRoot(), 'tool-saasfoundry', { description: PROJECT_TOOL_SAASFOUNDRY })

      const [finding, ...rest] = (collectPersonalSkills(project, MANIFEST, home) as { findings: Array<{ name: string; shadows?: unknown; overlaps: unknown[] }> }).findings

      expect(rest).toEqual([])
      expect(finding.shadows).toBeDefined()
      // It repeats `sf update`, which sf-srs also quotes: that is an overlap with another project skill.
      expect(finding.overlaps).toEqual([{ projectSkill: 'sf-srs', phrases: ['sf update'] }])
    })

    it('does not report a personal skill that is a link to the project folder itself', async () => {
      const real = await writeSkill(projectRoot(), 'tool-saasfoundry', { description: PROJECT_TOOL_SAASFOUNDRY })
      await mkdir(personalRoot(), { recursive: true })
      await symlink(real, join(personalRoot(), 'tool-saasfoundry'))

      expect(collectPersonalSkills(project, MANIFEST, home)).toMatchObject({ checked: 1, findings: [] })
    })

    it('reports a personal link to another folder: it is a different copy', async () => {
      await writeSkill(projectRoot(), 'tool-saasfoundry', { description: PROJECT_TOOL_SAASFOUNDRY })
      const elsewhere = await writeSkill(join(home, 'dotfiles'), 'tool-saasfoundry', { description: PROJECT_TOOL_SAASFOUNDRY })
      await mkdir(personalRoot(), { recursive: true })
      await symlink(elsewhere, join(personalRoot(), 'tool-saasfoundry'))

      expect((collectPersonalSkills(project, MANIFEST, home) as { findings: Array<{ name: string }> }).findings.map((finding) => finding.name)).toEqual(['tool-saasfoundry'])
    })

    it('finds nothing when the project is the home itself: the two sets are one', async () => {
      await writeFile(join(home, '.saasfoundry.json'), JSON.stringify(MANIFEST))
      await writeSkill(personalRoot(), 'sf-workflow', { description: 'x. Triggers on "workflow status".' })
      await writeSkill(personalRoot(), 'sf-other', { description: 'y. Triggers on "workflow status".' })

      expect(collectPersonalSkills(home, MANIFEST, home)).toMatchObject({ checked: 0, findings: [] })
    })

    it('reads the app directories of a multirepo project', async () => {
      const multirepo = { ...MANIFEST, structure: 'multirepo' } as SaaSFoundryManifest
      await writeSkill(join(project, 'apps', 'api', '.claude', 'skills'), 'sf-integration-rules')
      await writeSkill(personalRoot(), 'sf-integration-rules')

      expect((collectPersonalSkills(project, multirepo, home) as { findings: Array<{ name: string }> }).findings.map((finding) => finding.name)).toEqual(['sf-integration-rules'])
      expect((collectPersonalSkills(project, MANIFEST, home) as { findings: unknown[] }).findings).toEqual([])
    })

    it('skips folders without a SKILL.md and files in the skills directory', async () => {
      await writeSkill(projectRoot(), 'sf-workflow')
      await mkdir(join(personalRoot(), 'sf-workflow'), { recursive: true })
      await writeFile(join(personalRoot(), 'notes.md'), 'not a skill')

      expect(collectPersonalSkills(project, MANIFEST, home)).toMatchObject({ checked: 0, findings: [] })
    })
  })

  describe('checkPersonalSkills', () => {
    const report = async () => collectStatus(project, { checkNetwork: false, userHome: home })

    it('is left out when the report collected no personal skills', async () => {
      const bare = await collectStatus(join(project, 'nowhere'), { checkNetwork: false, userHome: home })
      expect(checkPersonalSkills(bare)).toBeUndefined()
      expect(evaluatePreconditions(bare).map((precondition) => precondition.name)).not.toContain('personalSkills')
    })

    it('is ok when no personal skill hides or competes with a project skill', async () => {
      await writeSkill(projectRoot(), 'sf-workflow')
      await writeSkill(personalRoot(), 'tool-notion', { description: 'Notion. Triggers on "notion.so".' })

      expect(checkPersonalSkills(await report())).toMatchObject({ name: 'personalSkills', status: 'ok', details: '1 personal skill checked against 1 project skill' })
    })

    it('is ok on a machine without personal skills', async () => {
      expect(checkPersonalSkills(await report())).toMatchObject({ status: 'ok', details: `No personal skill in ${personalRoot()}` })
    })

    it('warns, names each folder to remove and says what it shadows or competes with', async () => {
      await writeSkill(projectRoot(), 'tool-saasfoundry', { description: PROJECT_TOOL_SAASFOUNDRY, version: versionFile('1.1.0', 'project') })
      await writeSkill(projectRoot(), 'sf-tool-github-projects', { description: PROJECT_GITHUB_PROJECTS })
      const shadowing = await writeSkill(personalRoot(), 'tool-saasfoundry', { description: PROJECT_TOOL_SAASFOUNDRY, version: versionFile('1.0.1') })
      const competing = await writeSkill(personalRoot(), 'tool-github-projects', {
        description: 'Old name. Triggers on "github project", "create ticket", "create subtask", "update ticket status", "github issue", "project board".'
      })

      const precondition = checkPersonalSkills(await report())

      expect(precondition?.status).toBe('warn')
      expect(precondition?.details).toContain(`${shadowing} hides the project skill of the same name (its .version 1.0.1 is older than the project's 1.1.0)`)
      expect(precondition?.details).toContain(
        `${competing} answers the same triggers as sf-tool-github-projects ("github project", "create ticket", "create subtask", "update ticket status", +2 more)`
      )
      expect(precondition?.remediation).toContain(`rm -r ${competing}`)
      // Not run from the home that `sf skill uninstall --user` reads: the folder is named, not delegated to the installer.
      expect(precondition?.remediation).toContain(`rm -r ${shadowing}`)
      expect(precondition?.remediation).not.toContain('sf skill uninstall')
    })

    it('points `sf skill uninstall --user` at the folder the installer writes, when the report reads that home', async () => {
      const original = process.env.HOME
      process.env.HOME = home
      try {
        await writeSkill(projectRoot(), 'tool-saasfoundry')
        await writeSkill(projectRoot(), 'sf-workflow')
        await writeSkill(personalRoot(), 'tool-saasfoundry')
        const stray = await writeSkill(personalRoot(), 'sf-workflow')

        const precondition = checkPersonalSkills(await collectStatus(project, { checkNetwork: false }))

        expect(precondition?.remediation).toContain('sf skill uninstall --user')
        expect(precondition?.remediation).toContain(`rm -r ${stray}`)
        expect(precondition?.remediation).not.toContain(`rm -r ${join(personalRoot(), 'tool-saasfoundry')}`)
      } finally {
        if (original === undefined) delete process.env.HOME
        else process.env.HOME = original
      }
    })

    it('quotes a folder whose path needs it', async () => {
      const spaced = join(home, 'my home')
      await writeSkill(projectRoot(), 'sf-workflow')
      await writeSkill(join(spaced, '.claude', 'skills'), 'sf-workflow')

      const precondition = checkPersonalSkills(await collectStatus(project, { checkNetwork: false, userHome: spaced }))

      expect(precondition?.remediation).toContain(`rm -r '${join(spaced, '.claude', 'skills', 'sf-workflow')}'`)
    })

    it('skips, and never fails, when the personal skills cannot be read', () => {
      const unreadable = { error: 'EACCES' }
      const stub = { personalSkills: unreadable } as unknown as Parameters<typeof checkPersonalSkills>[0]

      expect(checkPersonalSkills(stub)).toMatchObject({ status: 'skip', details: 'Personal skills could not be read: EACCES' })
    })

    it('is part of the preconditions the status command evaluates, after the tier agents', async () => {
      await writeSkill(projectRoot(), 'sf-workflow')
      await writeSkill(personalRoot(), 'sf-workflow')

      const preconditions = evaluatePreconditions(await report())
      const names = preconditions.map((precondition) => precondition.name)

      expect(names).toContain('personalSkills')
      expect(names.indexOf('personalSkills')).toBeGreaterThan(names.indexOf('tierAgents'))
      expect(preconditions.find((precondition) => precondition.name === 'personalSkills')?.status).toBe('warn')
    })
  })
})
