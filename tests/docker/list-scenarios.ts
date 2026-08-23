import { ALL_SCENARIOS, getQuickScenarios } from './scenarios'

/**
 * Renders the scenario list for anything that needs it.
 *
 * This exists so the list has exactly ONE source of truth. It used to be hardcoded `echo` lines
 * in the shell script, which silently drifted: the runner executed 19 scenarios while `--list`
 * advertised 18, so a whole scenario (`migration-v0-to-current`) was invisible to anyone reading
 * the CLI (#426). Anything that reads the list must read it from `scenarios.ts`.
 *
 * That rule was applied to `--list` and never reached `.github/workflows/test.yml`, which kept a
 * hand-written copy of the names — so it drifted exactly the same way and hid exactly the same
 * scenario, plus `multirepo-pwa`. Both were defined, both runnable locally, and neither ran on any
 * pull request (#546). The `--json` mode below is what the workflow now reads, so a scenario
 * cannot be added to the code and silently left out of CI.
 *
 * Usage:
 *   list-scenarios.ts                    human-readable table
 *   list-scenarios.ts --json             every scenario name, as a JSON array
 *   list-scenarios.ts --json --quick [N] the quick lane: top N (default 2) plus opted-in scenarios
 */
function structureOf(scenario: (typeof ALL_SCENARIOS)[number]): string {
  const isMonorepo = scenario.type === 'update' ? scenario.base.isMonorepo : 'isMonorepo' in scenario ? scenario.isMonorepo : false
  return isMonorepo ? 'monorepo' : 'multirepo'
}

const args = process.argv.slice(2)

if (args.includes('--json')) {
  const quick = args.includes('--quick')
  const countArg = args.find((a) => /^\d+$/.test(a))
  const count = countArg ? parseInt(countArg, 10) : 2
  const selected = quick ? getQuickScenarios(count) : ALL_SCENARIOS
  // Compact on purpose: the workflow interpolates this into a single `$GITHUB_OUTPUT` line.
  process.stdout.write(JSON.stringify(selected.map((s) => s.name)))
} else {
  console.log('Available scenarios (ordered by priority):\n')
  console.log('  #  Name                        Type        Structure')
  console.log('  -- --------------------------  ----------  ----------')
  ALL_SCENARIOS.forEach((scenario, index) => {
    console.log(`  ${String(index + 1).padStart(2)} ${scenario.name.padEnd(27)} ${scenario.type.padEnd(11)} ${structureOf(scenario)}`)
  })
}
