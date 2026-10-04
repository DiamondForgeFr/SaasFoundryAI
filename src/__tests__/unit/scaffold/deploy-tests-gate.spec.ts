import { readFileSync } from 'fs'
import { resolve } from 'path'

import { load } from 'js-yaml'

const ROOT = resolve(__dirname, '../../../..')
const DEPLOY_WORKFLOWS = [
  'scaffolds/blueprints/api/.github/workflows/deployment.yml',
  'scaffolds/blueprints/web/.github/workflows/deployment.yml',
  'scaffolds/overlays/monorepo/root/.github/workflows/deployment-api.yml',
  'scaffolds/overlays/monorepo/root/.github/workflows/deployment-web.yml'
]

interface Job {
  needs?: string | string[]
  permissions?: Record<string, string>
  steps: Array<{ if?: string; run?: string }>
}

const workflow = (path: string) => {
  const source = readFileSync(resolve(ROOT, path), 'utf8')
  // The templates carry `{{PLACEHOLDERS}}`, which are not YAML until generation fills them
  return { source, parsed: load(source.replace(/\{\{[A-Z_]+\}\}/g, 'main')) as { jobs: Record<string, Job> } }
}

const needsOf = (job: Job): string[] => (job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs])

/** Every job a job waits for, directly or through another job. */
function dependencies(jobs: Record<string, Job>, name: string, seen = new Set<string>()): Set<string> {
  for (const need of needsOf(jobs[name])) {
    if (seen.has(need)) continue
    seen.add(need)
    dependencies(jobs, need, seen)
  }
  return seen
}

// #889 — `check-tests` looked once with `gh run list --limit=1`, which exits 0 on an empty list,
// while the tests of the commit were still running: every push to main deployed untested code
describe.each(DEPLOY_WORKFLOWS)('%s', (path) => {
  const { source, parsed } = workflow(path)
  const gate = parsed.jobs['check-tests']

  it('waits for the Tests verdict on the pushed commit, and blocks unless it succeeded', () => {
    const step = gate.steps.find((candidate) => candidate.run?.includes('gh run list'))
    expect(step?.if).toBe("github.event_name == 'push'")
    expect(step?.run).toContain('gh run list --workflow test.yml --event push --commit "$COMMIT_SHA"')
    expect(step?.run).toContain('[ "$conclusion" = "success" ]')
    expect(step?.run).toContain('deployment blocked')
    expect(gate.permissions).toEqual({ actions: 'read', contents: 'read' })
  })

  it('makes every other job wait for that gate', () => {
    for (const name of Object.keys(parsed.jobs).filter((job) => job !== 'check-tests')) {
      expect([name, dependencies(parsed.jobs, name).has('check-tests')]).toEqual([name, true])
    }
  })

  it('no longer carries the check that could not fail', () => {
    expect(source).not.toContain('--limit=1 --commit')
    expect(source).not.toContain('if [ $? -ne 0 ]')
  })
})
