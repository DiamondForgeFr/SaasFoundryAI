jest.mock('../../../srs/bin/validate', () => ({ runValidate: jest.fn().mockResolvedValue(0) }))
jest.mock('../../../srs/bin/browse-tree', () => ({
  runBrowseTree: jest.fn().mockResolvedValue(0),
  parseArgs: jest.fn((argv: string[]) => {
    let parentId = ''
    let manifestPath = '.saasfoundry.json'
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--parent') parentId = argv[++i] ?? ''
      else if (argv[i] === '--manifest') manifestPath = argv[++i] ?? manifestPath
    }
    return { parentId, manifestPath }
  })
}))
jest.mock('../../../srs/bin/draft-from-notion-pages', () => ({
  runDraftFromNotionPages: jest.fn().mockResolvedValue(0),
  parseArgs: jest.fn((argv: string[]) => {
    let pageIds: string[] = []
    let manifestPath = '.saasfoundry.json'
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--ids') pageIds = (argv[++i] ?? '').split(',')
      else if (argv[i] === '--manifest') manifestPath = argv[++i] ?? manifestPath
    }
    return { pageIds, manifestPath }
  })
}))
jest.mock('../../../srs/bin/draft-from-codebase', () => ({
  runDraftFromCodebase: jest.fn().mockResolvedValue(0),
  parseArgs: jest.fn((argv: string[]) => {
    let scanPath = ''
    let manifestPath = '.saasfoundry.json'
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--path') scanPath = argv[++i] ?? ''
      else if (argv[i] === '--manifest') manifestPath = argv[++i] ?? manifestPath
    }
    return { scanPath, manifestPath }
  })
}))
jest.mock('../../../srs/bin/write-srs', () => ({
  runWriteSrs: jest.fn().mockResolvedValue(0),
  parseArgs: jest.fn((argv: string[]) => ({ specPath: argv[1] ?? '', manifestPath: '.saasfoundry.json', clearPendingIngestion: true }))
}))
jest.mock('../../../srs/bin/spawn', () => ({
  runSpawn: jest.fn().mockResolvedValue(0),
  parseArgs: jest.fn(() => ({ ticket: 0, epic: '', dryRun: false, manifestPath: '.saasfoundry.json' }))
}))
jest.mock('../../../srs/bin/apply-srs-update', () => ({
  runApplyUpdate: jest.fn().mockResolvedValue(0),
  parseArgs: jest.fn(() => ({ patchPath: undefined, manifestPath: '.saasfoundry.json' }))
}))
jest.mock('../../../srs/bin/eval-srs', () => ({
  runEvalSrs: jest.fn().mockResolvedValue(0),
  parseArgs: jest.fn(() => ({ scanPath: '', manifestPath: '.saasfoundry.json', thresholdPct: 80, output: 'human' as const }))
}))

import { runApplyUpdate } from '../../../srs/bin/apply-srs-update'
import { runBrowseTree } from '../../../srs/bin/browse-tree'
import { runDraftFromCodebase } from '../../../srs/bin/draft-from-codebase'
import { runDraftFromNotionPages } from '../../../srs/bin/draft-from-notion-pages'
import { runEvalSrs } from '../../../srs/bin/eval-srs'
import { runSpawn } from '../../../srs/bin/spawn'
import { runValidate } from '../../../srs/bin/validate'
import { runWriteSrs } from '../../../srs/bin/write-srs'
import { srsCommand } from '../../../commands/srs'

describe('srsCommand', () => {
  const originalExitCode: typeof process.exitCode = process.exitCode
  let stdoutSpy: jest.SpyInstance
  let stderrSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    process.exitCode = undefined
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
    process.exitCode = originalExitCode
  })

  it('prints usage on help', async () => {
    await srsCommand('help')
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('Usage: sf srs <action>')
    expect(output).toContain('validate')
    expect(output).toContain('eval')
  })

  it('prints usage when called with no subcommand', async () => {
    await srsCommand()
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('Usage: sf srs <action>')
  })

  it('forwards validate to runValidate with default manifest', async () => {
    await srsCommand('validate')
    expect(runValidate).toHaveBeenCalledWith({ manifestPath: '.saasfoundry.json' })
  })

  it('forwards validate with custom manifest positional', async () => {
    await srsCommand('validate', 'custom.json')
    expect(runValidate).toHaveBeenCalledWith({ manifestPath: 'custom.json' })
  })

  it('forwards browse with --parent and --manifest', async () => {
    await srsCommand('browse', '--parent', 'page_1', '--manifest', 'my.json')
    expect(runBrowseTree).toHaveBeenCalledWith({ parentId: 'page_1', manifestPath: 'my.json' })
  })

  it('routes draft --from notion-pages to runDraftFromNotionPages', async () => {
    await srsCommand('draft', '--from', 'notion-pages', '--ids', 'p1,p2')
    expect(runDraftFromNotionPages).toHaveBeenCalledWith({ pageIds: ['p1', 'p2'], manifestPath: '.saasfoundry.json' })
    expect(runDraftFromCodebase).not.toHaveBeenCalled()
  })

  it('routes draft --from codebase to runDraftFromCodebase', async () => {
    await srsCommand('draft', '--from', 'codebase', '--path', './src')
    expect(runDraftFromCodebase).toHaveBeenCalledWith({ scanPath: './src', manifestPath: '.saasfoundry.json' })
    expect(runDraftFromNotionPages).not.toHaveBeenCalled()
  })

  it('defaults draft source to notion-pages when --from is omitted', async () => {
    await srsCommand('draft', '--ids', 'p1')
    expect(runDraftFromNotionPages).toHaveBeenCalled()
  })

  it('rejects an unknown draft source with exit code 2', async () => {
    await srsCommand('draft', '--from', 'magic')
    expect(process.exitCode).toBe(2)
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(err).toContain("unknown --from value 'magic'")
  })

  it('forwards write to runWriteSrs', async () => {
    await srsCommand('write', '--spec', 'spec.json')
    expect(runWriteSrs).toHaveBeenCalled()
  })

  it('forwards spawn to runSpawn', async () => {
    await srsCommand('spawn', '--ticket', '42', '--epic', 'page_x')
    expect(runSpawn).toHaveBeenCalled()
  })

  it('forwards apply-update to runApplyUpdate', async () => {
    await srsCommand('apply-update')
    expect(runApplyUpdate).toHaveBeenCalled()
  })

  it('forwards eval to runEvalSrs', async () => {
    await srsCommand('eval')
    expect(runEvalSrs).toHaveBeenCalled()
  })

  it('emits usage and sets exit code 2 for unknown action', async () => {
    await srsCommand('make-coffee')
    expect(process.exitCode).toBe(2)
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(err).toContain("unknown action 'make-coffee'")
  })

  it('propagates runner exit codes to process.exitCode', async () => {
    ;(runValidate as jest.Mock).mockResolvedValueOnce(3)
    await srsCommand('validate')
    expect(process.exitCode).toBe(3)
  })

  it('sets exit code 1 on unexpected runner error', async () => {
    ;(runValidate as jest.Mock).mockRejectedValueOnce(new Error('boom'))
    await srsCommand('validate')
    expect(process.exitCode).toBe(1)
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(err).toContain('unexpected error — boom')
  })
})
