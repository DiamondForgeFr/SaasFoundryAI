import { parseWorkflowFlag } from '../../../commands/workflow-flag'

describe('parseWorkflowFlag', () => {
  it('leaves the choice open without the flag', () => {
    expect(parseWorkflowFlag(undefined)).toEqual({})
  })

  it.each(['solo', 'saasfoundry'] as const)('accepts the %s preset', (preset) => {
    expect(parseWorkflowFlag(preset)).toEqual({ preset })
  })

  it.each([false, 'none'] as const)('supports an explicit disabled workflow with %p', (value) => {
    expect(parseWorkflowFlag(value)).toEqual({ disabled: true })
  })

  it.each(['custom', 'sollo', 'team', 'github-projects'])('rejects %p and lists the valid values', (value) => {
    expect(() => parseWorkflowFlag(value)).toThrow(`Invalid --workflow "${value}". Expected one of: solo, saasfoundry, none.`)
  })
})
