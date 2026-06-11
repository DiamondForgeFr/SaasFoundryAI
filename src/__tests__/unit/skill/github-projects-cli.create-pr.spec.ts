import { execFile } from 'node:child_process'
import { chmodSync, mkdtempSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

// Regression guard for #435: `cmd_create_pr` detected success by grepping the
// captured `gh pr create` output for "http" — but gh error messages routinely
// contain URLs (compare links, doc links), and under `set -e` a failing
// command substitution killed the script before the check, swallowing the
// error entirely (observed live on #424: exit masked, no PR, no message).
// The contract pinned here: success = gh exit 0 AND a real `/pull/<n>` URL;
// anything else must exit non-zero AND surface gh's output.
const CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-tool-github-projects/github-projects-cli.sh')
const BASH = '/bin/bash'

async function buildSandbox(): Promise<{ dir: string; env: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-gh-create-pr-'))
  const binDir = path.join(dir, 'bin')
  await mkdir(binDir, { recursive: true })

  await writeFile(
    path.join(dir, '.saasfoundry.json'),
    JSON.stringify({
      workflow: { projectUrl: 'https://github.com/orgs/FakeOrg/projects/42', workingBranch: 'develop' }
    })
  )

  // gh shim — `issue view` returns a title; `pr create` behavior is driven by
  // GH_PR_CREATE_MODE (ok | ok-no-url | fail-with-url).
  const ghShim = `#!/bin/bash
case "$1" in
  issue)
    echo "Sample ticket title"
    ;;
  pr)
    case "$GH_PR_CREATE_MODE" in
      ok)
        echo "https://github.com/FakeOrg/FakeRepo/pull/123"
        exit 0
        ;;
      ok-no-url)
        echo "warning: something unexpected, no PR url printed"
        exit 0
        ;;
      *)
        echo "pull request create failed: GraphQL: was submitted too quickly"
        echo "see https://docs.github.com/en/rest/pulls for more information"
        exit 1
        ;;
    esac
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`
  const gitShim = `#!/bin/bash
case "$1" in
  rev-parse) echo "fix/999-sandbox" ;;
  *) exit 0 ;;
esac
`
  await writeFile(path.join(binDir, 'gh'), ghShim)
  await writeFile(path.join(binDir, 'git'), gitShim)
  chmodSync(path.join(binDir, 'gh'), 0o755)
  chmodSync(path.join(binDir, 'git'), 0o755)

  const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}` }
  return { dir, env, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

async function runCreatePr(env: NodeJS.ProcessEnv, cwd: string): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await execFileP(BASH, [CLI, 'create-pr', '999'], { env, cwd })
    return { code: 0, output: `${stdout}\n${stderr}` }
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string }
    return { code: e.code ?? 1, output: `${e.stdout ?? ''}\n${e.stderr ?? ''}` }
  }
}

describe('github-projects-cli create-pr (regression #435)', () => {
  let sandbox: Awaited<ReturnType<typeof buildSandbox>>

  beforeEach(async () => {
    sandbox = await buildSandbox()
  })

  afterEach(async () => {
    await sandbox.cleanup()
  })

  it('fails loudly when gh pr create exits non-zero, even if its error output contains a URL', async () => {
    const { code, output } = await runCreatePr({ ...sandbox.env, GH_PR_CREATE_MODE: 'fail-with-url' }, sandbox.dir)

    expect(code).not.toBe(0)
    expect(output).not.toContain('Pull request created')
    expect(output).toContain('Error creating PR')
    // gh's actual error must surface (it was silently swallowed by set -e before the fix)
    expect(output).toContain('was submitted too quickly')
  })

  it('fails when gh exits 0 but prints no PR URL', async () => {
    const { code, output } = await runCreatePr({ ...sandbox.env, GH_PR_CREATE_MODE: 'ok-no-url' }, sandbox.dir)

    expect(code).not.toBe(0)
    expect(output).toContain('Error creating PR')
  })

  it('succeeds and prints the PR URL when gh exits 0 with a real /pull/<n> URL', async () => {
    const { code, output } = await runCreatePr({ ...sandbox.env, GH_PR_CREATE_MODE: 'ok' }, sandbox.dir)

    expect(code).toBe(0)
    expect(output).toContain('Pull request created')
    expect(output).toContain('https://github.com/FakeOrg/FakeRepo/pull/123')
  })
})
