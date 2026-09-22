import type { LiveSuiteContract } from '../contracts'

export const LIVE_PASSWORD = 'LifecyclePassword123!'
export const LIVE_NEW_PASSWORD = 'LifecyclePassword456!'

export function liveIdentity(contract: LiveSuiteContract, role: string): { email: string; firstName: string; lastName: string } {
  const suffix = `${contract.topology}-${contract.phase}-${role}`.replace(/[^a-z0-9-]/g, '-')
  return {
    email: `${suffix}@example.test`,
    firstName: 'Lifecycle',
    lastName: role.replace(/[^a-z0-9]/gi, '') || 'User'
  }
}

export function liveName(contract: LiveSuiteContract, value: string): string {
  return `Lifecycle ${contract.topology} ${contract.phase} ${value}`
}
