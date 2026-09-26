import { execFileSync, spawnSync } from 'child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { runInNewContext } from 'vm'
import { load } from 'js-yaml'

const ROOT = resolve(__dirname, '../../../..')
const FILES = [
  '.github/workflows/test.yml',
  'scaffolds/blueprints/api/.github/workflows/test.yml',
  'scaffolds/blueprints/web/.github/workflows/test.yml',
  'scaffolds/overlays/monorepo/root/.github/workflows/test.yml'
]
interface Workflow {
  on: { pull_request: { types: string[]; branches: string[] }; push?: { branches: string[]; tags?: string[] }; schedule?: unknown; workflow_dispatch?: unknown }
  concurrency: { group: string; 'cancel-in-progress': boolean }
  jobs: Record<string, { if: string; needs?: string | string[] }>
}

function permits(expression: string, event: string, draft: boolean, base = 'develop', ref = 'refs/heads/develop', prepareResult = 'success'): boolean {
  return Boolean(
    runInNewContext(expression, {
      startsWith: (value: string, prefix: string) => value.startsWith(prefix),
      github: { event_name: event, base_ref: base, ref, event: { pull_request: { draft } } },
      needs: { lifecycle_prepare: { result: prepareResult } }
    })
  )
}

describe.each(FILES)('%s draft validation policy', (file) => {
  const workflow = load(readFileSync(join(ROOT, file), 'utf8').replaceAll('{{CI_PR_BRANCHES}}', 'develop, master')) as Workflow
  const impactAware = file === '.github/workflows/test.yml'
  it('handles draft creation, feedback pushes, reopening, promotion and returning to draft', () => {
    expect(workflow.on.pull_request.types).toEqual(expect.arrayContaining(['opened', 'synchronize', 'reopened', 'ready_for_review', 'converted_to_draft']))
    expect(workflow.on.pull_request.branches).toEqual(expect.arrayContaining(['develop', 'master']))
    const expectedGroup = impactAware
      ? '${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.event.merge_group.head_ref || github.ref || github.run_id }}'
      : '${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}'
    expect(workflow.concurrency).toEqual({ group: expectedGroup, 'cancel-in-progress': true })
  })
  it('skips every job on a draft PR, including dependency installation and Docker matrix resolution', () => {
    expect(Object.keys(workflow.jobs).length).toBeGreaterThan(0)
    if (impactAware) {
      expect(workflow.jobs.classify.if).toBeUndefined()
      expect(workflow.jobs.required_gate.if).toBe('always()')
      for (const [name, job] of Object.entries(workflow.jobs)) {
        if (name === 'classify' || name === 'required_gate') continue
        expect(job.if).toContain('needs.classify.outputs.')
      }
      return
    }
    for (const job of Object.values(workflow.jobs)) {
      expect(job.if).toBeDefined()
      expect(permits(job.if, 'pull_request', true)).toBe(false)
    }
  })
  it('runs validation for ready PRs while preserving Docker target branch selection', () => {
    if (impactAware) {
      expect(workflow.jobs.classify).toBeDefined()
      expect(workflow.jobs.required_gate.needs).toEqual(expect.arrayContaining(['classify', 'lifecycle']))
      return
    }
    for (const job of Object.values(workflow.jobs)) {
      for (const base of ['develop', 'master']) {
        expect(permits(job.if, 'pull_request', false, base)).toBe(true)
      }
    }
  })
  if (impactAware) {
    it('keeps ordinary pushes fast and routes RC tags, schedules and manual runs to the full lifecycle lane', () => {
      expect(workflow.on.push?.branches).toEqual(['master', 'develop', 'rc-*'])
      expect(workflow.on.push?.tags).toEqual(['v*', 'rc-*'])
      expect(workflow.on.schedule).toBeDefined()
      expect(workflow.on.workflow_dispatch).toBeNull()
    })
  }
})

describe('pre-push validation policy', () => {
  let dir: string
  let bin: string
  let calls: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sf-push-policy-'))
    bin = join(dir, 'bin')
    calls = join(dir, 'npm-calls')
    mkdirSync(bin)
    writeFileSync(join(bin, 'git'), '#!/bin/sh\ncase "$1" in symbolic-ref) echo "$SF_TEST_BRANCH";; log) exit 0;; ls-remote) exit "${SF_TEST_TAG_EXIT:-2}";; esac\n')
    writeFileSync(join(bin, 'npm'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$SF_TEST_CALLS"\nexit "${SF_TEST_NPM_EXIT:-0}"\n')
    chmodSync(join(bin, 'git'), 0o755)
    chmodSync(join(bin, 'npm'), 0o755)
    writeFileSync(calls, '')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  function env(branch: string, exit = '0'): NodeJS.ProcessEnv {
    return { ...process.env, PATH: `${bin}:${process.env.PATH}`, SF_TEST_BRANCH: branch, SF_TEST_CALLS: calls, SF_TEST_NPM_EXIT: exit, SF_TEST_TAG_EXIT: '2' }
  }
  it('allows feedback pushes without invoking Docker and points to the mandatory AI-testing validation', () => {
    const out = execFileSync('bash', [join(ROOT, '.husky/pre-push'), 'origin', 'unused'], { cwd: dir, env: env('feature/654-draft'), encoding: 'utf8' })
    expect(readFileSync(calls, 'utf8')).toBe('')
    expect(out).toContain('Before Human testing, run npm run test:pre-push during AI testing')
  })
  it('validates an already-committed RC version without mutating it or creating a tag', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.2.3' }))
    const out = execFileSync('bash', [join(ROOT, '.husky/pre-push'), 'origin', 'unused'], { cwd: dir, env: env('rc-1.2.3'), encoding: 'utf8' })
    expect(readFileSync(calls, 'utf8')).toBe('')
    expect(out).toContain('RC version is committed')
    expect(out).toContain('tag only after this RC is merged')
  })

  it('rejects an RC push when the branch and committed package versions differ', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.2.2' }))
    const result = spawnSync('bash', [join(ROOT, '.husky/pre-push'), 'origin', 'unused'], { cwd: dir, env: env('rc-1.2.3'), encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Release version mismatch')
    expect(readFileSync(calls, 'utf8')).toBe('')
  })

  it('rejects an RC push when the release tag already exists', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.2.3' }))
    const releaseEnv = { ...env('rc-1.2.3'), SF_TEST_TAG_EXIT: '0' }
    const result = spawnSync('bash', [join(ROOT, '.husky/pre-push'), 'origin', 'unused'], { cwd: dir, env: releaseEnv, encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Tag v1.2.3 already exists')
  })
})
