import { spawnSync } from 'child_process'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

import { workflowConfigFromPreset } from '../../prompts/workflow.prompts'
import { writeManifest } from '../../utils'

const CLI_ROOT = resolve(__dirname, '../../..')

// #822 — the branches written at setup had to be edited in the manifest afterwards
describe('sf workflow set-working-branch / set-pr-target-branch through the compiled CLI', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sf-workflow-branches-'))
    const { workflow, aiRules } = workflowConfigFromPreset('solo', 'github-projects')
    await writeManifest(tempDir, { version: '1.0.0', generatedAt: new Date().toISOString(), structure: 'cli', projectName: 'external', workflow, aiRules })
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: tempDir })
    spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'first'], { cwd: tempDir })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const workflowCommand = (...args: string[]) =>
    spawnSync(process.execPath, [join(CLI_ROOT, 'bin/sf.js'), 'workflow', ...args], { cwd: tempDir, encoding: 'utf8', env: { ...process.env, SF_SKILL_NO_WARN: '1' } })
  const manifestWorkflow = async () => JSON.parse(await readFile(join(tempDir, '.saasfoundry.json'), 'utf8')).workflow

  it('moves a PR target that followed the working branch along with it', async () => {
    const run = workflowCommand('set-working-branch', 'main')

    expect(run.status).toBe(0)
    expect(await manifestWorkflow()).toMatchObject({ workingBranch: 'main', prTargetBranch: 'main' })
    expect(run.stdout).not.toContain('does not exist yet')
  })

  it('keeps a PR target set on its own, and names a branch that does not exist yet', async () => {
    expect(workflowCommand('set-pr-target-branch', 'main').status).toBe(0)
    const run = workflowCommand('set-working-branch', 'trunk')

    expect(await manifestWorkflow()).toMatchObject({ workingBranch: 'trunk', prTargetBranch: 'main' })
    expect(run.stdout).toContain('Branch "trunk" does not exist yet — create it: git branch trunk && git push -u origin trunk')
  })

  it('refuses a name Git refuses and leaves the manifest unchanged', async () => {
    const run = workflowCommand('set-pr-target-branch', 'bad..name')

    expect(run.status).toBe(1)
    expect(run.stderr).toContain('Invalid Git branch name')
    expect(await manifestWorkflow()).toMatchObject({ workingBranch: 'develop', prTargetBranch: 'develop' })
  })
})
