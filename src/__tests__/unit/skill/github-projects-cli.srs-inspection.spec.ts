import { execFile } from 'child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileP = promisify(execFile)
const REPO_ROOT = path.resolve(__dirname, '../../../..')
const CLI = path.resolve(REPO_ROOT, '.claude/skills/sf-tool-github-projects/github-projects-cli.sh')

async function sandbox() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-gh-srs-inspection-'))
  const bin = path.join(dir, 'bin')
  await mkdir(bin)
  await writeFile(path.join(dir, '.saasfoundry.json'), JSON.stringify({ workflow: { projectUrl: 'https://github.com/orgs/Fake/projects/42' } }))
  const issues = [
    {
      number: 10,
      title: 'FR-MAH-001: Existing',
      body: 'FR page: https://app.notion.com/p/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      state: 'closed',
      html_url: 'https://github.test/issues/10',
      parent_issue_url: 'https://api.github.test/issues/42',
      type: { name: 'sf-story' },
      labels: []
    },
    {
      number: 11,
      title: 'Renamed requirement',
      body: 'FR-MAH-002\nFR page: https://app.notion.com/p/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb?source=copy',
      state: 'open',
      html_url: 'https://github.test/issues/11',
      parent_issue_url: null,
      type: { name: 'sf-story' },
      labels: []
    },
    { number: 12, title: 'Unrelated', body: '', state: 'open', html_url: 'https://github.test/issues/12', parent_issue_url: null, type: null, labels: [] }
  ]
  const gh = `#!/bin/bash
if [ "$1" = repo ]; then printf 'Fake/repo'; exit 0; fi
if [ "$1" = issue ] && [ "$2" = view ]; then
  if [ "$3" = 42 ]; then printf 'PARENT_NODE'; else printf 'CHILD_NODE'; fi
  exit 0
fi
if [ "$1" = api ] && [ "$2" != graphql ] && [[ "$*" == *sub_issues* ]]; then
  printf '%s' '[[${JSON.stringify(issues[0]).replace(/'/g, "'\\''")}]]'
  exit 0
fi
if [ "$1" = api ] && [[ "$*" == *'/parent'* ]]; then
  case "\${PARENT_MODE:-none}" in
    same) printf '%s' '{"number":42}' ;;
    conflict) printf '%s' '{"number":99}' ;;
    none) echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;
    failure) echo 'gh: connection refused' >&2; exit 1 ;;
  esac
  exit 0
fi
if [ "$1" = api ] && [[ "$*" == *'issues?state=all'* ]]; then
  printf '%s' '[${JSON.stringify(issues).replace(/'/g, "'\\''")} ]'
  exit 0
fi
if [ "$1" = api ] && [ "$2" = graphql ]; then
  if [[ "$*" == *projectItems* ]] && [[ "$*" == *n=10* ]]; then
    printf '%s' '{"data":{"repository":{"issue":{"title":"existing","state":"CLOSED","projectItems":{"nodes":[{"id":"a","project":{"number":42},"fieldValueByName":{"name":"Done"}}]}}}}}'
  elif [[ "$*" == *projectItems* ]]; then
    printf '%s' '{"data":{"repository":{"issue":{"title":"candidate","state":"OPEN","projectItems":{"nodes":[{"id":"b","project":{"number":42},"fieldValueByName":{"name":"Backlog"}}]}}}}}'
  else
    printf '%s' '{"data":{"addSubIssue":{"issue":{"number":42},"subIssue":{"number":11}}}}'
  fi
  exit 0
fi
echo "unexpected gh call: $*" >&2
exit 1
`
  const ghPath = path.join(bin, 'gh')
  writeFileSync(ghPath, gh)
  chmodSync(ghPath, 0o755)
  return { dir, env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` }, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

describe('github-projects CLI — SRS ticket inspection and recovery', () => {
  it('returns native and repository-wide open/closed candidates with canonical evidence', async () => {
    const s = await sandbox()
    try {
      const { stdout } = await execFileP(
        '/bin/bash',
        [CLI, 'inspect-srs-tickets', '42', '--fr', 'FR-MAH-001=https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '--fr', 'FR-MAH-002=https://www.notion.so/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
        { cwd: s.dir, env: s.env }
      )
      expect(JSON.parse(stdout)).toEqual([
        expect.objectContaining({ number: '10', state: 'CLOSED', boardStatus: 'Done', parentNumber: '42', frIds: ['FR-MAH-001'] }),
        expect.objectContaining({ number: '11', state: 'OPEN', boardStatus: 'Backlog', parentNumber: null, frIds: ['FR-MAH-002'] })
      ])
    } finally {
      await s.cleanup()
    }
  })

  it('treats linking the same native relationship as an idempotent no-op', async () => {
    const s = await sandbox()
    try {
      const { stdout } = await execFileP('/bin/bash', [CLI, 'link-subtask', '42', '11'], { cwd: s.dir, env: { ...s.env, PARENT_MODE: 'same' } })
      expect(stdout).toContain('already linked')
    } finally {
      await s.cleanup()
    }
  })

  it('links an orphan and refuses a conflicting existing parent', async () => {
    const s = await sandbox()
    try {
      const linked = await execFileP('/bin/bash', [CLI, 'link-subtask', '42', '11'], { cwd: s.dir, env: { ...s.env, PARENT_MODE: 'none' } })
      expect(linked.stdout).toContain('linked to parent #42')
      await expect(execFileP('/bin/bash', [CLI, 'link-subtask', '42', '11'], { cwd: s.dir, env: { ...s.env, PARENT_MODE: 'conflict' } })).rejects.toMatchObject({
        code: 1
      })
    } finally {
      await s.cleanup()
    }
  })

  it('fails closed when the current parent cannot be inspected', async () => {
    const s = await sandbox()
    try {
      await expect(execFileP('/bin/bash', [CLI, 'link-subtask', '42', '11'], { cwd: s.dir, env: { ...s.env, PARENT_MODE: 'failure' } })).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining('refusing to mutate an ambiguous relationship')
      })
    } finally {
      await s.cleanup()
    }
  })
})
