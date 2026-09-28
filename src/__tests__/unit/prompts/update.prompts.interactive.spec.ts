import inquirer from 'inquirer'
import shelljs from 'shelljs'

import { getModuleSelections, getEmailModuleCredentials, getStorageModuleConfig, getSkillCredentials } from '../../../prompts/update.prompts'

jest.mock('../../../prompts/skills.prompts', () => ({
  promptAtlassianCredentials: jest.fn(),
  promptNotionCredentials: jest.fn(),
  promptFigmaCredentials: jest.fn()
}))

import { promptAtlassianCredentials, promptNotionCredentials, promptFigmaCredentials } from '../../../prompts/skills.prompts'

const mockedAtlassian = promptAtlassianCredentials as jest.MockedFunction<typeof promptAtlassianCredentials>
const mockedNotion = promptNotionCredentials as jest.MockedFunction<typeof promptNotionCredentials>
const mockedFigma = promptFigmaCredentials as jest.MockedFunction<typeof promptFigmaCredentials>

describe('update.prompts — interactive helpers', () => {
  let promptSpy: jest.SpyInstance
  let execSpy: jest.SpyInstance
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    promptSpy = jest.spyOn(inquirer, 'prompt')
    execSpy = jest.spyOn(shelljs, 'exec').mockImplementation((() => ({ code: 0, stdout: '', stderr: '' })) as never)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.useFakeTimers()
  })

  afterEach(() => {
    promptSpy.mockRestore()
    execSpy.mockRestore()
    logSpy.mockRestore()
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  describe('getModuleSelections', () => {
    it('returns the selected modules from inquirer', async () => {
      promptSpy.mockResolvedValueOnce({ selectedModules: ['email', 'analytics'] } as never)

      const result = await getModuleSelections([
        { name: 'Email', description: 'email module', value: 'email' },
        { name: 'Analytics', description: 'analytics module', value: 'analytics' },
        { name: 'Storage', description: 'storage module', value: 'storage' }
      ])

      expect(result).toEqual(['email', 'analytics'])

      const prompts = promptSpy.mock.calls[0][0] as Array<{ type: string; name: string; choices: unknown[] }>
      expect(prompts[0].type).toBe('checkbox')
      expect(prompts[0].name).toBe('selectedModules')
      expect(prompts[0].choices).toHaveLength(3)
    })
  })

  describe('getEmailModuleCredentials', () => {
    it('returns null when user declines to configure credentials', async () => {
      promptSpy.mockResolvedValueOnce({ ready: false } as never)

      const promise = getEmailModuleCredentials('demo')
      jest.advanceTimersByTime(4000)
      const result = await promise

      expect(result).toBeNull()
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping email module'))
    })

    it('returns credentials after user confirms and opens browser', async () => {
      promptSpy.mockResolvedValueOnce({ ready: true } as never).mockResolvedValueOnce({
        mailersendApiKey: 'ms-key-123',
        mailersendSenderEmail: 'noreply@demo.com',
        mailersendSenderName: 'Demo'
      } as never)

      const promise = getEmailModuleCredentials('demo')
      jest.advanceTimersByTime(4000)
      const result = await promise

      expect(result).toEqual({
        mailersendApiKey: 'ms-key-123',
        mailersendSenderEmail: 'noreply@demo.com',
        mailersendSenderName: 'Demo'
      })

      const openCall = execSpy.mock.calls.find((c) => String(c[0]).includes('mailersend.com'))
      expect(openCall).toBeDefined()
    })

    it('validates API key, email, and sender name via inquirer', async () => {
      promptSpy.mockResolvedValueOnce({ ready: true } as never).mockResolvedValueOnce({
        mailersendApiKey: 'k',
        mailersendSenderEmail: 'a@b.c',
        mailersendSenderName: 'Name'
      } as never)

      const promise = getEmailModuleCredentials('myproj')
      jest.advanceTimersByTime(4000)
      await promise

      const credentialsPromptArgs = promptSpy.mock.calls[1][0] as Array<{
        name: string
        validate: (input: string) => true | string
        default?: string
      }>

      const keyPrompt = credentialsPromptArgs.find((p) => p.name === 'mailersendApiKey')!
      expect(keyPrompt.validate('')).toBe('API key is required')
      expect(keyPrompt.validate('valid-key')).toBe(true)

      const emailPrompt = credentialsPromptArgs.find((p) => p.name === 'mailersendSenderEmail')!
      expect(emailPrompt.validate('')).toBe('Sender email is required')
      expect(emailPrompt.validate('not-an-email')).toBe('Please enter a valid email address')
      expect(emailPrompt.validate('ok@mail.com')).toBe(true)
      expect(emailPrompt.default).toBe('noreply@myproj.com')

      const namePrompt = credentialsPromptArgs.find((p) => p.name === 'mailersendSenderName')!
      expect(namePrompt.validate('')).toBe('Sender name is required')
      expect(namePrompt.validate('Acme')).toBe(true)
      expect(namePrompt.default).toBe('Myproj')
    })
  })

  describe('getStorageModuleConfig', () => {
    it('returns docker config without credentials when user picks docker', async () => {
      promptSpy.mockResolvedValueOnce({ s3Setup: 'docker' } as never)

      const result = await getStorageModuleConfig('myproj')

      expect(result).toEqual({ s3Setup: 'docker' })
      expect(promptSpy).toHaveBeenCalledTimes(1)
    })

    it('collects full credentials when user picks credentials', async () => {
      promptSpy.mockResolvedValueOnce({ s3Setup: 'credentials' } as never).mockResolvedValueOnce({
        endpoint: 'https://s3.example.com',
        accessKey: 'AK',
        secretKey: 'SK',
        bucket: 'my-bucket',
        region: 'eu-west-1'
      } as never)

      const result = await getStorageModuleConfig('myproj')

      expect(result.s3Setup).toBe('credentials')
      expect(result.s3Credentials).toEqual({
        endpoint: 'https://s3.example.com',
        accessKey: 'AK',
        secretKey: 'SK',
        bucket: 'my-bucket',
        region: 'eu-west-1'
      })
    })

    it('validates required S3 credential fields', async () => {
      promptSpy.mockResolvedValueOnce({ s3Setup: 'credentials' } as never).mockResolvedValueOnce({
        endpoint: 'https://s3.example.com',
        accessKey: 'AK',
        secretKey: 'SK',
        bucket: 'my-bucket',
        region: 'eu-west-1'
      } as never)

      await getStorageModuleConfig('demo')

      const credsArgs = promptSpy.mock.calls[1][0] as Array<{
        name: string
        validate?: (input: string) => true | string
        default?: string
      }>

      const endpoint = credsArgs.find((p) => p.name === 'endpoint')!
      expect(endpoint.validate!('')).toBe('Endpoint URL is required')
      expect(endpoint.validate!('https://s3')).toBe(true)

      const accessKey = credsArgs.find((p) => p.name === 'accessKey')!
      expect(accessKey.validate!('')).toBe('Access key is required')
      expect(accessKey.validate!('k')).toBe(true)

      const secretKey = credsArgs.find((p) => p.name === 'secretKey')!
      expect(secretKey.validate!('')).toBe('Secret key is required')
      expect(secretKey.validate!('s')).toBe(true)

      const bucket = credsArgs.find((p) => p.name === 'bucket')!
      expect(bucket.default).toBe('demo-uploads')

      const region = credsArgs.find((p) => p.name === 'region')!
      expect(region.default).toBe('us-east-1')
    })
  })

  describe('getSkillCredentials', () => {
    it('returns empty credentials for context7 without prompting', async () => {
      const result = await getSkillCredentials('context7')

      expect(result).toEqual({})
      expect(promptSpy).not.toHaveBeenCalled()
      expect(mockedAtlassian).not.toHaveBeenCalled()
    })

    it('delegates to atlassian prompt', async () => {
      mockedAtlassian.mockResolvedValueOnce({ atlassianEmail: 'a@b.c', atlassianApiToken: 't' })

      const result = await getSkillCredentials('atlassian')

      expect(result).toEqual({ atlassianEmail: 'a@b.c', atlassianApiToken: 't' })
      expect(mockedAtlassian).toHaveBeenCalled()
    })

    it('delegates to notion prompt', async () => {
      mockedNotion.mockResolvedValueOnce({ notionApiToken: 'n-token' })

      const result = await getSkillCredentials('notion')

      expect(result).toEqual({ notionApiToken: 'n-token' })
      expect(mockedNotion).toHaveBeenCalled()
    })

    it('delegates to figma prompt', async () => {
      mockedFigma.mockResolvedValueOnce({ figmaApiToken: 'f-token' })

      const result = await getSkillCredentials('figma')

      expect(result).toEqual({ figmaApiToken: 'f-token' })
      expect(mockedFigma).toHaveBeenCalled()
    })

    it('returns empty object for unknown skill', async () => {
      const result = await getSkillCredentials('mystery-skill')

      expect(result).toEqual({})
      expect(mockedAtlassian).not.toHaveBeenCalled()
      expect(mockedNotion).not.toHaveBeenCalled()
      expect(mockedFigma).not.toHaveBeenCalled()
    })
  })
})
