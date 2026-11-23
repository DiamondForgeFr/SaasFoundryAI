import { execFile } from 'child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileP = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const CLI = path.resolve(REPO_ROOT, '.claude/skills/sf-workflow/workflow-cli.sh')
const BASH = '/bin/bash'

const SOLO_STATUSES = [{ name: 'Backlog' }, { name: 'In progress' }, { name: 'AI testing' }, { name: 'In review' }, { name: 'Done' }]
const TEAM_STATUSES = [{ name: 'Backlog' }, { name: 'Ready' }, { name: 'In progress' }, { name: 'AI testing' }, { name: 'Human testing' }, { name: 'In review' }, { name: 'Done' }]

const MOCKUP_RECORD = '{"kind":"mockup","mockup":"docs/mockups/login.html","approvedBy":"Ada Lovelace","date":"2026-11-23"}'
const SUPPLIED_RECORD = '{"kind":"supplied","supplied":"an exact target screenshot","date":"2026-11-24"}'

interface Sandbox {
  dir: string
  env: NodeJS.ProcessEnv
  toolLogPath: string
  cleanup: () => Promise<void>
}

/**
 * A project whose board tool answers from environment variables: FAKE_LABELS (the labels of the ticket after its
 * complexity, one per line, FAKE_LABELS_ERROR makes the read fail), FAKE_UI_VALIDATION (what `get-ui-validation` prints, FAKE_UI_VALIDATION_ERROR makes it
 * fail), FAKE_TICKET_STATUS (the board status of the ticket). Every call to the tool is logged, and `gh` lists one
 * pull request of ticket 42, a draft when FAKE_PR_DRAFT is set.
 */
async function buildSandbox(options: { statuses: { name: string }[]; tool?: string }): Promise<Sandbox> {
  const tool = options.tool ?? 'github-projects'
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-wfcli-ui-'))
  const toolDir = path.join(dir, `.claude/skills/sf-tool-${tool}`)
  const binDir = path.join(dir, 'bin')
  const toolLogPath = path.join(dir, 'tool-calls.log')
  await mkdir(toolDir, { recursive: true })
  await mkdir(binDir, { recursive: true })

  await writeFile(
    path.join(dir, '.saasfoundry.json'),
    JSON.stringify({
      workflow: { tool, projectUrl: 'https://github.com/orgs/FakeOrg/projects/42', workingBranch: 'develop', statuses: options.statuses }
    })
  )

  const toolShim = `#!/bin/bash
printf '%s\\n' "$*" >> '${toolLogPath}'
case "$1" in
  status)
    printf '{"ticket":42,"title":"t","state":"OPEN","status":"%s","labels":[]}\\n' "\${FAKE_TICKET_STATUS:-AI testing}"
    ;;
  get-labels)
    if [ "\${FAKE_LABELS_ERROR:-}" = "1" ]; then
      echo "fake-tool-cli: simulated get-labels failure" >&2
      exit 1
    fi
    printf 'complexity: low\\n%s\\n' "\${FAKE_LABELS:-}"
    ;;
  get-ui-validation)
    if [ "\${FAKE_UI_VALIDATION_ERROR:-}" = "1" ]; then
      echo "fake-tool-cli: simulated comments failure" >&2
      exit 1
    fi
    if [ -n "\${FAKE_UI_VALIDATION:-}" ]; then
      printf '%s\\n' "\${FAKE_UI_VALIDATION}"
    fi
    ;;
  get-issue-type)
    exit 1
    ;;
  local-ci-gate)
    exit 0
    ;;
  update-status)
    echo "✓ Ticket #$2 → $3"
    ;;
  comment)
    cat > '${toolLogPath}.comment'
    ;;
  *)
    exit 0
    ;;
esac
`
  const toolPath = path.join(toolDir, `${tool}-cli.sh`)
  writeFileSync(toolPath, toolShim)
  chmodSync(toolPath, 0o755)

  // The PR guards read the pull requests of the repository: one, of ticket 42, a draft or not
  const ghPath = path.join(binDir, 'gh')
  writeFileSync(
    ghPath,
    `#!/bin/bash
draft=false
[ -n "\${FAKE_PR_DRAFT:-}" ] && draft=true
echo '[{"number":1,"headRefName":"feature/42-work","baseRefName":"develop","isDraft":'"$draft"',"isCrossRepository":false,"body":"","closingIssuesReferences":[]}]'
`
  )
  chmodSync(ghPath, 0o755)

  const env: NodeJS.ProcessEnv = { ...process.env, PWD: dir, PATH: `${binDir}:${process.env.PATH}` }
  return { dir, env, toolLogPath, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

async function runCli(args: string[], sandbox: Sandbox, envOverrides: NodeJS.ProcessEnv = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileP(BASH, [CLI, ...args], { cwd: sandbox.dir, env: { ...sandbox.env, ...envOverrides } })
    return { stdout, stderr, code: 0 }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: typeof e.code === 'number' ? e.code : 1 }
  }
}

