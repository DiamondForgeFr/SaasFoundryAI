import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const chmod = jest.fn()
jest.mock('fs/promises', () => ({ ...jest.requireActual('fs/promises'), chmod: (...args: unknown[]) => chmod(...args) }))

import { installSrsSkill } from '../../../installers/srs-skill.installer'

// #433 — only a missing script is silent; a failed chmod leaves srs-cli.sh unusable
describe('installSrsSkill — executable bit', () => {
  let tmp: string
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-srs-chmod-'))
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    chmod.mockReset()
  })

  afterEach(() => {
    warnSpy.mockRestore()
    rmSync(tmp, { recursive: true, force: true })
  })

  it('warns with the remediation when chmod fails', async () => {
    chmod.mockRejectedValue(Object.assign(new Error('operation not permitted'), { code: 'EPERM' }))
    await installSrsSkill({ targetPath: tmp })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('chmod +x'))
  })

  it('stays silent when the script is missing', async () => {
    chmod.mockRejectedValue(Object.assign(new Error('no such file'), { code: 'ENOENT' }))
    await installSrsSkill({ targetPath: tmp })
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
