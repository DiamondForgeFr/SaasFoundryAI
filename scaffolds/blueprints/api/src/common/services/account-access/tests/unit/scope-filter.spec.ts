/**
 * Dependencies
 */
import { filterAssignmentsForTarget, isPlatformAssignment, keepPlatformAssignments } from '@common/services/account-access/scope-filter'

/**
 * Type
 */
import type { EntityScopeTarget, ScopedAssignment } from '@common/services/account-access/scope-filter'

/**
 * Fixtures: accounts A and B; in A the tree E1 -> E2 -> E3 plus the sibling root S1; in B the entity EB.
 */
const A = 'account-a'
const B = 'account-b'

const platform = (label = 'platform'): ScopedAssignment & { label: string } => ({ label, accountId: null, entityId: null, role: { scope: 'PLATFORM' }, entity: null })
const onAccount = (accountId: string, label = `account:${accountId}`): ScopedAssignment & { label: string } => ({ label, accountId, entityId: null, role: { scope: 'ACCOUNT' }, entity: null })
const onEntity = (entityId: string, entityAccountId: string, label = `entity:${entityId}`): ScopedAssignment & { label: string } => ({
  label,
  accountId: null,
  entityId,
  role: { scope: 'ENTITY' },
  entity: { id: entityId, accountId: entityAccountId }
})

const entityTarget = (entityId: string, accountId: string | null, ancestorEntityIds: string[]): EntityScopeTarget => ({ kind: 'ENTITY', entityId, accountId, ancestorEntityIds })

const E3_TARGET = entityTarget('e3', A, ['e3', 'e2', 'e1'])
const labels = (assignments: { label: string }[]) => assignments.map((assignment) => assignment.label)

describe('scope-filter', () => {
  describe('ACCOUNT target', () => {
    const assignments = [platform(), onAccount(A), onAccount(B), onEntity('e1', A), onEntity('eb', B)]

    it('counts PLATFORM and the ACCOUNT assignment on that account only', () => {
      const result = filterAssignmentsForTarget(assignments, { kind: 'ACCOUNT', accountId: A })

      expect(labels(result)).toEqual(['platform', 'account:account-a'])
    })

    it('never counts an ACCOUNT assignment held on another account', () => {
      const result = filterAssignmentsForTarget([onAccount(B)], { kind: 'ACCOUNT', accountId: A })

      expect(result).toEqual([])
    })

    it('ignores ENTITY assignments unless the target opts in', () => {
      expect(filterAssignmentsForTarget([onEntity('e1', A)], { kind: 'ACCOUNT', accountId: A })).toEqual([])
      expect(filterAssignmentsForTarget([onEntity('e1', A)], { kind: 'ACCOUNT', accountId: A, includeEntityAssignments: false })).toEqual([])
    })

    it('counts ENTITY assignments on an entity of the account when the target opts in', () => {
      const result = filterAssignmentsForTarget(assignments, { kind: 'ACCOUNT', accountId: A, includeEntityAssignments: true })

      expect(labels(result)).toEqual(['platform', 'account:account-a', 'entity:e1'])
    })

    it('does not count an ENTITY assignment on an entity of another account, even on opt-in', () => {
      const result = filterAssignmentsForTarget([onEntity('eb', B)], { kind: 'ACCOUNT', accountId: A, includeEntityAssignments: true })

      expect(result).toEqual([])
    })

    it('does not count an ENTITY assignment whose entity was not loaded (fail closed)', () => {
      const withoutEntity: ScopedAssignment = { accountId: null, entityId: 'e1', role: { scope: 'ENTITY' } }

      expect(filterAssignmentsForTarget([withoutEntity], { kind: 'ACCOUNT', accountId: A, includeEntityAssignments: true })).toEqual([])
    })
  })

  describe('ENTITY target', () => {
    it('counts PLATFORM and the ACCOUNT assignment on the entity account', () => {
      const result = filterAssignmentsForTarget([platform(), onAccount(A), onAccount(B)], E3_TARGET)

      expect(labels(result)).toEqual(['platform', 'account:account-a'])
    })

    it('counts an ENTITY assignment on the entity itself and on each ancestor', () => {
      const result = filterAssignmentsForTarget([onEntity('e3', A), onEntity('e2', A), onEntity('e1', A)], E3_TARGET)

      expect(labels(result)).toEqual(['entity:e3', 'entity:e2', 'entity:e1'])
    })

    it('never counts an ENTITY assignment on a descendant', () => {
      const e1Target = entityTarget('e1', A, ['e1'])

      expect(filterAssignmentsForTarget([onEntity('e2', A), onEntity('e3', A)], e1Target)).toEqual([])
    })

    it('never counts an ENTITY assignment on a sibling root or on an entity of another account', () => {
      expect(filterAssignmentsForTarget([onEntity('s1', A), onEntity('eb', B)], E3_TARGET)).toEqual([])
    })

    it('only counts PLATFORM for an entity that does not exist', () => {
      const unknown = entityTarget('ghost', null, [])

      const result = filterAssignmentsForTarget([platform(), onAccount(A), onEntity('e1', A)], unknown)

      expect(labels(result)).toEqual(['platform'])
    })
  })

  describe('PLATFORM', () => {
    it('counts for every target kind', () => {
      expect(filterAssignmentsForTarget([platform()], { kind: 'ACCOUNT', accountId: A })).toHaveLength(1)
      expect(filterAssignmentsForTarget([platform()], E3_TARGET)).toHaveLength(1)
    })

    it('requires the assignment to be bound to no account and no entity', () => {
      const misshapen: ScopedAssignment = { accountId: A, entityId: null, role: { scope: 'PLATFORM' } }

      expect(isPlatformAssignment(misshapen)).toBe(false)
      expect(filterAssignmentsForTarget([misshapen], { kind: 'ACCOUNT', accountId: B })).toEqual([])
    })

    it('keepPlatformAssignments drops every non-PLATFORM assignment', () => {
      const result = keepPlatformAssignments([platform(), onAccount(A), onEntity('e1', A)])

      expect(labels(result)).toEqual(['platform'])
    })
  })

  describe('malformed assignments', () => {
    it('ignores an unknown role scope', () => {
      const unknown: ScopedAssignment = { accountId: A, entityId: null, role: { scope: 'TENANT' } }

      expect(filterAssignmentsForTarget([unknown], { kind: 'ACCOUNT', accountId: A })).toEqual([])
    })

    it('ignores an ACCOUNT assignment that is also bound to an entity', () => {
      const both: ScopedAssignment = { accountId: A, entityId: 'e1', role: { scope: 'ACCOUNT' } }

      expect(filterAssignmentsForTarget([both], { kind: 'ACCOUNT', accountId: A })).toEqual([])
    })
  })
})
