import { readFileSync } from 'node:fs'
import path from 'node:path'
import { load } from 'js-yaml'

const ROOT = path.resolve(__dirname, '../../../..')
const FILES = ['.github/workflows/test.yml', 'scaffolds/shared/validation/test.workflow.yml']
interface Job {
  name: string
  needs?: string[]
  permissions?: Record<string, string>
  'timeout-minutes'?: number
  steps: Array<{ uses?: string; with?: { script?: string } }>
}
function workflow(file: string): { jobs: Record<string, Job> } {
  return load(
    readFileSync(path.join(ROOT, file), 'utf8')
      .replaceAll('{{CI_PR_BRANCHES_JSON}}', '["develop","master"]')
      .replaceAll('{{CI_PUSH_BRANCHES_JSON}}', '["develop","master","rc-*"]')
      .replaceAll('{{VALIDATION_MAIN_BRANCH_JSON}}', '"master"')
      .replaceAll('{{VALIDATION_PROFILE}}', 'monorepo')
  ) as { jobs: Record<string, Job> }
}
function script(file: string): string {
  const source = workflow(file).jobs.required_gate.steps.find((step) => step.with?.script)?.with?.script
  if (!source) throw new Error('Missing required-gate polling script')
  return source
}
function verdict(conclusion: string | null = 'success', status = 'completed', runId = 101) {
  return { name: 'CI / Validation result', status, conclusion, run_id: runId }
}

describe('required gate visibility and verdict isolation', () => {
  it.each(FILES)('%s creates the stable required check without waiting on dependencies', (file) => {
    const jobs = workflow(file).jobs
    expect(jobs.required_gate.name).toBe('CI / Required gate')
    expect(jobs.required_gate.needs).toBeUndefined()
    expect(jobs.required_gate.permissions).toEqual({ actions: 'read' })
    expect(jobs.required_gate['timeout-minutes']).toBe(90)
    expect(jobs.required_gate.steps).toHaveLength(1)
    expect(jobs.required_gate.steps[0].uses).toMatch(/^actions\/github-script@[0-9a-f]{40}$/)
    expect(jobs.validation_result.name).toBe('CI / Validation result')
    expect(jobs.validation_result.needs).toEqual(expect.arrayContaining(['classify', 'lifecycle']))
  })

  it('uses the same inline wrapper in contributor and generated workflows', () => {
    expect(script(FILES[0])).toBe(script(FILES[1]))
  })

  async function execute(responses: ReturnType<typeof verdict>[][], apiError?: Error, attempt: string | undefined = '2') {
    let time = 0
    const github = {
      paginate: jest.fn(async () => {
        if (apiError) throw apiError
        return responses.length > 1 ? responses.shift() : responses[0]
      })
    }
    const core = { info: jest.fn(), setFailed: jest.fn() }
    const context = { runId: 101, repo: { owner: 'test-owner', repo: 'test-repo' } }
    const run = new Function('github', 'context', 'core', 'process', 'Date', 'setTimeout', `return (async () => {${script(FILES[0])}})()`)
    await run(github, context, core, { env: { GITHUB_RUN_ATTEMPT: attempt } }, { now: () => time }, (callback: () => void, milliseconds: number) => {
      time += milliseconds
      callback()
    })
    return { github, core }
  }

  it('stays pending when the verdict is absent or running, then accepts current-attempt success', async () => {
    const { github, core } = await execute([[], [verdict(null, 'in_progress')], [verdict()]])
    expect(github.paginate).toHaveBeenCalledTimes(3)
    expect(github.paginate).toHaveBeenCalledWith('GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/jobs', {
      owner: 'test-owner',
      repo: 'test-repo',
      run_id: 101,
      attempt_number: 2,
      per_page: 100
    })
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.info.mock.calls.filter(([message]) => message.includes('stays pending'))).toHaveLength(2)
    expect(core.info).toHaveBeenCalledWith('Current validation plan completed successfully.')
  })

  it.each(['failure', 'cancelled', 'skipped', 'neutral', 'timed_out', 'action_required', 'stale', null])('rejects completed verdict %s', async (conclusion) => {
    const { core } = await execute([[verdict(conclusion)]])
    expect(core.setFailed).toHaveBeenCalled()
    expect(core.info).not.toHaveBeenCalledWith('Current validation plan completed successfully.')
  })

  it('rejects an ambiguous verdict instead of accepting the first success', async () => {
    const { core } = await execute([[verdict(), verdict('failure')]])
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Ambiguous'))
  })

  it('rejects a verdict from another run', async () => {
    const { core } = await execute([[verdict('success', 'completed', 100)]])
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('another run'))
  })

  it('times out safely if the current verdict never appears', async () => {
    const { core } = await execute([[]])
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Timed out'))
  })

  it('propagates API failure instead of making an unavailable check green', async () => {
    await expect(execute([[]], new Error('API unavailable'))).rejects.toThrow('API unavailable')
  })

  it.each(['', '0', '-1', 'invalid', '1.5'])('rejects invalid attempt %s without fetching another attempt', async (attempt) => {
    const { github, core } = await execute([[verdict()]], undefined, attempt)
    expect(github.paginate).not.toHaveBeenCalled()
    expect(core.setFailed).toHaveBeenCalledWith('Missing or invalid workflow run attempt.')
  })
})
