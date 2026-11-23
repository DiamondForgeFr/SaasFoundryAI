import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import inquirer from 'inquirer'

const HOME_DIR = join(tmpdir(), `sf-wf-use-home-${process.pid}`)

jest.mock('inquirer')
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: () => HOME_DIR
}))
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execSync: jest.fn(() => {
    throw new Error('gh unavailable in tests')
  })
}))

import { workflowAfterUse, workflowCommand } from '../../../commands/workflow'

const mockedPrompt = inquirer.prompt as unknown as jest.Mock

const SOLO_MANIFEST = {
  version: '1.0.0',
  structure: 'cli',
  projectName: 'acme',
  mainBranch: 'main',
  workflow: {
    tool: 'github-projects',
    template: 'SaaSFoundry Solo',
    projectUrl: 'https://github.com/orgs/FakeOrg/projects/9',
    workingBranch: 'main',
    prTargetBranch: 'main',
    statuses: [
      { name: 'Backlog', color: 'GRAY' },
      { name: 'In Progress', color: 'BLUE' },
      { name: 'AI Testing', color: 'PURPLE' },
      { name: 'In Review', color: 'PINK' },
      { name: 'Done', color: 'GREEN' }
    ],
    issueTypes: [{ name: 'sf-epic' }, { name: 'sf-story' }, { name: 'sf-task' }, { name: 'sf-issue' }]
  }
}

