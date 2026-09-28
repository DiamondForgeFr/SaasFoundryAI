import { ALL_SCENARIOS, type BrowserDepth } from './scenarios'

export type CiLaneName = 'normal' | 'full'

export interface LifecycleLaneEntry {
  check: string
  scenario: (typeof ALL_SCENARIOS)[number]['name']
  depth: BrowserDepth
  timeoutMinutes: number
}

export const CI_LANES: Readonly<Record<CiLaneName, readonly LifecycleLaneEntry[]>> = {
  normal: [
    { check: 'new-monorepo-full', scenario: 'new-monorepo', depth: 'full', timeoutMinutes: 40 },
    { check: 'new-multirepo-full', scenario: 'new-multirepo', depth: 'full', timeoutMinutes: 40 },
    { check: 'update-previous-release-smoke', scenario: 'update-previous-release', depth: 'smoke', timeoutMinutes: 40 }
  ],
  full: [
    { check: 'new-monorepo-full', scenario: 'new-monorepo', depth: 'full', timeoutMinutes: 40 },
    { check: 'new-multirepo-full', scenario: 'new-multirepo', depth: 'full', timeoutMinutes: 40 },
    { check: 'update-previous-release-full', scenario: 'update-previous-release', depth: 'full', timeoutMinutes: 40 },
    { check: 'update-current-monorepo-full', scenario: 'update-current-monorepo', depth: 'full', timeoutMinutes: 40 }
  ]
} as const

export function getCiLane(name: string): readonly LifecycleLaneEntry[] {
  if (name !== 'normal' && name !== 'full') throw new Error(`Unknown CI lane "${name}". Expected normal or full.`)
  return CI_LANES[name]
}

export function validateCiLanes(): void {
  const scenarios = new Map(ALL_SCENARIOS.map((scenario) => [scenario.name, scenario]))
  for (const [laneName, entries] of Object.entries(CI_LANES)) {
    const checks = new Set<string>()
    for (const entry of entries) {
      if (checks.has(entry.check)) throw new Error(`CI lane ${laneName} repeats check ${entry.check}.`)
      const scenario = scenarios.get(entry.scenario)
      if (!scenario) throw new Error(`CI lane ${laneName} references unknown scenario ${entry.scenario}.`)
      if (entry.timeoutMinutes * 60 < scenario.timeoutSeconds + 300) {
        throw new Error(`CI lane ${laneName}/${entry.check} must leave at least five minutes above its ${scenario.timeoutSeconds}s lifecycle budget.`)
      }
      checks.add(entry.check)
    }
  }
  const expected = ['new-monorepo-full', 'new-multirepo-full', 'update-previous-release-smoke']
  const actual = CI_LANES.normal.map((entry) => entry.check)
  if (actual.join(',') !== expected.join(',')) throw new Error(`Normal CI lane changed: ${actual.join(', ')}`)
}

validateCiLanes()
