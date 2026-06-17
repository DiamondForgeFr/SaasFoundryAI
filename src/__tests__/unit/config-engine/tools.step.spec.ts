jest.mock('../../../tools/connection-checks', () => ({
  checkConnection: jest.fn().mockResolvedValue({ status: 'warn', detail: 'no credential found — entry deferred' })
}))

import { checkConnection } from '../../../tools/connection-checks'
import { toolsStep } from '../../../config-engine/steps/tools.step'
import { ConfigState, StepContext } from '../../../config-engine/types'

const checkConnectionMock = checkConnection as jest.Mock

const stepContext = (overrides: Partial<StepContext> = {}): StepContext => ({
  state: {},
  prefill: {},
  nonInteractive: false,
  derived: {},
  render: jest.fn(async () => ({})),
  ...overrides
})

describe('toolsStep', () => {
  beforeEach(() => jest.clearAllMocks())

  it('applies to full and harness profiles, not stack', () => {
    const ctx = { prefill: {}, nonInteractive: false, derived: {} }
    expect(toolsStep.appliesTo?.({ profile: 'full' }, ctx)).toBe(true)
    expect(toolsStep.appliesTo?.({ profile: 'harness' }, ctx)).toBe(true)
    expect(toolsStep.appliesTo?.({ profile: 'stack' }, ctx)).toBe(false)
  })

  it('declares the live-connection-check side effect', () => {
    expect(toolsStep.effects?.length).toBeGreaterThan(0)
  })

  describe('non-interactive', () => {
    it('persists prefilled selections and never touches the network', async () => {
      const toolSelections = { tracker: { name: 'github-projects' }, docs: { name: 'notion' }, design: [{ name: 'figma' }] }
      const result = await toolsStep.collect?.(stepContext({ nonInteractive: true, prefill: { toolSelections } }))

      expect(result).toEqual({ toolSelections })
      expect(checkConnectionMock).not.toHaveBeenCalled()
    })

    it('drops empty categories from the prefilled selections', async () => {
      const result = await toolsStep.collect?.(stepContext({ nonInteractive: true, prefill: { toolSelections: { tracker: { name: '' }, design: [] } } }))
      expect(result).toEqual({ toolSelections: {} })
    })

    it('returns nothing when no selections were prefilled', async () => {
      const result = await toolsStep.collect?.(stepContext({ nonInteractive: true }))
      expect(result).toEqual({})
    })
  })

  describe('interactive', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    afterAll(() => logSpy.mockRestore())

    // render returns the answer keyed by the field name the step used per category
    const renderReturning = (byName: Record<string, unknown>) =>
      jest.fn(async (fields: { name: string }[]) => {
        const name = fields[0].name
        return { [name]: byName[name] } as unknown as ConfigState
      })

    it('builds a single tracker, single docs and multiple design selections', async () => {
      const render = renderReturning({ tool_tracker: 'jira', tool_docs: 'notion', tool_design: ['figma', 'miro'] })
      const result = await toolsStep.collect?.(stepContext({ render }))

      expect(result).toEqual({
        toolSelections: { tracker: { name: 'jira' }, docs: { name: 'notion' }, design: [{ name: 'figma' }, { name: 'miro' }] }
      })
    })

    it('omits a category when the user picks None', async () => {
      const render = renderReturning({ tool_tracker: '__none__', tool_docs: 'local-markdown', tool_design: [] })
      const result = await toolsStep.collect?.(stepContext({ render }))

      expect(result).toEqual({ toolSelections: { docs: { name: 'local-markdown' } } })
    })

    it('runs a connection check per selected tool but a warn never blocks the result', async () => {
      const render = renderReturning({ tool_tracker: 'github-projects', tool_docs: '__none__', tool_design: ['figma'] })
      const result = await toolsStep.collect?.(stepContext({ render }))

      // tracker + one design tool checked; docs was None
      expect(checkConnectionMock).toHaveBeenCalledTimes(2)
      expect(result).toEqual({ toolSelections: { tracker: { name: 'github-projects' }, design: [{ name: 'figma' }] } })
    })

    it('defaults the tracker prompt to the tracker derived from earlier state', async () => {
      const render = renderReturning({ tool_tracker: 'jira', tool_docs: '__none__', tool_design: [] })
      await toolsStep.collect?.(stepContext({ render, derived: { selectedTracker: 'jira' } }))

      const trackerCall = (render as jest.Mock).mock.calls.find((c) => c[0][0].name === 'tool_tracker')
      expect(trackerCall?.[0][0].default).toBe('jira')
    })

    it('passes the --no-network flag through to the connection check', async () => {
      const render = renderReturning({ tool_tracker: 'notion', tool_docs: '__none__', tool_design: [] })
      await toolsStep.collect?.(stepContext({ render, prefill: { toolsNoNetwork: true } }))

      expect(checkConnectionMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'notion', category: 'tracker' }), expect.objectContaining({ noNetwork: true }))
    })
  })

  describe('decisions (recap)', () => {
    it('emits one entry per category', () => {
      const decisions = toolsStep.decisions?.({ toolSelections: { tracker: { name: 'jira' }, design: [{ name: 'figma' }] } }, {})
      expect(decisions).toEqual([
        { stepId: 'tools', name: 'tracker', value: 'jira' },
        { stepId: 'tools', name: 'docs', value: 'none' },
        { stepId: 'tools', name: 'design', value: ['figma'] }
      ])
    })
  })
})
