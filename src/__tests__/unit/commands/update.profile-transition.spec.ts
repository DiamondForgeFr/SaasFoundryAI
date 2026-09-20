import { decideProfileTransition } from '../../../commands/update.profile-transition'
import type { ProjectCapabilities } from '../../../project-capabilities'

const capabilities = (effectiveProfile: ProjectCapabilities['effectiveProfile']): ProjectCapabilities => {
  switch (effectiveProfile) {
    case 'full':
      return { technicalStack: 'present', collaborationHarness: 'managed', effectiveProfile }
    case 'stack':
      return { technicalStack: 'present', collaborationHarness: 'core-only', effectiveProfile }
    case 'harness':
      return { technicalStack: 'absent', collaborationHarness: 'managed', effectiveProfile }
    case 'unknown':
      return { technicalStack: 'absent', collaborationHarness: 'legacy-unknown', effectiveProfile }
    case 'inconsistent':
      return { technicalStack: 'inconsistent', collaborationHarness: 'managed', effectiveProfile }
  }
}

describe('decideProfileTransition', () => {
  it.each([
    ['full', 'noop', 'none'],
    ['stack', 'ready', 'add-harness'],
    ['harness', 'ready', 'add-technical-stack'],
    ['unknown', 'blocked', 'none'],
    ['inconsistent', 'blocked', 'none']
  ] as const)('maps %s through the canonical capability decision', (profile, status, action) => {
    expect(decideProfileTransition(capabilities(profile), 'full')).toMatchObject({ status, action })
  })
})
