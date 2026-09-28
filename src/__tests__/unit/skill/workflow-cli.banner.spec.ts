import { execFile } from 'child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { readdirSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileP = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const CLI = path.resolve(REPO_ROOT, '.claude/skills/sf-workflow/workflow-cli.sh')
const STATUSES_DIR = path.resolve(REPO_ROOT, '.claude/skills/sf-workflow/statuses')
const BASH = '/bin/bash'

// #436: after a successful transition, update-status prints an expectations
// banner (▶ AI / ⏳ Dev) read from the target status file's banner_ai /
// banner_human frontmatter. The banner is what tells the developer whose turn
// it is — silence after "✓ Ticket #N → In review" is how merges got forgotten.
// Contract pinned here: banner on success, no banner on tool failure, and
// every status file carries both fields.

async function buildSandbox(options: { toolExitCode?: number } = {}): Promise<{
  dir: string
  env: NodeJS.ProcessEnv
  cleanup: () => Promise<void>
}> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-wfcli-banner-'))
  const toolDir = path.join(dir, '.claude/skills/sf-tool-github-projects')
  await mkdir(toolDir, { recursive: true })

  await writeFile(
    path.join(dir, '.saasfoundry.json'),
    JSON.stringify({
      workflow: {
        tool: 'github-projects',
        projectUrl: 'https://github.com/orgs/FakeOrg/projects/42',
        workingBranch: 'develop'
      }
    })
  )

  // Tool CLI shim: `complexity: low` keeps the complexity guard quiet so the
  // banner logic is isolated; update-status succeeds or fails per the option.
  const toolExit = options.toolExitCode ?? 0
  const toolShim = `#!/bin/bash
case "$1" in
  get-labels)
    printf '%s\\n' "complexity: low"
    ;;
  update-status)
    if [ "${toolExit}" -ne 0 ]; then
      echo "fake-tool-cli: simulated update failure" >&2
      exit ${toolExit}
    fi
    echo "✓ Ticket #$2 → $3"
    ;;
  *)
    exit 0
    ;;
esac
`
  const toolPath = path.join(toolDir, 'github-projects-cli.sh')
  writeFileSync(toolPath, toolShim)
  chmodSync(toolPath, 0o755)

  const env: NodeJS.ProcessEnv = { ...process.env, PWD: dir }
  return { dir, env, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

describe('workflow-cli update-status expectations banner (#436)', () => {
  it('prints the ▶ AI / ⏳ Dev banner of the target status after a successful transition', async () => {
    const sandbox = await buildSandbox()
    try {
      const { stdout } = await execFileP(BASH, [CLI, 'update-status', '277', 'In progress'], {
        env: sandbox.env,
        cwd: sandbox.dir
      })

      expect(stdout).toContain('✓ Ticket #277 → In progress')
      expect(stdout).toContain('▶ AI:')
      expect(stdout).toContain('Branch from workingBranch')
      expect(stdout).toContain('⏳ Dev:')
      expect(stdout).toContain('next involvement at Human Testing')
    } finally {
      await sandbox.cleanup()
    }
  })

  it('prints the In-review banner that hands the ball to the developer', async () => {
    // "In progress" → banner is AI-centric; the In-review banner is the one
    // that prevented forgotten merges, so pin its wording too. Read straight
    // from the status file to avoid duplicating prose in the test.
    const file = readFileSync(path.join(STATUSES_DIR, '6-in-review.md'), 'utf8')
    expect(file).toMatch(/^banner_human: .*merge.*triggers Done/m)
  })

  it('prints no banner when the tool CLI fails the transition', async () => {
    const sandbox = await buildSandbox({ toolExitCode: 1 })
    try {
      await expect(execFileP(BASH, [CLI, 'update-status', '277', 'In progress'], { env: sandbox.env, cwd: sandbox.dir })).rejects.toMatchObject({
        stdout: expect.not.stringContaining('▶ AI:')
      })
    } finally {
      await sandbox.cleanup()
    }
  })

  it('every status file carries both banner_ai and banner_human fields', () => {
    const files = readdirSync(STATUSES_DIR).filter((f) => f.endsWith('.md'))
    expect(files.length).toBeGreaterThanOrEqual(10)
    for (const f of files) {
      const content = readFileSync(path.join(STATUSES_DIR, f), 'utf8')
      expect(content).toMatch(/^banner_ai: .+/m)
      expect(content).toMatch(/^banner_human: .+/m)
    }
  })

  it('status files are byte-identical between the live skill and the scaffolded template', () => {
    const templateDir = path.resolve(REPO_ROOT, 'scaffolds/skills-templates/workflow/statuses')
    for (const f of readdirSync(STATUSES_DIR).filter((f) => f.endsWith('.md'))) {
      expect(readFileSync(path.join(STATUSES_DIR, f), 'utf8')).toBe(readFileSync(path.join(templateDir, f), 'utf8'))
    }
    expect(readFileSync(CLI, 'utf8')).toBe(readFileSync(path.resolve(REPO_ROOT, 'scaffolds/skills-templates/workflow/workflow-cli.sh'), 'utf8'))
  })
})