function readLog(logPath: string): string[] {
  try {
    return readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
}

const calls = (sandbox: Sandbox, command: string): string[] => readLog(sandbox.toolLogPath).filter((line) => line.startsWith(`${command} `) || line === command)

// #1305 — a ticket that changes the user interface does not reach the developer's review without the record of a
// validated mockup (or of visuals the developer supplied)
describe('sf-workflow CLI — UI mockup guard (#1305)', () => {
  let sandbox: Sandbox

  afterEach(async () => {
    await sandbox.cleanup()
  })

  describe('Solo preset: the move to In review', () => {
    beforeEach(async () => {
      sandbox = await buildSandbox({ statuses: SOLO_STATUSES })
    })

    it('refuses a ui ticket that has no validation record, and names the command to run', async () => {
      const res = await runCli(['update-status', '42', 'In review'], sandbox, { FAKE_LABELS: 'complexity: low\nui' })

      expect(res.code).toBe(2)
      expect(res.stderr).toContain("Ticket #42 changes the user interface ('ui' marker) and has no mockup validation record")
      expect(res.stderr).toContain("cannot move it to 'In review'")
      expect(res.stderr).toContain('.claude/skills/sf-workflow/workflow-cli.sh record-ui-validation 42 --mockup <link-or-path> --approved-by <name>')
      expect(res.stderr).toContain('.claude/skills/sf-workflow/workflow-cli.sh record-ui-validation 42 --supplied "<what the developer supplied>"')
      expect(res.stderr).toContain('.claude/skills/sf-workflow/workflow-cli.sh clear-ui 42')
      expect(res.stderr).toContain('"UI mockup guard"')
      expect(calls(sandbox, 'update-status')).toEqual([])
    })

    it('does not teach the way round the guard', async () => {
      const res = await runCli(['update-status', '42', 'In review'], sandbox, { FAKE_LABELS: 'complexity: low\nui' })

      expect(res.stderr).not.toContain('SF_WORKFLOW_BYPASS_')
      expect(res.stderr).not.toContain('--skip-local-ci')
      expect(res.stderr).toContain('stop and ask the developer: an escape hatch is theirs to apply')
    })

    it('lets a ui ticket through once a mockup has been validated', async () => {
      const res = await runCli(['update-status', '42', 'In review'], sandbox, { FAKE_LABELS: 'complexity: low\nui', FAKE_UI_VALIDATION: MOCKUP_RECORD })

      expect(res.code).toBe(0)
      expect(res.stdout).toContain('✓ Ticket #42 → In review')
      expect(calls(sandbox, 'get-ui-validation')).toEqual(['get-ui-validation 42'])
      expect(calls(sandbox, 'update-status')).toEqual(['update-status 42 In review'])
    })

    it('lets a ui ticket through once the developer has supplied the visuals', async () => {
      const res = await runCli(['update-status', '42', 'In review'], sandbox, { FAKE_LABELS: 'ui', FAKE_UI_VALIDATION: SUPPLIED_RECORD })

      expect(res.code).toBe(0)
      expect(calls(sandbox, 'update-status')).toEqual(['update-status 42 In review'])
    })

    it('passes a ticket without the ui marker exactly as before, and reads no record', async () => {
      const res = await runCli(['update-status', '42', 'In review'], sandbox, { FAKE_LABELS: 'complexity: low\nbug' })

      expect(res.code).toBe(0)
      expect(res.stderr).not.toContain('mockup')
      expect(calls(sandbox, 'get-ui-validation')).toEqual([])
      expect(calls(sandbox, 'update-status')).toEqual(['update-status 42 In review'])
    })

    it.each([['uix'], ['ui-kit'], ['nature:ui'], ['no-ui']])('does not take the label %s for the marker', async (label) => {
      const res = await runCli(['update-status', '42', 'In review'], sandbox, { FAKE_LABELS: label })

      expect(res.code).toBe(0)
      expect(calls(sandbox, 'get-ui-validation')).toEqual([])
    })

    it('reads the marker whatever the case of the label', async () => {
      const res = await runCli(['update-status', '42', 'In review'], sandbox, { FAKE_LABELS: 'UI' })

      expect(res.code).toBe(2)
      expect(res.stderr).toContain('no mockup validation record')
    })

    it.each([['In progress'], ['Backlog']])('leaves the move to %s of a ui ticket alone', async (target) => {
      const res = await runCli(['update-status', '42', target], sandbox, { FAKE_LABELS: 'complexity: low\nui' })

      expect(res.code).toBe(0)
      expect(calls(sandbox, 'get-ui-validation')).toEqual([])
    })

    it('does not look for a Human testing record: the preset declares no such status', async () => {
      const res = await runCli(['update-status', '42', 'Human testing'], sandbox, { FAKE_LABELS: 'complexity: low\nui' })

      expect(res.stderr).not.toContain('mockup validation record')
      expect(calls(sandbox, 'get-ui-validation')).toEqual([])
    })

    it('answers before the guards of the pull request: a missing record is the first thing to fix', async () => {
      const res = await runCli(['update-status', '42', 'In review'], sandbox, { FAKE_LABELS: 'ui', FAKE_PR_DRAFT: '1' })

      expect(res.code).toBe(2)
      expect(res.stderr).toContain('no mockup validation record')
      expect(res.stderr).not.toContain('requires a non-draft PR')
    })

    it('fails open when the labels cannot be read (offline, auth): the refusal that follows is not its own', async () => {
      const res = await runCli(['update-status', '42', 'In review'], sandbox, { FAKE_LABELS_ERROR: '1' })

      // The guard of the pull request reads the labels too, and fails closed on its own account
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('unable to verify ticket nature')
      expect(res.stderr).not.toContain('mockup validation')
      expect(calls(sandbox, 'get-ui-validation')).toEqual([])
    })

    it('fails closed when the ticket carries the marker and its comments cannot be read', async () => {
      const res = await runCli(['update-status', '42', 'In review'], sandbox, { FAKE_LABELS: 'ui', FAKE_UI_VALIDATION_ERROR: '1' })

      expect(res.code).toBe(2)
      expect(res.stderr).toContain("carries the 'ui' marker and its mockup validation could not be read")
      expect(res.stderr).toContain('"UI mockup guard"')
      expect(calls(sandbox, 'update-status')).toEqual([])
    })
  })

  describe('Team preset: the move to Human testing', () => {
    beforeEach(async () => {
      sandbox = await buildSandbox({ statuses: TEAM_STATUSES })
    })

    it('refuses a ui ticket that has no validation record, and names the command to run', async () => {
      const res = await runCli(['update-status', '42', 'Human testing'], sandbox, { FAKE_LABELS: 'complexity: low\nui', FAKE_PR_DRAFT: '1' })

      expect(res.code).toBe(2)
      expect(res.stderr).toContain("cannot move it to 'Human testing'")
      expect(res.stderr).toContain('record-ui-validation 42 --mockup <link-or-path> --approved-by <name>')
      expect(res.stderr).toContain('"UI mockup guard"')
      expect(calls(sandbox, 'update-status')).toEqual([])
    })

    it('lets a ui ticket through once a mockup has been validated', async () => {
      const res = await runCli(['update-status', '42', 'Human testing'], sandbox, { FAKE_LABELS: 'complexity: low\nui', FAKE_UI_VALIDATION: MOCKUP_RECORD, FAKE_PR_DRAFT: '1' })

      expect(res.code).toBe(0)
      expect(calls(sandbox, 'update-status')).toEqual(['update-status 42 Human testing'])
    })

    it('passes a ticket without the ui marker exactly as before', async () => {
      const res = await runCli(['update-status', '42', 'Human testing'], sandbox, { FAKE_LABELS: 'complexity: low', FAKE_PR_DRAFT: '1' })

      expect(res.code).toBe(0)
      expect(calls(sandbox, 'get-ui-validation')).toEqual([])
      expect(calls(sandbox, 'update-status')).toEqual(['update-status 42 Human testing'])
    })

    it('also guards the move to In review of a ticket that skips Human testing', async () => {
      const refused = await runCli(['update-status', '42', 'In review'], sandbox, { FAKE_LABELS: 'complexity: low\nnature:internal\nui' })
      expect(refused.code).toBe(2)
      expect(refused.stderr).toContain("cannot move it to 'In review'")

      const allowed = await runCli(['update-status', '42', 'In review'], sandbox, { FAKE_LABELS: 'complexity: low\nnature:internal\nui', FAKE_UI_VALIDATION: SUPPLIED_RECORD })
      expect(allowed.code).toBe(0)
      expect(calls(sandbox, 'update-status')).toEqual(['update-status 42 In review'])
    })

    it('does not ask again on the way from Human testing to In review once the record exists', async () => {
      const res = await runCli(['update-status', '42', 'In review'], sandbox, { FAKE_LABELS: 'ui', FAKE_UI_VALIDATION: MOCKUP_RECORD, FAKE_TICKET_STATUS: 'Human testing' })

      expect(res.code).toBe(0)
      expect(calls(sandbox, 'update-status')).toEqual(['update-status 42 In review'])
    })
  })

  describe('the escape hatch SF_WORKFLOW_BYPASS_UI_MOCKUP_GUARD', () => {
    beforeEach(async () => {
      sandbox = await buildSandbox({ statuses: SOLO_STATUSES })
    })

    it('lifts the refusal, names itself on stderr and reads no record', async () => {
      const res = await runCli(['update-status', '42', 'In review'], sandbox, { FAKE_LABELS: 'ui', SF_WORKFLOW_BYPASS_UI_MOCKUP_GUARD: '1' })

      expect(res.code).toBe(0)
      expect(res.stderr).toContain('SF_WORKFLOW_BYPASS_UI_MOCKUP_GUARD')
      expect(calls(sandbox, 'get-ui-validation')).toEqual([])
      expect(calls(sandbox, 'update-status')).toEqual(['update-status 42 In review'])
    })

    it('is recorded on the ticket with its reason, like the other environment hatches', async () => {
      await runCli(['update-status', '42', 'In review'], sandbox, {
        FAKE_LABELS: 'ui',
        SF_WORKFLOW_BYPASS_UI_MOCKUP_GUARD: '1',
        SF_WORKFLOW_BYPASS_REASON: 'the developer reviewed the screens in a call'
      })

      expect(readLog(sandbox.toolLogPath)).toContain('comment 42 -')
      const comment = readFileSync(`${sandbox.toolLogPath}.comment`, 'utf8')
      expect(comment).toContain('`SF_WORKFLOW_BYPASS_UI_MOCKUP_GUARD=1`')
      expect(comment).toContain('`In review`')
      expect(comment).toContain('Reason: the developer reviewed the screens in a call')
    })

    it.each([['0'], ['true'], ['']])('is honoured only when set to exactly 1 (got %j)', async (value) => {
      const res = await runCli(['update-status', '42', 'In review'], sandbox, { FAKE_LABELS: 'ui', SF_WORKFLOW_BYPASS_UI_MOCKUP_GUARD: value })

      expect(res.code).toBe(2)
    })

    it('lifts nothing else: a ticket still needs its other guards', async () => {
      const res = await runCli(['update-status', '42', 'In review'], sandbox, { FAKE_LABELS: 'ui', SF_WORKFLOW_BYPASS_UI_MOCKUP_GUARD: '1', FAKE_PR_DRAFT: '1' })

      expect(res.code).toBe(2)
      expect(res.stderr).toContain('non-draft PR')
    })
  })

  describe('the commands of the marker and of the record', () => {
    beforeEach(async () => {
      sandbox = await buildSandbox({ statuses: SOLO_STATUSES })
    })

    it.each([
      [['set-ui', '42'], 'set-ui 42'],
      [['clear-ui', '42'], 'clear-ui 42'],
      [['record-ui-validation', '42', '--supplied', 'their mockup'], 'record-ui-validation 42 --supplied their mockup'],
      [['get-ui-validation', '42'], 'get-ui-validation 42'],
      [['create-ticket', 'story', 'Redesign the login', '--ui'], 'create-ticket story Redesign the login --ui'],
      [['create-subtask', '7', 'Settings page', '--ui'], 'create-subtask 7 Settings page --ui']
    ])('workflow-cli.sh %j reaches the board tool', async (args, expected) => {
      const res = await runCli(args, sandbox)

      expect(res.code).toBe(0)
      expect(readLog(sandbox.toolLogPath)).toContain(expected)
    })

    it('is described in the usage of the CLI', async () => {
      const res = await runCli([], sandbox)

      expect(res.stdout).toContain('create-ticket <story|task|issue> <title>')
      expect(res.stdout).toContain('[--ui]')
      expect(res.stdout).toContain('set-ui <ticket>')
      expect(res.stdout).toContain('clear-ui <ticket>')
      expect(res.stdout).toContain('record-ui-validation <ticket>')
      expect(res.stdout).toContain('get-ui-validation <ticket>')
    })
  })

  describe('a workflow tool that cannot read the record', () => {
    beforeEach(async () => {
      sandbox = await buildSandbox({ statuses: SOLO_STATUSES, tool: 'jira' })
    })

    it.each([['set-ui'], ['clear-ui'], ['record-ui-validation'], ['get-ui-validation']])('refuses %s with exit 2, naming the adapter', async (command) => {
      const res = await runCli([command, '42'], sandbox)

      expect(res.code).toBe(2)
      expect(res.stderr).toContain("The 'jira' adapter does not implement the ui marker yet")
      expect(res.stderr).toContain('Supported today: github-projects')
      expect(readLog(sandbox.toolLogPath)).toEqual([])
    })

    it('does not guard a transition on a marker it cannot read back', async () => {
      const res = await runCli(['update-status', '42', 'In review'], sandbox, { FAKE_LABELS: 'ui' })

      expect(res.code).toBe(0)
      expect(res.stderr).not.toContain('mockup validation record')
      expect(calls(sandbox, 'get-ui-validation')).toEqual([])
    })
  })
})
