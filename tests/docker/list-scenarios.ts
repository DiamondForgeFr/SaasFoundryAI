import { ALL_SCENARIOS } from './scenarios'

/**
 * Prints the scenario table for `run-docker-tests.sh --list`.
 *
 * This exists so the list has exactly ONE source of truth. It used to be hardcoded `echo` lines
 * in the shell script, which silently drifted: the runner executed 19 scenarios while `--list`
 * advertised 18, so a whole scenario (`migration-v0-to-current`) was invisible to anyone reading
 * the CLI (#426). Anything that reads the list must read it from `scenarios.ts`.
 */
function structureOf(scenario: (typeof ALL_SCENARIOS)[number]): string {
  const isMonorepo = scenario.type === 'update' ? scenario.base.isMonorepo : 'isMonorepo' in scenario ? scenario.isMonorepo : false
  return isMonorepo ? 'monorepo' : 'multirepo'
}

console.log('Available scenarios (ordered by priority):\n')
console.log('  #  Name                        Type        Structure')
console.log('  -- --------------------------  ----------  ----------')
ALL_SCENARIOS.forEach((scenario, index) => {
  console.log(`  ${String(index + 1).padStart(2)} ${scenario.name.padEnd(27)} ${scenario.type.padEnd(11)} ${structureOf(scenario)}`)
})
