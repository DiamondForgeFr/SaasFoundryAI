import { computeFileUpdates, FileUpdate } from '../../../commands/update'

describe('computeFileUpdates (three-way merge)', () => {
  // Helper to find update for a specific path
  const findUpdate = (updates: FileUpdate[], path: string) => updates.find((u) => u.path === path)

  describe('file exists in both base and target', () => {
    it('should skip when template did not change (base === target)', () => {
      const base = { 'file.ts': 'aaa' }
      const current = { 'file.ts': 'bbb' } // user modified
      const target = { 'file.ts': 'aaa' } // template unchanged

      const updates = computeFileUpdates(base, current, target)

      expect(updates).toHaveLength(0)
    })

    it('should auto-update when user did not modify (current === base, target changed)', () => {
      const base = { 'file.ts': 'aaa' }
      const current = { 'file.ts': 'aaa' } // untouched
      const target = { 'file.ts': 'bbb' } // template updated

      const updates = computeFileUpdates(base, current, target)

      expect(updates).toHaveLength(1)
      expect(findUpdate(updates, 'file.ts')).toEqual({ path: 'file.ts', action: 'update' })
    })

    it('should auto-update when file was deleted by user (no current, target changed)', () => {
      const base = { 'file.ts': 'aaa' }
      const current = {} // user deleted the file
      const target = { 'file.ts': 'bbb' } // template updated

      const updates = computeFileUpdates(base, current, target)

      expect(updates).toHaveLength(1)
      expect(findUpdate(updates, 'file.ts')?.action).toBe('update')
    })

    it('should conflict when both user and template changed', () => {
      const base = { 'file.ts': 'aaa' }
      const current = { 'file.ts': 'bbb' } // user modified
      const target = { 'file.ts': 'ccc' } // template also changed

      const updates = computeFileUpdates(base, current, target)

      expect(updates).toHaveLength(1)
      expect(findUpdate(updates, 'file.ts')).toEqual({ path: 'file.ts', action: 'conflict' })
    })

    it('should skip when user already has the target version (current === target)', () => {
      const base = { 'file.ts': 'aaa' }
      const current = { 'file.ts': 'bbb' }
      const target = { 'file.ts': 'bbb' } // user happened to make the same changes

      const updates = computeFileUpdates(base, current, target)

      expect(updates).toHaveLength(0)
    })

    it('should skip when nothing changed (base === current === target)', () => {
      const base = { 'file.ts': 'aaa' }
      const current = { 'file.ts': 'aaa' }
      const target = { 'file.ts': 'aaa' }

      const updates = computeFileUpdates(base, current, target)

      expect(updates).toHaveLength(0)
    })
  })

  describe('new files in target (not in base)', () => {
    it('should add new files that do not exist in current', () => {
      const base = {}
      const current = {}
      const target = { 'new-file.ts': 'xxx' }

      const updates = computeFileUpdates(base, current, target)

      expect(updates).toHaveLength(1)
      expect(findUpdate(updates, 'new-file.ts')).toEqual({ path: 'new-file.ts', action: 'add' })
    })

    it('should skip new files if user already created a file with the same name', () => {
      const base = {}
      const current = { 'new-file.ts': 'user-version' }
      const target = { 'new-file.ts': 'template-version' }

      const updates = computeFileUpdates(base, current, target)

      expect(updates).toHaveLength(0) // don't overwrite user's file
    })
  })

  describe('files removed in target (in base, not in target)', () => {
    it('should flag for removal if user did not modify (current === base)', () => {
      const base = { 'old-file.ts': 'aaa' }
      const current = { 'old-file.ts': 'aaa' } // untouched
      const target = {} // removed in new template

      const updates = computeFileUpdates(base, current, target)

      expect(updates).toHaveLength(1)
      expect(findUpdate(updates, 'old-file.ts')).toEqual({ path: 'old-file.ts', action: 'remove' })
    })

    it('should NOT flag for removal if user modified the file', () => {
      const base = { 'old-file.ts': 'aaa' }
      const current = { 'old-file.ts': 'bbb' } // user modified
      const target = {} // removed in new template

      const updates = computeFileUpdates(base, current, target)

      expect(updates).toHaveLength(0) // keep user's modifications
    })

    it('should NOT flag for removal if file was already deleted by user', () => {
      const base = { 'old-file.ts': 'aaa' }
      const current = {} // already deleted
      const target = {} // also removed in template

      const updates = computeFileUpdates(base, current, target)

      expect(updates).toHaveLength(0)
    })
  })

  describe('multiple files', () => {
    it('should process all files from both base and target', () => {
      const base = {
        'unchanged.ts': 'aaa',
        'to-update.ts': 'bbb',
        'conflicted.ts': 'ccc',
        'to-remove.ts': 'ddd'
      }
      const current = {
        'unchanged.ts': 'aaa',
        'to-update.ts': 'bbb', // untouched
        'conflicted.ts': 'ccc-modified', // user modified
        'to-remove.ts': 'ddd' // untouched
      }
      const target = {
        'unchanged.ts': 'aaa', // no change
        'to-update.ts': 'bbb-new', // template updated
        'conflicted.ts': 'ccc-new', // template also changed
        'new-file.ts': 'eee' // new file
        // 'to-remove.ts' removed
      }

      const updates = computeFileUpdates(base, current, target)

      expect(updates).toHaveLength(4)
      expect(findUpdate(updates, 'to-update.ts')?.action).toBe('update')
      expect(findUpdate(updates, 'conflicted.ts')?.action).toBe('conflict')
      expect(findUpdate(updates, 'new-file.ts')?.action).toBe('add')
      expect(findUpdate(updates, 'to-remove.ts')?.action).toBe('remove')
    })
  })
})
