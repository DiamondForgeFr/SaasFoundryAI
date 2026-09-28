import { buildCreateViewArgs, configureBoardView, DEFAULT_BOARD_VISIBLE_FIELDS, ownerScope, resolveVisibleFieldIds, type ApiRunner, type ProjectField } from '../../../prompts/workflow.board-view'

const FIELDS: ProjectField[] = [
  { id: 269932801, name: 'Title' },
  { id: 269932802, name: 'Assignees' },
  { id: 269932803, name: 'Status' },
  { id: 269932804, name: 'Labels' },
  { id: 269932805, name: 'Linked pull requests' },
  { id: 269932808, name: 'Type' },
  { id: 269932810, name: 'Parent issue' },
  { id: 269932811, name: 'Sub-issues progress' }
  // note: no "Updated" — GitHub doesn't expose it as a regular field
]

describe('workflow.board-view', () => {
  describe('resolveVisibleFieldIds', () => {
    it('maps names to numeric ids and reports missing ones', () => {
      const { ids, missing } = resolveVisibleFieldIds(FIELDS, DEFAULT_BOARD_VISIBLE_FIELDS)
      expect(ids).toEqual([269932801, 269932803, 269932804, 269932805, 269932808, 269932810, 269932811])
      expect(missing).toEqual(['Updated'])
    })

    it('preserves the requested order', () => {
      const { ids } = resolveVisibleFieldIds(FIELDS, ['Status', 'Title'])
      expect(ids).toEqual([269932803, 269932801])
    })
  })

  describe('ownerScope', () => {
    it('uses orgs/<login> for organizations', () => {
      expect(ownerScope({ owner: 'DiamondForgeFr', isOrg: true })).toBe('orgs/DiamondForgeFr')
    })

    it('uses users/<numeric-id> for user-owned projects', () => {
      expect(ownerScope({ owner: 'agachet', isOrg: false, userId: 12345 })).toBe('users/12345')
    })
  })

  describe('buildCreateViewArgs', () => {
    it('builds a POST with board layout and repeated visible_fields', () => {
      const args = buildCreateViewArgs('orgs/acme', 7, 'Board', [10, 20])
      expect(args).toContain('X-GitHub-Api-Version: 2026-03-10')
      expect(args).toContain('--method POST /orgs/acme/projectsV2/7/views')
      expect(args).toContain("-f 'name=Board'")
      expect(args).toContain("-f 'layout=board'")
      expect(args).toContain("-F 'visible_fields[]=10'")
      expect(args).toContain("-F 'visible_fields[]=20'")
    })
  })

  describe('configureBoardView', () => {
    it('queries fields then creates the Board view, reporting missing fields', () => {
      const calls: string[] = []
      const run: ApiRunner = (args) => {
        calls.push(args)
        if (args.includes('/fields')) return JSON.stringify(FIELDS)
        return '{}'
      }

      const result = configureBoardView({ owner: 'acme', isOrg: true, projectNumber: 7 }, run)

      expect(result.created).toBe(true)
      expect(result.viewName).toBe('Board')
      expect(result.missing).toEqual(['Updated'])
      expect(result.visible).not.toContain('Updated')
      expect(result.visible).toContain('Status')
      // second call is the POST with the resolved ids
      expect(calls[1]).toContain('--method POST /orgs/acme/projectsV2/7/views')
      expect(calls[1]).toContain("-F 'visible_fields[]=269932803'")
    })

    it('targets the user endpoint with the numeric id for user-owned projects', () => {
      const calls: string[] = []
      const run: ApiRunner = (args) => {
        calls.push(args)
        if (args.includes('/fields')) return JSON.stringify(FIELDS)
        return '{}'
      }

      configureBoardView({ owner: 'agachet', isOrg: false, userId: 999, projectNumber: 3 }, run)

      expect(calls[0]).toContain('/users/999/projectsV2/3/fields')
      expect(calls[1]).toContain('--method POST /users/999/projectsV2/3/views')
    })

    it('is best-effort: a REST failure returns created=false with the error, never throws', () => {
      const run: ApiRunner = () => {
        throw new Error('HTTP 404: views endpoint unavailable')
      }

      const result = configureBoardView({ owner: 'acme', isOrg: true, projectNumber: 7 }, run)

      expect(result.created).toBe(false)
      expect(result.error).toMatch(/404/)
    })
  })
})
