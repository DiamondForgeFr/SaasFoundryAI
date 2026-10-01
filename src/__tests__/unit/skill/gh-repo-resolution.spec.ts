import { execFile, execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const ROOT = path.resolve(__dirname, '../../../..')
const WORKFLOW_CLI = path.join(ROOT, '.claude/skills/sf-workflow/workflow-cli.sh')
const TOOL_CLI = path.join(ROOT, '.claude/skills/sf-tool-github-projects/github-projects-cli.sh')

/**
 * #840 — with the conventional `upstream` remote of a fork, gh resolves the upstream
 * repository for every call made without `--repo`. Both CLIs pin GH_REPO to `origin`.
 */
describe('workflow CLIs target the origin repository', () => {
  let dir: string
  let log: string
  let env: NodeJS.ProcessEnv

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sf-gh-repo-'))
    log = path.join(dir, 'gh-repo.log')
    await mkdir(path.join(dir, 'bin'))
    const gh = `#!/bin/bash\nprintf 'gh GH_REPO=%s %s\\n' "\${GH_REPO:-unset}" "$*" >> '${log}'\nexit 0\n`
    writeFileSync(path.join(dir, 'bin/gh'), gh)
    chmodSync(path.join(dir, 'bin/gh'), 0o755)
    writeFileSync(path.join(dir, '.saasfoundry.json'), JSON.stringify({ workflow: { tool: 'github-projects', projectUrl: 'https://github.com/orgs/FakeOrg/projects/42', workingBranch: 'develop' } }))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:me/fork.git'], { cwd: dir })
    execFileSync('git', ['remote', 'add', 'upstream', 'https://github.com/them/original.git'], { cwd: dir })
    env = { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}` }
    delete env.GH_REPO
  })

  afterEach(async () => rm(dir, { recursive: true, force: true }))

  const ghCalls = () => readFileSync(log, 'utf8').split('\n').filter(Boolean)

  it('pins every gh call of the GitHub Projects CLI to origin', async () => {
    await exec('/bin/bash', [TOOL_CLI, 'get-labels', '42'], { cwd: dir, env }).catch(() => undefined)
    expect(ghCalls().length).toBeGreaterThan(0)
    expect(ghCalls().every((line) => line.startsWith('gh GH_REPO=me/fork '))).toBe(true)
  })

  it('exports GH_REPO from origin to the tool CLI the workflow CLI calls', async () => {
    const toolDir = path.join(dir, '.claude/skills/sf-tool-github-projects')
    await mkdir(toolDir, { recursive: true })
    writeFileSync(path.join(toolDir, 'github-projects-cli.sh'), `#!/bin/bash\nprintf 'tool GH_REPO=%s %s\\n' "\${GH_REPO:-unset}" "$*" >> '${log}'\nexit 0\n`)
    chmodSync(path.join(toolDir, 'github-projects-cli.sh'), 0o755)

    await exec('/bin/bash', [WORKFLOW_CLI, 'status', '42'], { cwd: dir, env }).catch(() => undefined)

    expect(ghCalls().some((line) => line.startsWith('tool GH_REPO=me/fork status 42'))).toBe(true)
  })

  it('keeps an explicit GH_REPO', async () => {
    await exec('/bin/bash', [TOOL_CLI, 'get-labels', '42'], { cwd: dir, env: { ...env, GH_REPO: 'explicit/choice' } }).catch(() => undefined)
    expect(ghCalls().every((line) => line.startsWith('gh GH_REPO=explicit/choice '))).toBe(true)
  })
})
