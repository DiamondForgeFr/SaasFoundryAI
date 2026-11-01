import { maybeEmitStaleSkillWarning } from '../../../skill/warn'
import { checkSkillStatus } from '../../../skill/update'

jest.mock('../../../skill/update', () => ({ checkSkillStatus: jest.fn() }))

describe('doctor startup isolation', () => {
  it('does not inspect the user skill installation or emit its advisory', async () => {
    await maybeEmitStaleSkillWarning(['node', 'sf', 'agents', 'doctor', '--json'], '1.0.0')
    expect(checkSkillStatus).not.toHaveBeenCalled()
  })
})

describe('hook capture isolation (#1120)', () => {
  beforeEach(() => jest.mocked(checkSkillStatus).mockReset())

  it('keeps the delegation capture run by the host hooks silent', async () => {
    await maybeEmitStaleSkillWarning(['node', 'sf', 'agents', 'outcome', 'capture', '--host', 'claude-code'], '1.1.0')
    expect(checkSkillStatus).not.toHaveBeenCalled()
  })

  it('still checks the skill for the outcome commands a person runs', async () => {
    jest.mocked(checkSkillStatus).mockResolvedValue({ installed: false } as Awaited<ReturnType<typeof checkSkillStatus>>)
    await maybeEmitStaleSkillWarning(['node', 'sf', 'agents', 'outcome', 'record'], '1.1.0')
    expect(checkSkillStatus).toHaveBeenCalledWith('user', '1.1.0')
  })
})