// TC-6 (FR-CONFIG-ENGINE-05 / DS-3): upgrading a solo project to the team
// preset is an in-place operation — manifest extended, skill docs regenerated,
// no duplicate CLAUDE.md section, issue types/labels untouched.
describe('sf workflow use <built-in preset> (in-place upgrade)', () => {
  let projectDir: string
  let originalCwd: string
  let logSpy: jest.SpyInstance

  beforeEach(async () => {
    projectDir = join(tmpdir(), `sf-wf-use-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    originalCwd = process.cwd()
    await mkdir(projectDir, { recursive: true })
    await mkdir(HOME_DIR, { recursive: true })
    process.chdir(projectDir)

    jest.clearAllMocks()
    mockedPrompt.mockResolvedValue({ projectUrl: SOLO_MANIFEST.workflow.projectUrl })
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    await writeFile('.saasfoundry.json', JSON.stringify(SOLO_MANIFEST, null, 2))
    await writeFile('CLAUDE.md', '# acme\n\n## Git Workflow\n\n- main\n\n## Workflow System\n\nOld solo section.\n\n## Development Commands\n\n- npm test\n')
  })

  afterEach(async () => {
    logSpy.mockRestore()
    process.chdir(originalCwd)
    await rm(projectDir, { recursive: true, force: true }).catch(() => {})
    await rm(HOME_DIR, { recursive: true, force: true }).catch(() => {})
  })

  it('solo → team: manifest extended, docs regenerated, single CLAUDE.md section', async () => {
    await workflowCommand('use', 'saasfoundry')

    const manifest = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    expect(manifest.workflow.template).toBe('SaaSFoundry AI Workflow')
    expect(manifest.workflow.statuses).toHaveLength(7)
    expect(manifest.workflow.statuses.map((s: { name: string }) => s.name)).toContain('Human Testing')
    // In-place: tool, URL and branches survive the upgrade
    expect(manifest.workflow.tool).toBe('github-projects')
    expect(manifest.workflow.workingBranch).toBe('main')

    const statusFiles = await readdir(join(projectDir, '.claude', 'skills', 'sf-workflow', 'statuses'))
    expect(statusFiles).toContain('5-human-testing.md')
    expect(statusFiles.filter((f) => /^\d-/.test(f))).toHaveLength(7)

    const claudeMd = await readFile('CLAUDE.md', 'utf8')
    expect(claudeMd.match(/## Workflow System/g)).toHaveLength(1)
    expect(claudeMd).not.toContain('Old solo section.')
  })

  it('team → solo downgrade follows the same in-place path', async () => {
    await workflowCommand('use', 'saasfoundry')
    await workflowCommand('use', 'solo')

    const manifest = JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    expect(manifest.workflow.template).toBe('SaaSFoundry Solo')
    expect(manifest.workflow.statuses).toHaveLength(5)

    const statusFiles = await readdir(join(projectDir, '.claude', 'skills', 'sf-workflow', 'statuses'))
    expect(statusFiles).not.toContain('5-human-testing.md')
    expect(statusFiles.filter((f) => /^\d-/.test(f))).toHaveLength(5)
  })

  // #1233 — the switch rebuilt `workflow` from a field list without `releaseBranch` and `localCi`,
  // so moving between presets silently dropped the release branch and the local CI gate.
  describe('fields the switch keeps', () => {
    const LOCAL_CI = { requiredStatuses: ['local-format', 'local-lint', 'local-build', 'local-unit'] }
    // The spelling of this repository's own board and manifest: lower-case after the first word.
    const TEAM_STATUSES = [
      { name: 'Backlog', color: 'GRAY' },
      { name: 'Ready', color: 'YELLOW' },
      { name: 'In progress', color: 'BLUE' },
      { name: 'AI testing', color: 'PURPLE' },
      { name: 'Human testing', color: 'ORANGE' },
      { name: 'In review', color: 'PINK' },
      { name: 'Done', color: 'GREEN' }
    ]
    const TEAM_WORKFLOW = {
      ...SOLO_MANIFEST.workflow,
      template: 'SaaSFoundry AI',
      workingBranch: 'develop',
      prTargetBranch: 'develop',
      releaseBranch: 'master',
      localCi: LOCAL_CI,
      requireCodeReview: true,
      branchNaming: { feature: 'feature/{N}-{description}', fix: 'fix/{N}-{description}', release: 'rc-{version}' },
      commitFormat: { pattern: '<type>(#<ticket>): <description>', requireTicket: true },
      statuses: TEAM_STATUSES
    }
    const writeWorkflow = async (workflow: Record<string, unknown>) => writeFile('.saasfoundry.json', JSON.stringify({ ...SOLO_MANIFEST, workflow }, null, 2))
    const manifestWorkflow = async () => JSON.parse(await readFile('.saasfoundry.json', 'utf8')).workflow
    const statusNames = (workflow: { statuses: { name: string }[] }) => workflow.statuses.map((s) => s.name)

    const expectDeclaredFieldsKept = (workflow: Record<string, unknown>) => {
      expect(workflow.releaseBranch).toBe('master')
      expect(workflow.localCi).toEqual(LOCAL_CI)
      expect(workflow.workingBranch).toBe('develop')
      expect(workflow.prTargetBranch).toBe('develop')
      expect(workflow.requireCodeReview).toBe(true)
      expect(workflow.branchNaming).toEqual(TEAM_WORKFLOW.branchNaming)
      expect(workflow.commitFormat).toEqual(TEAM_WORKFLOW.commitFormat)
      expect(workflow.projectUrl).toBe(SOLO_MANIFEST.workflow.projectUrl)
      expect(workflow.tool).toBe('github-projects')
    }

    it('team → solo keeps releaseBranch, localCi and every other declared field', async () => {
      await writeWorkflow(TEAM_WORKFLOW)

      await workflowCommand('use', 'solo')

      const workflow = await manifestWorkflow()
      expect(workflow.template).toBe('SaaSFoundry Solo')
      expect(workflow.statuses).toHaveLength(5)
      expect(workflow.validated).toBe(false)
      expectDeclaredFieldsKept(workflow)
    })

    it('solo → team keeps releaseBranch, localCi and every other declared field', async () => {
      await writeWorkflow({ ...TEAM_WORKFLOW, template: 'SaaSFoundry Solo', statuses: SOLO_MANIFEST.workflow.statuses })

      await workflowCommand('use', 'saasfoundry')

      const workflow = await manifestWorkflow()
      expect(workflow.template).toBe('SaaSFoundry AI Workflow')
      expect(workflow.statuses).toHaveLength(7)
      expectDeclaredFieldsKept(workflow)
    })

    it('a round trip team → solo → team leaves releaseBranch and localCi as they were', async () => {
      await writeWorkflow(TEAM_WORKFLOW)

      await workflowCommand('use', 'solo')
      await workflowCommand('use', 'saasfoundry')

      expectDeclaredFieldsKept(await manifestWorkflow())
    })

    // Status matching is case-insensitive end to end: `updateGitHubProjectStatuses` compares lower-cased names and
    // keeps the board's option, and `workflow-cli.sh` / `github-projects-cli.sh` lower-case the target before every
    // guard and resolve the option id with `ascii_downcase`. The switch keeps the project's spelling too, so the
    // manifest, the regenerated docs and the board keep naming a status the same way.
    it("keeps the project's spelling of a status the target preset names with another case", async () => {
      await writeWorkflow(TEAM_WORKFLOW)

      await workflowCommand('use', 'solo')
      expect(statusNames(await manifestWorkflow())).toEqual(['Backlog', 'In progress', 'AI testing', 'In review', 'Done'])

      await workflowCommand('use', 'saasfoundry')
      expect(statusNames(await manifestWorkflow())).toEqual(['Backlog', 'Ready', 'In progress', 'AI testing', 'Human Testing', 'In review', 'Done'])
    })

    it('a saved template replaces only the conventions it recorded', () => {
      const workflow = workflowAfterUse(
        TEAM_WORKFLOW as Parameters<typeof workflowAfterUse>[0],
        { name: 'Mine', tool: 'github-projects', workingBranch: 'main', statuses: [{ name: 'Backlog' }, { name: 'Done' }], issueTypes: [] },
        'mine',
        SOLO_MANIFEST.workflow.projectUrl
      ) as unknown as Record<string, unknown>

      expect(workflow.template).toBe('Mine')
      expect(workflow.workingBranch).toBe('main')
      expect(workflow.prTargetBranch).toBe('develop')
      expect(workflow.releaseBranch).toBe('master')
      expect(workflow.localCi).toEqual(LOCAL_CI)
      expect(workflow.branchNaming).toEqual(TEAM_WORKFLOW.branchNaming)
      expect(workflow.issueTypes).toEqual([])
    })
  })

  // #1248 — a switch left the previous preset's status documents under `.agents/skills` with their baselines, the Solo
  // SKILL.md named the Team drafting documents, and `use` appended a "Workflow System" section and a listener copy to a
  // project that had its own rules.
  describe('a preset switch on a project with its harness (#1248)', () => {
    const SKILL = '.claude/skills/sf-workflow'
    const SHARED = '.agents/skills/sf-workflow'
    const TEAM_DOCS = [
      '1-backlog.md',
      '2-ready.md',
      '3-in-progress.md',
      '3a-ai-drafting.md',
      '3b-human-review.md',
      '3c-spawning.md',
      '4-ai-testing.md',
      '5-human-testing.md',
      '6-in-review.md',
      '7-done.md'
    ]
    const SOLO_DOCS = ['1-backlog.md', '2-in-progress.md', '2a-ai-drafting.md', '2b-human-review.md', '2c-spawning.md', '3-ai-testing.md', '4-in-review.md', '5-done.md']
    const AGENTS_MD =
      '# acme\n\nOur own rules, which `sf workflow use` must leave alone.\n\n<!-- saasfoundry:generated:start -->\n<!-- saasfoundry:generated:end -->\n\n## Our release rules\n\n- tag from main\n'
    const outsideRegion = (content: string) => content.replace(/<!-- saasfoundry:generated:start -->[\s\S]*<!-- saasfoundry:generated:end -->/, '<region/>')
    const readManifest = async () => JSON.parse(await readFile('.saasfoundry.json', 'utf8'))
    const docs = async (dir: string) => (await readdir(join(projectDir, dir, 'statuses'))).filter((name) => name.endsWith('.md')).sort()
    const refresh = async () => {
      const { refreshAgents } = await import('../../../harness/agent-support')
      return refreshAgents({ targetPath: projectDir, scope: 'shared' })
    }
    const exists = (path: string) =>
      readFile(join(projectDir, path)).then(
        () => true,
        () => false
      )

    /** Every status document a skill copy names (`statuses/<doc>.md`, or a bare `<n>[a-c]-<slug>.md`) is in that copy. */
    const expectLinksResolve = async (dir: string) => {
      const installed = new Set(await docs(dir))
      const files = ['SKILL.md', ...[...installed].map((doc) => `statuses/${doc}`)]
      for (const file of files) {
        const content = await readFile(join(projectDir, dir, file), 'utf8')
        for (const [, doc] of content.matchAll(/(?:statuses\/|`)(\d[a-c]?-[a-z-]+\.md)/g)) expect({ file, doc, resolves: installed.has(doc) }).toEqual({ file, doc, resolves: true })
      }
    }

    /** No status document of the other preset in either copy, and no baseline without its file. */
    const expectNoOrphans = async (expected: string[]) => {
      expect(await docs(SKILL)).toEqual(expected)
      expect(await docs(SHARED)).toEqual(expected)
      const baselines = Object.keys((await readManifest()).fileHashes ?? {})
      for (const path of baselines) expect({ path, exists: await exists(path) }).toEqual({ path, exists: true })
      expect(baselines.filter((path) => path.startsWith(`${SHARED}/statuses/`)).sort()).toEqual(expected.map((doc) => `${SHARED}/statuses/${doc}`))
    }

    beforeEach(async () => {
      await rm('CLAUDE.md')
      await writeFile('AGENTS.md', AGENTS_MD)
      await writeFile(
        '.saasfoundry.json',
        JSON.stringify(
          { ...SOLO_MANIFEST, workflow: { ...SOLO_MANIFEST.workflow, template: 'SaaSFoundry AI Workflow' }, modules: { harness: { version: 4, agents: ['claude-code', 'codex'] } } },
          null,
          2
        )
      )
      // The harness as a Team project has it: the skill installed, and its shared copy projected with baselines.
      await workflowCommand('use', 'saasfoundry')
      await refresh()
    })

    it('Team → Solo → Team leaves no orphan document or baseline, resolvable links, and AGENTS.md as it was', async () => {
      await expectNoOrphans(TEAM_DOCS)
      const agentsMd = outsideRegion(await readFile('AGENTS.md', 'utf8'))
      expect(agentsMd).toBe(outsideRegion(AGENTS_MD))

      await workflowCommand('use', 'solo')
      const toSolo = await refresh()
      await expectNoOrphans(SOLO_DOCS)
      await expectLinksResolve(SKILL)
      await expectLinksResolve(SHARED)
      expect(toSolo.report.removed).toEqual(expect.arrayContaining([`${SHARED}/statuses/2-ready.md`, `${SHARED}/statuses/5-human-testing.md`]))
      expect(outsideRegion(await readFile('AGENTS.md', 'utf8'))).toBe(agentsMd)

      await workflowCommand('use', 'saasfoundry')
      await refresh()
      await expectNoOrphans(TEAM_DOCS)
      await expectLinksResolve(SKILL)
      await expectLinksResolve(SHARED)
      const final = await readFile('AGENTS.md', 'utf8')
      expect(outsideRegion(final)).toBe(agentsMd)
      expect(final).not.toContain('## Workflow System')
      expect(await exists('.github/workflows/pr-review-sync.yml')).toBe(false)
    })

    it('names the drafting documents of the installed preset in SKILL.md', async () => {
      await workflowCommand('use', 'solo')
      const skillMd = await readFile(join(projectDir, SKILL, 'SKILL.md'), 'utf8')
      expect(skillMd).toContain('`statuses/2a-ai-drafting.md`')
      expect(skillMd).toContain('`statuses/2c-spawning.md`')
      expect(skillMd).not.toMatch(/3[abc]-/)
      expect(skillMd).not.toContain('{{DRAFTING_STATUSES_LIST}}')
    })

    it('keeps an edited document of the previous preset instead of deleting it, and names it', async () => {
      await writeFile(join(projectDir, SKILL, 'statuses/5-human-testing.md'), '# Our own Human Testing checklist\n')
      await writeFile(join(projectDir, SHARED, 'statuses/2-ready.md'), '# Our own Ready notes\n')

      await workflowCommand('use', 'solo')
      const result = await refresh()

      // The Claude copy is set aside under a name the workflow CLI does not resolve.
      expect(await readFile(join(projectDir, SKILL, 'statuses/5-human-testing.md.saasfoundry.old'), 'utf8')).toBe('# Our own Human Testing checklist\n')
      expect(await exists(`${SKILL}/statuses/5-human-testing.md`)).toBe(false)
      expect(logSpy.mock.calls.flat().join('\n')).toContain(`${SKILL}/statuses/5-human-testing.md: edited`)
      // The edited shared copy stays, keeps its baseline, and every refresh names it.
      expect(await readFile(join(projectDir, SHARED, 'statuses/2-ready.md'), 'utf8')).toBe('# Our own Ready notes\n')
      expect((await readManifest()).fileHashes[`${SHARED}/statuses/2-ready.md`]).toBeDefined()
      expect(result.report.warnings).toContain(`${SHARED}/statuses/2-ready.md: no longer generated, and edited; kept. Merge what you still need, then delete it.`)
      // Its unedited mirror is removed with its baseline.
      expect(await exists(`${SHARED}/statuses/5-human-testing.md`)).toBe(false)
      expect((await readManifest()).fileHashes[`${SHARED}/statuses/5-human-testing.md`]).toBeUndefined()
    })

    it('leaves a status document no preset ships where it is', async () => {
      await writeFile(join(projectDir, SKILL, 'statuses/8-qa.md'), '# QA, a status of our own\n')

      await workflowCommand('use', 'solo')

      expect(await readFile(join(projectDir, SKILL, 'statuses/8-qa.md'), 'utf8')).toBe('# QA, a status of our own\n')
    })
  })

  // #821 — `use` took the board URL from a prompt only, so a scripted setup could not attach one
  describe('board', () => {
    const writeWorkflow = async (workflow: Record<string, unknown>) =>
      writeFile('.saasfoundry.json', JSON.stringify({ ...SOLO_MANIFEST, workflow: { ...SOLO_MANIFEST.workflow, ...workflow } }, null, 2))
    const manifestWorkflow = async () => JSON.parse(await readFile('.saasfoundry.json', 'utf8')).workflow
    const output = () => logSpy.mock.calls.flat().join('\n')

    it('keeps the current board without asking for it again', async () => {
      await workflowCommand('use', 'saasfoundry')

      expect(mockedPrompt).not.toHaveBeenCalled()
      expect((await manifestWorkflow()).projectUrl).toBe(SOLO_MANIFEST.workflow.projectUrl)
    })

    it('attaches the board passed with --project-url', async () => {
      await writeWorkflow({ projectUrl: undefined })

      await workflowCommand('use', 'solo', '--project-url', 'https://github.com/users/octo/projects/4')

      expect(mockedPrompt).not.toHaveBeenCalled()
      expect((await manifestWorkflow()).projectUrl).toBe('https://github.com/users/octo/projects/4')
    })

    it('leaves a workflow without a board, and says how to attach one, when nothing is known and no terminal can be asked', async () => {
      await writeWorkflow({ projectUrl: undefined })
      const isTTY = process.stdin.isTTY
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
      try {
        await workflowCommand('use', 'solo')
      } finally {
        Object.defineProperty(process.stdin, 'isTTY', { value: isTTY, configurable: true })
      }

      expect(mockedPrompt).not.toHaveBeenCalled()
      expect((await manifestWorkflow()).projectUrl).toBeUndefined()
      expect(output()).toContain('No github-projects board attached')
      expect(output()).toContain('sf workflow use solo --create-board')
    })

    it.each([
      [['solo', '--frobnicate'], 'Unknown option for `sf workflow use`: --frobnicate'],
      [['solo', '--project-url', 'https://github.com/acme/notulia'], 'is not a GitHub Projects URL'],
      [['solo', '--project-url', 'https://github.com/users/octo/projects/4', '--create-board'], 'are exclusive']
    ])('refuses %j and leaves the manifest unchanged', async (args, message) => {
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`exit ${code}`)
      }) as never)
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      try {
        await expect(workflowCommand('use', ...args)).rejects.toThrow('exit 1')
        expect(errorSpy.mock.calls.flat().join('\n')).toContain(message)
        expect(await manifestWorkflow()).toEqual(SOLO_MANIFEST.workflow)
      } finally {
        exitSpy.mockRestore()
        errorSpy.mockRestore()
      }
    })
  })
})
