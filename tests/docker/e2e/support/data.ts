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

/** Keep the generated value within create-role-dialog's 30-character input limit. */
export function liveRoleName(contract: Pick<LiveSuiteContract, 'topology' | 'phase'>): string {
  const topology = contract.topology === 'monorepo' ? 'mono' : 'multi'
  const phase = { creation: 'new', 'before-update': 'pre', 'after-update': 'post' }[contract.phase]
  const name = `LC ${topology} ${phase} role`
  if (name.length > 30) throw new Error(`Live role name exceeds the UI limit: ${name}`)
  return name
}
