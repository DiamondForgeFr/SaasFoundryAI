import { execFile } from 'child_process'
import { mkdtempSync, readFileSync } from 'fs'
import { mkdir, rm, writeFile, chmod } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const CLI = path.resolve(REPO_ROOT, '.claude/skills/sf-workflow/workflow-cli.sh')
const BASH = '/bin/bash'

interface Run {
  stdout: string
  stderr: string
  code: number
}

async function runIn(dir: string, args: string[]): Promise<Run> {
  const child = execFile(BASH, [CLI, ...args], { cwd: dir })
  const out: string[] = []
  const err: string[] = []
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (c: string) => out.push(c))
  child.stderr?.on('data', (c: string) => err.push(c))
  const code = await new Promise<number>((resolve) => child.on('close', (c) => resolve(c ?? 0)))
  return { stdout: out.join(''), stderr: err.join(''), code }
}

interface Sandbox {
  dir: string
  toolLog: string
  cleanup: () => Promise<void>
}

/** A project whose workflow tool is `tool`, with a shim CLI that records what it was asked to do. */
async function sandbox(tool: string): Promise<Sandbox> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-wfcli-ms-'))
  const toolDir = path.join(dir, `.claude/skills/sf-tool-${tool}`)
  const toolLog = path.join(dir, 'tool-calls.log')
  await mkdir(toolDir, { recursive: true })
  await writeFile(path.join(dir, '.saasfoundry.json'), JSON.stringify({ workflow: { tool, projectUrl: 'https://github.com/orgs/FakeOrg/projects/42', workingBranch: 'develop' } }))

  const shim = path.join(toolDir, `${tool}-cli.sh`)
  await writeFile(shim, `#!/bin/bash\nprintf '%s\\n' "$*" >> '${toolLog}'\nexit 0\n`)
  await chmod(shim, 0o755)

  return { dir, toolLog, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

const logOf = (box: Sandbox): string => {
  try {
    return readFileSync(box.toolLog, 'utf8')
  } catch {
    return ''
  }
}

describe('workflow-cli.sh milestone', () => {
  let box: Sandbox

  beforeEach(async () => {
    box = await sandbox('github-projects')
  })
  afterEach(async () => {
    await box.cleanup()
  })

  describe('the command surface', () => {
    it('prints usage and exits 0 for `milestone help`', async () => {
      const res = await runIn(box.dir, ['milestone', 'help'])
      expect(res.code).toBe(0)
      expect(res.stderr).toContain('milestone <subcommand>')
      expect(res.stderr).toContain('associate <name> <version-page>')
    })

    it('states that a milestone reports and never blocks', async () => {
      // The decision recorded on #542: a hard gate would contradict "the tag is a joint
      // call", and a gate that blocks a hotfix gets disabled for good within a month.
      const res = await runIn(box.dir, ['milestone', 'help'])
      expect(res.stderr).toContain('never blocks a release')
    })

    it('refuses an unknown subcommand instead of forwarding it', async () => {
      const res = await runIn(box.dir, ['milestone', 'obliterate'])
      expect(res.code).toBe(1)
      expect(res.stderr).toContain('Unknown milestone subcommand')
      expect(logOf(box)).toBe('')
    })

    it('exits 1 with usage when no subcommand is given', async () => {
      const res = await runIn(box.dir, ['milestone'])
      expect(res.code).toBe(1)
      expect(res.stderr).toContain('milestone <subcommand>')
    })
  })

  describe('argument validation happens before anything is routed', () => {
    // A tool CLI called with half its arguments is how half-created objects appear on a
    // board. Every refusal below must leave the adapter untouched.
    const cases: Array<[string, string[], string]> = [
      ['create with no name', ['milestone', 'create'], 'milestone create <name>'],
      ['show with no name', ['milestone', 'show'], 'milestone show <name>'],
      ['scope with no name', ['milestone', 'scope'], 'milestone scope <name>'],
      ['assign with no milestone', ['milestone', 'assign', '123'], 'milestone assign <ticket> <name>'],
      ['associate with no version page', ['milestone', 'associate', 'v1.0.0'], 'milestone associate <name> <version-page-url-or-id>'],
      ['readiness with no name', ['milestone', 'readiness'], 'milestone readiness <name>']
    ]

    it.each(cases)('refuses %s', async (_label, args, expected) => {
      const res = await runIn(box.dir, args)
      expect(res.code).toBe(1)
      expect(res.stderr).toContain(expected)
      expect(logOf(box)).toBe('')
    })

    it('says what a milestone name is, since it is the easiest thing to get wrong', async () => {
      const res = await runIn(box.dir, ['milestone', 'create'])
      expect(res.stderr).toContain('the release, e.g. v1.0.0')
      expect(res.stderr).toContain('not the version page title')
    })
  })

  describe('dispatch', () => {
    it('routes a valid call to the tool CLI, subcommand and arguments intact', async () => {
      const res = await runIn(box.dir, ['milestone', 'create', 'v1.0.0', '--description', 'the first release'])
      expect(res.code).toBe(0)
      expect(logOf(box).trim()).toBe('milestone create v1.0.0 --description the first release')
    })

    it('routes `list` with no arguments', async () => {
      const res = await runIn(box.dir, ['milestone', 'list'])
      expect(res.code).toBe(0)
      expect(logOf(box).trim()).toBe('milestone list')
    })

    it('routes `readiness`, acknowledgement and all', async () => {
      await runIn(box.dir, ['milestone', 'readiness', 'v1.0.0', '--acknowledge', 'shipping without the docs pass'])
      expect(logOf(box).trim()).toBe('milestone readiness v1.0.0 --acknowledge shipping without the docs pass')
    })

    it('says in its own usage that exit 2 is a prompt, not a refusal', async () => {
      const res = await runIn(box.dir, ['milestone', 'readiness'])
      expect(res.stderr).toContain('never a refusal')
      expect(res.stderr).toContain('--acknowledge')
    })

    it('routes `associate`, which is what keeps a version linked rather than merged', async () => {
      // R2 on #542: one milestone per release, several version pages may point at it.
      await runIn(box.dir, ['milestone', 'associate', 'v1.0.0', 'https://notion.so/abc'])
      expect(logOf(box).trim()).toBe('milestone associate v1.0.0 https://notion.so/abc')
    })
  })

  describe('an adapter that cannot do milestones says so', () => {
    it('exits 2 — refused on purpose, not broken', async () => {
      // exit-codes.md: 2 is "the CLI said no on purpose". A caller can tell that apart from
      // a failure and route the user somewhere, which exit 1 would not allow.
      const jira = await sandbox('jira')
      try {
        const res = await runIn(jira.dir, ['milestone', 'list'])
        expect(res.code).toBe(2)
        expect(res.stderr).toContain('does not implement milestones')
        expect(res.stderr).toContain('Supported today: github-projects')
        expect(logOf(jira)).toBe('')
      } finally {
        await jira.cleanup()
      }
    })

    it('still validates arguments first, so the message is about the tool and not the typo', async () => {
      const jira = await sandbox('jira')
      try {
        const res = await runIn(jira.dir, ['milestone', 'create'])
        expect(res.code).toBe(1)
        expect(res.stderr).toContain('milestone create <name>')
        expect(res.stderr).not.toContain('does not implement')
      } finally {
        await jira.cleanup()
      }
    })
  })
})
