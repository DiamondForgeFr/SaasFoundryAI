import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../../..')
const WORKFLOW = path.join(ROOT, '.github/workflows/test.yml')
const LIST_SCRIPT = path.join(ROOT, 'tests/docker/list-scenarios.ts')

// The docker suite is the only thing in this repo that generates real projects, so "it passed"
// is read as "the scenarios passed". That statement is only true if every scenario actually
// runs.
//
// It was not true. `.github/workflows/test.yml` carried a hand-written list of scenario names
// and drifted from the code: `migration-v0-to-current` (the migration framework's only
// end-to-end test) and `multirepo-pwa` were defined, runnable locally, and ran on no pull
// request at all (#546).
//
// The same drift had already happened once, in the shell script's `--list`, and was fixed in
// #426 by rendering the list from `scenarios.ts`. `list-scenarios.ts` even states the rule in
// its own docstring — "anything that reads the list must read it from scenarios.ts" — and the
// workflow never got it.
//
// This guard is here because a rule that is only written down gets forgotten in exactly the
// place nobody rereads.

function scenarioNames(args: string[] = []): string[] {
  const out = execFileSync('npx', ['tsx', LIST_SCRIPT, '--json', ...args], { cwd: ROOT, encoding: 'utf8' })
  return JSON.parse(out) as string[]
}

describe('the CI docker matrix', () => {
  const workflow = readFileSync(WORKFLOW, 'utf8')

  it('derives both matrices from the scenario definitions', () => {
    expect(workflow).toContain('scenario: ${{ fromJSON(needs.docker-scenarios.outputs.full) }}')
    expect(workflow).toContain('scenario: ${{ fromJSON(needs.docker-scenarios.outputs.quick) }}')
  })

  it('carries no hand-written copy of the scenario names', () => {
    // The exact shape that drifted: a scenario name as a bare YAML list item.
    const names = scenarioNames()
    const hardcoded = names.filter((name) => new RegExp(`^\\s+- ${name}\\s*$`, 'm').test(workflow))

    if (hardcoded.length > 0) {
      throw new Error(
        [
          `The workflow lists ${hardcoded.length} scenario name(s) by hand: ${hardcoded.join(', ')}.`,
          '',
          'A copied list drifts. That is how migration-v0-to-current and multirepo-pwa came to be',
          'defined, runnable locally, and executed by no pull request.',
          '',
          'Derive the matrix instead: `scenario: ${{ fromJSON(needs.docker-scenarios.outputs.full) }}`.'
        ].join('\n')
      )
    }

    expect(hardcoded).toEqual([])
  })

  it('resolves the job the matrices depend on', () => {
    expect(workflow).toContain('docker-scenarios:')
    expect(workflow).toContain('needs: docker-scenarios')
    expect(workflow).toContain('list-scenarios.ts --json')
  })
})

describe('list-scenarios --json', () => {
  it('emits every defined scenario, including the two that CI used to miss', () => {
    const names = scenarioNames()
    expect(names.length).toBeGreaterThanOrEqual(20)
    expect(names).toContain('migration-v0-to-current')
    expect(names).toContain('multirepo-pwa')
  })

  it('emits the quick lane as the top two plus whatever opts in', () => {
    const all = scenarioNames()
    const quick = scenarioNames(['--quick'])

    expect(quick.slice(0, 2)).toEqual(all.slice(0, 2))
    expect(quick.length).toBeGreaterThan(2)
    // The harness profile guards the path that scaffolds over a user's existing repository
    // (#510), and it is cheap because it scaffolds nothing. It belongs on every PR.
    expect(quick).toContain('cli-new-harness')
    expect(new Set(quick).size).toBe(quick.length)
  })

  it('keeps every quick-lane scenario in the full list', () => {
    const all = new Set(scenarioNames())
    for (const name of scenarioNames(['--quick'])) expect(all.has(name)).toBe(true)
  })
})
