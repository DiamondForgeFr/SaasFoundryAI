import { execFile } from 'child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileP = promisify(execFile)

const CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-tool-github-projects/github-projects-cli.sh')
const BASH = '/bin/bash'
const MARKER = '<!-- sf-ui-validation:v1 -->'

interface Sandbox {
  dir: string
  env: NodeJS.ProcessEnv
  logPath: string
  commentPath: string
  commentsFile: string
  cleanup: () => Promise<void>
}

/**
 * A sandbox whose `gh` logs every call, knows one board (42) and creates issue 12 (and links it as a subtask of 7).
 * FAKE_LABELS is what `gh issue view --json labels` answers (one label per line), FAKE_LABEL_EXISTS makes
 * `label create` refuse, FAKE_UI_EDIT_FAILS makes the edit that adds or removes `ui` fail, FAKE_COMMENTS_FAIL makes
 * the comments read fail. The comments the REST read returns are the content of FAKE_COMMENTS_FILE, and the body
 * of the last `issue comment` is kept next to the log.
 */
async function buildSandbox(): Promise<Sandbox> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-gh-ui-marker-'))
  const binDir = path.join(dir, 'bin')
  const cacheDir = path.join(dir, 'cache')
  const logPath = path.join(dir, 'gh-calls.log')
  const commentPath = `${logPath}.comment`
  const commentsFile = path.join(dir, 'comments.json')
  await mkdir(binDir, { recursive: true })
  await mkdir(cacheDir, { recursive: true })
  await writeFile(path.join(dir, '.saasfoundry.json'), JSON.stringify({ workflow: { tool: 'github-projects', projectUrl: 'https://github.com/orgs/FakeOrg/projects/42', workingBranch: 'develop' } }))
  await writeFile(commentsFile, '[[]]')

  const shim = `#!/bin/bash
printf '%s\\n' "$*" >> '${logPath}'
case "$1 $2" in
  "repo view") echo "FakeOrg/FakeRepo" ;;
  "project view") echo '{"id":"PVT_FAKE"}' ;;
  "project field-list") echo '{"fields":[{"id":"PVTSSF_FAKE","name":"Status","options":[{"id":"opt_backlog","name":"Backlog"}]}]}' ;;
  "project item-add") echo "PVTI_NEW" ;;
  "project item-edit") echo '{"id":"PVTI_NEW"}' ;;
  "label create")
    if [ -n "\${FAKE_LABEL_EXISTS:-}" ]; then echo 'label already exists' >&2; exit 1; fi
    echo "created" ;;
  "issue create") echo "https://github.com/FakeOrg/FakeRepo/issues/12" ;;
  "issue comment")
    if [ -n "\${FAKE_COMMENT_FAILS:-}" ]; then cat > /dev/null; exit 1; fi
    cat > '${commentPath}' ;;
  "issue edit")
    if [ -n "\${FAKE_UI_EDIT_FAILS:-}" ]; then
      case "$*" in *"label ui"*|*"-label ui"*) exit 1 ;; esac
    fi
    echo "https://github.com/FakeOrg/FakeRepo/issues/12" ;;
  "issue view")
    case "$*" in
      *"--json labels"*) printf '%s' "\${FAKE_LABELS:-}" ;;
      *"--json id"*) echo "I_NODE" ;;
      *"--json milestone"*) echo "" ;;
      *) echo "https://github.com/FakeOrg/FakeRepo/issues/12" ;;
    esac ;;
  "api graphql") echo '{"data":{"addSubIssue":{"issue":{"number":7,"title":"p"},"subIssue":{"number":12,"title":"c"}},"repository":{"issue":{"title":"T","state":"OPEN","projectItems":{"nodes":[]}}}}}' ;;
  "api --paginate")
    case "$*" in
      *"/issues/12/comments?per_page=100"*)
        if [ -n "\${FAKE_COMMENTS_FAIL:-}" ]; then exit 1; fi
        cat "\${FAKE_COMMENTS_FILE}" ;;
      *) echo '[[]]' ;;
    esac ;;
  *) echo '{}' ;;
esac
`
  writeFileSync(path.join(binDir, 'gh'), shim)
  chmodSync(path.join(binDir, 'gh'), 0o755)
  return {
    dir,
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, SF_CACHE_DIR: cacheDir, PWD: dir, FAKE_COMMENTS_FILE: commentsFile },
    logPath,
    commentPath,
    commentsFile,
    cleanup: () => rm(dir, { recursive: true, force: true })
  }
}

