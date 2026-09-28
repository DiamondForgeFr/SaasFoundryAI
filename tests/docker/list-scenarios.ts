import { getCiLane } from './ci-lanes'
import { ALL_SCENARIOS } from './scenarios'

const args = process.argv.slice(2)
const laneIndex = args.indexOf('--lane')
const lane = laneIndex >= 0 ? getCiLane(args[laneIndex + 1] ?? '') : undefined

if (args.includes('--count')) {
  process.stdout.write(String(lane?.length ?? ALL_SCENARIOS.length))
} else if (args.includes('--tsv')) {
  if (!lane) throw new Error('--tsv requires --lane normal|full')
  process.stdout.write(`${lane.map((entry) => `${entry.check}\t${entry.scenario}\t${entry.depth}`).join('\n')}\n`)
} else if (args.includes('--json')) {
  process.stdout.write(JSON.stringify(lane ?? ALL_SCENARIOS.map((scenario) => ({ scenario: scenario.name }))))
} else if (lane) {
  console.log('  Check                             Scenario                    Depth  Budget')
  console.log('  --------------------------------  --------------------------  -----  ------')
  for (const entry of lane) {
    console.log(`  ${entry.check.padEnd(32)}  ${entry.scenario.padEnd(26)}  ${entry.depth.padEnd(5)}  ${entry.timeoutMinutes}m`)
  }
} else {
  console.log('Available lifecycle scenarios:\n')
  for (const scenario of ALL_SCENARIOS) console.log(`  ${scenario.name.padEnd(27)} ${scenario.type}`)
}
