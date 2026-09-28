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

import { workflowCommand } from '../../../commands/workflow'

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
})
