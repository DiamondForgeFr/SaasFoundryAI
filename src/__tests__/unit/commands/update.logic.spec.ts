import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { applyFileUpdates, computeFileUpdates, FileUpdate, moduleSelectionPrefill } from '../../../commands/update'

describe('moduleSelectionPrefill', () => {
  // The bug: `sf update --non-interactive` with no --add threw "Missing required
  // values in --non-interactive mode: selectedModules" and took the command down,
  // so it could not be used unattended to pick up migrations or refresh the
  // harness — the main reason to run it that way.
  it('materialises the empty list in --non-interactive when no module was requested', () => {
    expect(moduleSelectionPrefill(undefined, true)).toEqual({ selectedModules: [] })
  })

  // Interactively the field must stay absent, or the checkbox would be skipped
  // with nothing selected and the user would never be asked.
  it('leaves the field absent when interactive, so the prompt still shows', () => {
    expect(moduleSelectionPrefill(undefined, false)).toEqual({})
  })

  it.each([
    [['email'], true],
    [['email', 'storage'], false],
    [[], true]
  ])('passes a requested selection through unchanged (%p, nonInteractive=%p)', (requested, nonInteractive) => {
    expect(moduleSelectionPrefill(requested as string[], nonInteractive as boolean)).toEqual({ selectedModules: requested })
  })
})

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

describe('applyFileUpdates (conflict strategies)', () => {
  // Minimal spinner stub — applyFileUpdates only reads/writes `spinner.text`.
  const stubSpinner = () => ({ text: '' }) as unknown as Parameters<typeof applyFileUpdates>[2]

  let tempDir: string
  let originalCwd: string
  let tempProjectDir: string

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-unit-apply-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    tempProjectDir = join(tempDir, 'src')
    await mkdir(tempProjectDir, { recursive: true })
    // The "current" project lives at tempDir/project. applyFileUpdates uses relative destPaths.
    const projectDir = join(tempDir, 'project')
    await mkdir(projectDir, { recursive: true })
    originalCwd = process.cwd()
    process.chdir(projectDir)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  const setupConflictCase = async () => {
    // User's version of the file (current working dir).
    await writeFile('conflict.ts', 'user-modified-content')
    // Template version lives in the temp "regenerated" project dir.
    await writeFile(join(tempProjectDir, 'conflict.ts'), 'template-version-content')
  }

  it('keep: leaves the user file untouched and writes no sidecar', async () => {
    await setupConflictCase()

    const { conflicts } = await applyFileUpdates([{ path: 'conflict.ts', action: 'conflict' }], tempProjectDir, stubSpinner(), 'keep')

    expect(conflicts).toHaveLength(1)
    expect(await readFile('conflict.ts', 'utf8')).toBe('user-modified-content')
    await expect(readFile('conflict.ts.saasfoundry.new', 'utf8')).rejects.toThrow()
  })

  it('replace: overwrites the user file with the template version', async () => {
    await setupConflictCase()

    const { conflicts } = await applyFileUpdates([{ path: 'conflict.ts', action: 'conflict' }], tempProjectDir, stubSpinner(), 'replace')

    expect(conflicts).toHaveLength(1)
    expect(await readFile('conflict.ts', 'utf8')).toBe('template-version-content')
    await expect(readFile('conflict.ts.saasfoundry.new', 'utf8')).rejects.toThrow()
  })

  it('save-new: writes the template version as a .saasfoundry.new sidecar and preserves the original', async () => {
    await setupConflictCase()

    const { conflicts } = await applyFileUpdates([{ path: 'conflict.ts', action: 'conflict' }], tempProjectDir, stubSpinner(), 'save-new')

    expect(conflicts).toHaveLength(1)
    expect(await readFile('conflict.ts', 'utf8')).toBe('user-modified-content')
    expect(await readFile('conflict.ts.saasfoundry.new', 'utf8')).toBe('template-version-content')
  })
})
