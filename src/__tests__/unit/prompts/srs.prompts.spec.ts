import inquirer from 'inquirer'

import { promptSrsConfiguration } from '../../../prompts/srs.prompts'

describe('promptSrsConfiguration', () => {
  let promptSpy: jest.SpyInstance
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    promptSpy = jest.spyOn(inquirer, 'prompt')
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    promptSpy.mockRestore()
    logSpy.mockRestore()
    jest.clearAllMocks()
  })

  it('returns early with srsEnable=false when the user declines', async () => {
    promptSpy.mockResolvedValueOnce({ srsEnable: false } as never)

    const result = await promptSrsConfiguration({})

    expect(result).toEqual({ srsEnable: false })
    expect(promptSpy).toHaveBeenCalledTimes(1)
  })

  it('collects backend, token, and parent page input when enabled', async () => {
    promptSpy
      .mockResolvedValueOnce({ srsEnable: true } as never)
      .mockResolvedValueOnce({ srsBackend: 'notion' } as never)
      .mockResolvedValueOnce({ notionApiToken: 'secret_ntn', srsParentPageInput: 'https://www.notion.so/My-page-abc123' } as never)

    const result = await promptSrsConfiguration({})

    expect(result).toEqual({
      srsEnable: true,
      srsBackend: 'notion',
      srsParentPageInput: 'https://www.notion.so/My-page-abc123',
      notionApiToken: 'secret_ntn'
    })
    expect(promptSpy).toHaveBeenCalledTimes(3)
  })

  it('reuses an already-collected Notion token and skips the token question', async () => {
    promptSpy
      .mockResolvedValueOnce({ srsEnable: true } as never)
      .mockResolvedValueOnce({ srsBackend: 'notion' } as never)
      .mockResolvedValueOnce({ srsParentPageInput: 'abc123abc123abc123abc123abc123ab' } as never)

    const result = await promptSrsConfiguration({ notionApiToken: 'reused_token' })

    expect(result).toEqual({
      srsEnable: true,
      srsBackend: 'notion',
      srsParentPageInput: 'abc123abc123abc123abc123abc123ab',
      notionApiToken: 'reused_token'
    })

    const thirdCallQuestions = promptSpy.mock.calls[2][0] as Array<{ name: string }>
    expect(thirdCallQuestions.map((q) => q.name)).toEqual(['srsParentPageInput'])
  })

  it('forwards prefill to inquirer so non-interactive answers are picked up', async () => {
    promptSpy
      .mockResolvedValueOnce({ srsEnable: true } as never)
      .mockResolvedValueOnce({ srsBackend: 'notion' } as never)
      .mockResolvedValueOnce({ notionApiToken: 'prefilled', srsParentPageInput: 'prefilled-page-id' } as never)

    await promptSrsConfiguration(
      {},
      {
        prefill: { srsEnable: true, srsBackend: 'notion', notionApiToken: 'prefilled', srsParentPageInput: 'prefilled-page-id' },
        nonInteractive: true
      }
    )

    expect(promptSpy).toHaveBeenCalledTimes(3)
    const firstPrefill = promptSpy.mock.calls[0][1] as Record<string, unknown>
    expect(firstPrefill.srsEnable).toBe(true)
  })

  it('validates the parent input as a non-empty string', async () => {
    promptSpy
      .mockResolvedValueOnce({ srsEnable: true } as never)
      .mockResolvedValueOnce({ srsBackend: 'notion' } as never)
      .mockResolvedValueOnce({ notionApiToken: 't', srsParentPageInput: 'x' } as never)

    await promptSrsConfiguration({})

    const thirdCall = promptSpy.mock.calls[2][0] as Array<{ name: string; validate?: (s: string) => true | string }>
    const parent = thirdCall.find((q) => q.name === 'srsParentPageInput')
    expect(parent?.validate).toBeDefined()
    expect(parent!.validate!('')).toMatch(/required/i)
    expect(parent!.validate!('   ')).toMatch(/required/i)
    expect(parent!.validate!('any-value')).toBe(true)
  })

  it('validates the Notion token as non-empty when not already collected', async () => {
    promptSpy
      .mockResolvedValueOnce({ srsEnable: true } as never)
      .mockResolvedValueOnce({ srsBackend: 'notion' } as never)
      .mockResolvedValueOnce({ notionApiToken: 'tk', srsParentPageInput: 'x' } as never)

    await promptSrsConfiguration({})

    const thirdCall = promptSpy.mock.calls[2][0] as Array<{ name: string; validate?: (s: string) => true | string }>
    const token = thirdCall.find((q) => q.name === 'notionApiToken')
    expect(token?.validate).toBeDefined()
    expect(token!.validate!('')).toMatch(/required/i)
    expect(token!.validate!('secret')).toBe(true)
  })
})