const calls = (logPath: string): string[] => {
  try {
    return readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
}

// #1305 — a ticket that changes the user interface carries a `ui` marker, and the mockup the developer validated is
// a ticket comment the guard of update-status can read back
describe('github-projects-cli.sh — the ui marker and the mockup validation record (#1305)', () => {
  let sandbox: Sandbox

  beforeEach(async () => {
    sandbox = await buildSandbox()
  })
  afterEach(async () => {
    await sandbox.cleanup()
  })

  const run = async (args: string[], env: NodeJS.ProcessEnv = {}) => {
    try {
      const { stdout, stderr } = await execFileP(BASH, [CLI, ...args], { cwd: sandbox.dir, env: { ...sandbox.env, ...env } })
      return { stdout, stderr, code: 0 }
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; code?: number }
      return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
    }
  }
  const posted = (): string => readFileSync(sandbox.commentPath, 'utf8')
  /** Serve `bodies` as the comments of ticket 12, in one page. */
  const serveComments = async (...bodies: (string | null)[]): Promise<void> => writeFile(sandbox.commentsFile, JSON.stringify([bodies.map((body) => ({ body }))]))

  describe('set-ui and clear-ui', () => {
    it('creates the label when it is missing, then puts it on the ticket', async () => {
      const result = await run(['set-ui', '12'])

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('✓ Ticket #12 marked ui')
      const log = calls(sandbox.logPath)
      expect(log.some((call) => call.startsWith('label create ui --color 5319E7'))).toBe(true)
      expect(log).toContain('issue edit 12 --add-label ui')
      expect(log.indexOf('issue edit 12 --add-label ui')).toBeGreaterThan(log.findIndex((call) => call.startsWith('label create ui')))
    })

    it('goes on when the label already exists', async () => {
      const result = await run(['set-ui', '12'], { FAKE_LABEL_EXISTS: '1' })

      expect(result.code).toBe(0)
      expect(calls(sandbox.logPath)).toContain('issue edit 12 --add-label ui')
    })

    it('fails when the label cannot be put on the ticket', async () => {
      const result = await run(['set-ui', '12'], { FAKE_UI_EDIT_FAILS: '1' })

      expect(result.code).toBe(1)
      expect(result.stderr).toContain('could not mark #12 as ui')
    })

    it.each([[['set-ui']], [['set-ui', 'abc']], [['set-ui', '12', '13']], [['clear-ui']], [['clear-ui', '0']]])('refuses %j with the usage', async (args) => {
      const result = await run(args)

      expect(result.code).toBe(1)
      expect(result.stderr).toContain('Usage:')
      expect(calls(sandbox.logPath).some((call) => call.startsWith('issue edit'))).toBe(false)
    })

    it('removes the marker when the ticket carries it, whatever the case of the label', async () => {
      const result = await run(['clear-ui', '12'], { FAKE_LABELS: 'complexity: low\nUI' })

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('✓ Ticket #12 is no longer marked ui')
      expect(calls(sandbox.logPath)).toContain('issue edit 12 --remove-label ui')
    })

    it('does nothing when the ticket carries no marker', async () => {
      const result = await run(['clear-ui', '12'], { FAKE_LABELS: 'complexity: low\nuix' })

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('carries no ui marker')
      expect(calls(sandbox.logPath).some((call) => call.includes('--remove-label'))).toBe(false)
    })

    it('fails when the marker cannot be removed', async () => {
      const result = await run(['clear-ui', '12'], { FAKE_LABELS: 'ui', FAKE_UI_EDIT_FAILS: '1' })

      expect(result.code).toBe(1)
      expect(result.stderr).toContain('could not clear the ui marker of #12')
    })
  })

  describe('--ui on create-ticket and create-subtask', () => {
    it('create-ticket --ui labels the new ticket ui', async () => {
      const result = await run(['create-ticket', 'story', 'Redesign the login', '--ui'])

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('✓ Ticket #12 marked ui')
      expect(calls(sandbox.logPath)).toContain('issue edit 12 --add-label ui')
    })

    it('create-ticket without --ui puts no marker', async () => {
      const result = await run(['create-ticket', 'story', 'Show the version'])

      expect(result.code).toBe(0)
      expect(calls(sandbox.logPath).some((call) => call.includes('label ui') || call.startsWith('label create'))).toBe(false)
    })

    it('create-ticket --ui names the command that finishes the ticket when the marker cannot be set', async () => {
      const result = await run(['create-ticket', 'story', 'Redesign the login', '--ui'], { FAKE_UI_EDIT_FAILS: '1' })

      expect(result.code).toBe(1)
      expect(result.stdout).toContain('✓ Ticket #12 created')
      expect(result.stderr).toContain('Ticket #12 exists, but these steps failed')
      expect(result.stderr).toContain('set-ui 12')
    })

    it('create-ticket accepts --ui next to the other options, wherever it stands', async () => {
      const result = await run(['create-ticket', '--ui', 'task', 'Restyle the table', '--complexity', 'low'])

      expect(result.code).toBe(0)
      const log = calls(sandbox.logPath)
      expect(log).toContain('issue edit 12 --add-label ui')
      expect(log).toContain('issue edit 12 --add-label complexity: low')
    })

    it('create-subtask --ui labels the new subtask ui', async () => {
      const result = await run(['create-subtask', '7', 'Settings page', '--ui'])

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('✓ Subtask #12 linked to parent #7')
      expect(result.stdout).toContain('✓ Ticket #12 marked ui')
      expect(calls(sandbox.logPath)).toContain('issue edit 12 --add-label ui')
    })

    it('create-subtask without --ui puts no marker', async () => {
      const result = await run(['create-subtask', '7', 'Settings page'])

      expect(result.code).toBe(0)
      expect(calls(sandbox.logPath).some((call) => call.includes('--add-label ui'))).toBe(false)
    })

    it('create-subtask --ui is an error naming set-ui when the marker cannot be set', async () => {
      const result = await run(['create-subtask', '7', 'Settings page', '--ui'], { FAKE_UI_EDIT_FAILS: '1' })

      expect(result.code).toBe(1)
      expect(result.stderr).toContain('Subtask #12 exists, but the ui marker could not be set')
      expect(result.stderr).toContain('set-ui 12')
    })
  })

  describe('record-ui-validation', () => {
    it('records a validated mockup: its link, who approved it and when', async () => {
      const result = await run(['record-ui-validation', '12', '--mockup', 'docs/mockups/login.html', '--approved-by', 'Ada Lovelace', '--date', '2026-11-23'], { FAKE_LABELS: 'ui' })

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('✓ UI mockup validation recorded on #12')
      expect(result.stderr).not.toContain('no ui marker')
      expect(calls(sandbox.logPath)).toContain('issue comment 12 --body-file -')
      expect(posted().split('\n')[0]).toBe(MARKER)
      expect(posted()).toContain('## UI mockup validation')
      expect(posted()).toContain('- Kind: mockup\n- Mockup: docs/mockups/login.html\n- Approved by: Ada Lovelace\n- Approved on: 2026-11-23\n')
    })

    it('records visuals supplied by the developer with what was supplied', async () => {
      const result = await run(['record-ui-validation', '12', '--supplied', 'an exact target screenshot, login-target.png', '--date', '2026-11-24'], { FAKE_LABELS: 'ui' })

      expect(result.code).toBe(0)
      expect(posted().split('\n')[0]).toBe(MARKER)
      expect(posted()).toContain('- Kind: supplied by the developer\n- Supplied: an exact target screenshot, login-target.png\n- Recorded on: 2026-11-24\n')
      expect(posted()).not.toContain('Approved')
    })

    it('dates the record today when no date is given', async () => {
      await run(['record-ui-validation', '12', '--mockup', 'https://figma.example/file/1', '--approved-by', 'Ada'], { FAKE_LABELS: 'ui' })

      expect(posted()).toMatch(/- Approved on: \d{4}-\d{2}-\d{2}\n/)
    })

    it('still records, and says so, when the ticket carries no ui marker', async () => {
      const result = await run(['record-ui-validation', '12', '--supplied', 'their mockup', '--date', '2026-11-24'], { FAKE_LABELS: 'complexity: low' })

      expect(result.code).toBe(0)
      expect(result.stderr).toContain('#12 carries no ui marker, so update-status does not read this record')
      expect(result.stderr).toContain('set-ui 12')
      expect(posted()).toContain('- Supplied: their mockup')
    })

    it.each([
      ['no ticket', ['record-ui-validation'], 'Usage:'],
      ['a ticket that is not a number', ['record-ui-validation', 'abc', '--supplied', 'x'], 'Usage:'],
      ['neither a mockup nor supplied visuals', ['record-ui-validation', '12'], 'either --mockup'],
      ['both a mockup and supplied visuals', ['record-ui-validation', '12', '--mockup', 'm.html', '--approved-by', 'Ada', '--supplied', 'x'], 'either --mockup'],
      ['a mockup with no approver', ['record-ui-validation', '12', '--mockup', 'm.html'], '--mockup needs --approved-by'],
      ['an approver for supplied visuals', ['record-ui-validation', '12', '--supplied', 'x', '--approved-by', 'Ada'], '--approved-by belongs to --mockup'],
      ['a flag with no value', ['record-ui-validation', '12', '--mockup'], '--mockup requires a value'],
      ['a flag that swallows the next flag', ['record-ui-validation', '12', '--mockup', '--approved-by', 'Ada'], '--mockup requires a value'],
      ['an unknown option', ['record-ui-validation', '12', '--supplied', 'x', '--frobnicate'], "unknown record-ui-validation option '--frobnicate'"],
      ['a date that is not a calendar date', ['record-ui-validation', '12', '--supplied', 'x', '--date', '2026-13-01'], '--date must be a calendar date'],
      ['a date written another way', ['record-ui-validation', '12', '--supplied', 'x', '--date', '23/11/2026'], '--date must be a calendar date'],
      ['a value on several lines', ['record-ui-validation', '12', '--supplied', 'line one\nline two'], 'fits on one line']
    ])('refuses %s before writing anything', async (_label, args, message) => {
      const result = await run(args)

      expect(result.code).toBe(1)
      expect(result.stdout + result.stderr).toContain(message)
      expect(calls(sandbox.logPath).some((call) => call.startsWith('issue comment'))).toBe(false)
    })

    it('fails, and says nothing was recorded, when the comment cannot be posted', async () => {
      const result = await run(['record-ui-validation', '12', '--supplied', 'x'], { FAKE_COMMENT_FAILS: '1' })

      expect(result.code).toBe(1)
      expect(result.stderr).toContain('could not record the UI mockup validation on #12')
      expect(result.stdout).not.toContain('✓ UI mockup validation recorded')
    })
  })

  describe('get-ui-validation', () => {
    const mockupRecord = (extra = ''): string =>
      `${MARKER}\n## UI mockup validation\n\n- Kind: mockup\n- Mockup: docs/mockups/login.html\n- Approved by: Ada Lovelace\n- Approved on: 2026-11-23\n${extra}`
    const suppliedRecord = `${MARKER}\n## UI mockup validation\n\n- Kind: supplied by the developer\n- Supplied: an exact target screenshot\n- Recorded on: 2026-11-24\n`

    it('prints nothing, and succeeds, when the ticket has no record', async () => {
      await serveComments('Created without an SRS source (`--bypass-srs`). Reason: spawned-from-srs', '## Test plan')

      const result = await run(['get-ui-validation', '12'])

      expect(result.code).toBe(0)
      expect(result.stdout).toBe('')
    })

    it('prints nothing when the ticket has no comment at all', async () => {
      const result = await run(['get-ui-validation', '12'])

      expect(result.code).toBe(0)
      expect(result.stdout).toBe('')
    })

    it('reads a validated mockup back as one line of JSON', async () => {
      await serveComments('first comment', mockupRecord())

      const result = await run(['get-ui-validation', '12'])

      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({ kind: 'mockup', mockup: 'docs/mockups/login.html', approvedBy: 'Ada Lovelace', date: '2026-11-23' })
      expect(result.stdout.trim().split('\n')).toHaveLength(1)
    })

    it('reads visuals supplied by the developer back', async () => {
      await serveComments(suppliedRecord)

      const result = await run(['get-ui-validation', '12'])

      expect(JSON.parse(result.stdout)).toEqual({ kind: 'supplied', supplied: 'an exact target screenshot', date: '2026-11-24' })
    })

    it('reads exactly what record-ui-validation wrote', async () => {
      await run(['record-ui-validation', '12', '--mockup', 'https://figma.example/design: v2 (final)', '--approved-by', 'Ada Lovelace', '--date', '2026-11-23'], { FAKE_LABELS: 'ui' })
      await serveComments(posted())

      const result = await run(['get-ui-validation', '12'])

      expect(JSON.parse(result.stdout)).toEqual({ kind: 'mockup', mockup: 'https://figma.example/design: v2 (final)', approvedBy: 'Ada Lovelace', date: '2026-11-23' })
    })

    it('keeps the latest record when several were made', async () => {
      await serveComments(mockupRecord(), 'a later comment', suppliedRecord)

      const result = await run(['get-ui-validation', '12'])

      expect(JSON.parse(result.stdout)).toMatchObject({ kind: 'supplied' })
    })

    it('reads the records of every page of comments', async () => {
      await writeFile(sandbox.commentsFile, JSON.stringify([[{ body: 'page one' }], [{ body: mockupRecord() }]]))

      const result = await run(['get-ui-validation', '12'])

      expect(JSON.parse(result.stdout)).toMatchObject({ kind: 'mockup' })
    })

    it('does not take a comment that merely quotes the marker for a record', async () => {
      await serveComments(`> ${MARKER}\n> - Kind: mockup`, `Please record it, the marker is ${MARKER}`, `see below\n${mockupRecord()}`, null)

      const result = await run(['get-ui-validation', '12'])

      expect(result.code).toBe(0)
      expect(result.stdout).toBe('')
    })

    // jq 1.8 (the GitHub runner) fails `null | rtrimstr(...)`, and the first line of a comment with no text is null (#1305)
    it.each([
      ['an empty comment', ''],
      ['a comment with no body', null],
      ['a comment of blank lines', '\n\n']
    ])('reads past %s to the record that follows', async (_label, body) => {
      await serveComments(body, mockupRecord())

      const result = await run(['get-ui-validation', '12'])

      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ kind: 'mockup', mockup: 'docs/mockups/login.html' })
    })

    it.each([
      ['a mockup with no approver', `${MARKER}\n- Kind: mockup\n- Mockup: m.html\n- Approved on: 2026-11-23\n`],
      ['a mockup with no date', `${MARKER}\n- Kind: mockup\n- Mockup: m.html\n- Approved by: Ada\n`],
      ['a mockup with no link', `${MARKER}\n- Kind: mockup\n- Approved by: Ada\n- Approved on: 2026-11-23\n`],
      ['supplied visuals with nothing named', `${MARKER}\n- Kind: supplied by the developer\n- Recorded on: 2026-11-24\n`],
      ['a kind it does not know', `${MARKER}\n- Kind: verbal\n- Mockup: m.html\n- Approved by: Ada\n- Approved on: 2026-11-23\n`],
      ['empty values', `${MARKER}\n- Kind: mockup\n- Mockup:\n- Approved by: \n- Approved on: \n`]
    ])('does not take %s for a record', async (_label, body) => {
      await serveComments(body)

      const result = await run(['get-ui-validation', '12'])

      expect(result.code).toBe(0)
      expect(result.stdout).toBe('')
    })

    it('fails, rather than saying there is no record, when the comments cannot be read', async () => {
      const result = await run(['get-ui-validation', '12'], { FAKE_COMMENTS_FAIL: '1' })

      expect(result.code).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('could not read the comments of #12')
    })

    it('fails when the answer is not a list of pages of comments', async () => {
      await writeFile(sandbox.commentsFile, '{"message":"Not Found"}')

      const result = await run(['get-ui-validation', '12'])

      expect(result.code).toBe(1)
      expect(result.stderr).toContain('invalid comments response for #12')
    })

    it.each([[['get-ui-validation']], [['get-ui-validation', 'x']], [['get-ui-validation', '12', '13']]])('refuses %j with the usage', async (args) => {
      const result = await run(args)

      expect(result.code).toBe(1)
      expect(result.stderr).toContain('Usage:')
    })
  })
})
