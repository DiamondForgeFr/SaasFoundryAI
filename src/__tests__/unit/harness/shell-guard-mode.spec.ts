import { mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { DEFAULT_SHELL_SHAPE, isShellShapeMode, readShellShapeMode, recordedShellShape, SHELL_SHAPE_MODES, shellShapeNotice, validateGuardConfig } from '../../../harness/shell-guard-mode'

// #1251 — what the guard does with a shell line that is not one plain command is read from the manifest, on every
// call: absence, an unreadable manifest or an unknown value mean `refuse`.

const manifest = (guard?: unknown) => JSON.stringify({ version: '1.2.1', projectName: 'p', structure: 'cli', modules: { harness: { version: 5, ...(guard === undefined ? {} : { guard }) } } })

describe('the modes', () => {
  it('are refuse, warn and off, and refuse is the default', () => {
    expect(SHELL_SHAPE_MODES).toEqual(['refuse', 'warn', 'off'])
    expect(DEFAULT_SHELL_SHAPE).toBe('refuse')
    expect(['refuse', 'warn', 'off'].every(isShellShapeMode)).toBe(true)
    expect(isShellShapeMode('allow')).toBe(false)
    expect(isShellShapeMode(undefined)).toBe(false)
  })
})

describe('recordedShellShape', () => {
  it('reads modules.harness.guard.shellShape', () => {
    expect(recordedShellShape(JSON.parse(manifest({ shellShape: 'warn' })))).toBe('warn')
    expect(recordedShellShape(JSON.parse(manifest({ shellShape: 'off' })))).toBe('off')
  })

  it.each([
    ['no guard block', JSON.parse(manifest())],
    ['an empty guard block', JSON.parse(manifest({}))],
    ['an unknown value', JSON.parse(manifest({ shellShape: 'allow' }))],
    ['a guard that is not an object', JSON.parse(manifest('warn'))],
    ['no harness', { modules: {} }],
    ['no modules', {}],
    ['a manifest that is not an object', 'refuse'],
    ['null', null]
  ])('records nothing for %s', (_name, value) => {
    expect(recordedShellShape(value)).toBeUndefined()
  })
})

describe('shellShapeNotice', () => {
  it('says what the guard does in each mode, and how to change it', () => {
    expect(shellShapeNotice('refuse')).toContain('now refuses a shell line that is not one plain command')
    expect(shellShapeNotice('refuse')).toContain('sf agents shell-guard warn')
    expect(shellShapeNotice('refuse')).toContain('sf agents shell-guard off')
    expect(shellShapeNotice('warn')).toContain('shell shape is warn')
    expect(shellShapeNotice('warn')).toContain('sf agents shell-guard refuse')
    expect(shellShapeNotice('off')).toContain('shell shape is off')
    expect(shellShapeNotice('off')).toContain('sf agents shell-guard refuse')
  })
})

describe('validateGuardConfig', () => {
  it('accepts a known mode and a key a later release adds, and refuses an unknown mode or a block that is not an object', () => {
    expect(() => validateGuardConfig({ shellShape: 'refuse' })).not.toThrow()
    expect(() => validateGuardConfig({})).not.toThrow()
    expect(() => validateGuardConfig({ shellShape: 'warn', allow: ['x'] })).not.toThrow()
    expect(() => validateGuardConfig({ shellShape: 'allow' })).toThrow('shellShape must be refuse, warn, off')
    expect(() => validateGuardConfig('warn')).toThrow('expected an object')
    expect(() => validateGuardConfig([])).toThrow('expected an object')
  })
})

describe('readShellShapeMode', () => {
  let root: string
  let project: string

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'sf-shell-guard-mode-')))
    project = join(root, 'project')
    await mkdir(join(project, 'src', 'deep'), { recursive: true })
  })
  afterEach(async () => rm(root, { recursive: true, force: true }))

  const write = (dir: string, content: string) => writeFile(join(dir, '.saasfoundry.json'), content)

  it('is the recorded mode, found by walking up from the working directory', async () => {
    await write(project, manifest({ shellShape: 'warn' }))
    expect(readShellShapeMode(project, undefined)).toBe('warn')
    expect(readShellShapeMode(join(project, 'src', 'deep'), undefined)).toBe('warn')
  })

  it('is refuse when nothing is recorded', async () => {
    await write(project, manifest())
    expect(readShellShapeMode(project, undefined)).toBe('refuse')
  })

  it('is the manifest of a worktree of an agent, which has its own copy', async () => {
    const worktree = join(project, '.claude', 'worktrees', 'agent-a1')
    await mkdir(worktree, { recursive: true })
    await write(project, manifest({ shellShape: 'off' }))
    await write(worktree, manifest({ shellShape: 'warn' }))
    expect(readShellShapeMode(worktree, undefined)).toBe('warn')
    expect(readShellShapeMode(project, undefined)).toBe('off')
  })

  it('falls back to CLAUDE_PROJECT_DIR when the working directory is in no project', async () => {
    await write(project, manifest({ shellShape: 'off' }))
    const elsewhere = join(root, 'elsewhere')
    await mkdir(elsewhere)
    expect(readShellShapeMode(elsewhere, project)).toBe('off')
    expect(readShellShapeMode(undefined, project)).toBe('off')
    expect(readShellShapeMode(elsewhere, undefined)).toBe('refuse')
  })

  it('prefers the working directory to CLAUDE_PROJECT_DIR when both are in a project', async () => {
    const other = join(root, 'other')
    await mkdir(other)
    await write(project, manifest({ shellShape: 'warn' }))
    await write(other, manifest({ shellShape: 'off' }))
    expect(readShellShapeMode(project, other)).toBe('warn')
  })

  it.each([
    ['a manifest that is not JSON', 'not json'],
    ['an empty manifest', ''],
    ['an unknown value', manifest({ shellShape: 'allow' })],
    ['a manifest that is an array', '[]']
  ])('is refuse for %s, and does not look further up', async (_name, content) => {
    await write(root, manifest({ shellShape: 'off' }))
    await write(project, content)
    expect(readShellShapeMode(project, undefined)).toBe('refuse')
  })

  it('is refuse for a relative or empty directory, and for a project directory that does not exist', () => {
    expect(readShellShapeMode('relative/dir', undefined)).toBe('refuse')
    expect(readShellShapeMode('', '')).toBe('refuse')
    expect(readShellShapeMode(join(root, 'missing'), join(root, 'missing-too'))).toBe('refuse')
  })
})
