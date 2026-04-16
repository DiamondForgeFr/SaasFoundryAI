import inquirer, { DistinctQuestion } from 'inquirer'

import { promptWithPrefill } from '../../../prompts/helpers'

jest.mock('inquirer')

const mockedPrompt = inquirer.prompt as unknown as jest.Mock

describe('promptWithPrefill', () => {
  beforeEach(() => {
    mockedPrompt.mockReset()
  })

  describe('interactive mode', () => {
    it('forwards prefill to inquirer as the second argument', async () => {
      mockedPrompt.mockResolvedValue({ name: 'acme', mode: 'fast' })

      const questions: DistinctQuestion[] = [
        { type: 'input', name: 'name', message: 'Name?' },
        { type: 'input', name: 'mode', message: 'Mode?' }
      ]

      const result = await promptWithPrefill(questions, { prefill: { name: 'acme' } })

      expect(mockedPrompt).toHaveBeenCalledTimes(1)
      expect(mockedPrompt).toHaveBeenCalledWith(questions, { name: 'acme' })
      expect(result).toEqual({ name: 'acme', mode: 'fast' })
    })

    it('passes an empty object when no prefill is provided', async () => {
      mockedPrompt.mockResolvedValue({ answer: 42 })

      await promptWithPrefill([{ type: 'input', name: 'answer', message: 'Answer?' }])

      expect(mockedPrompt).toHaveBeenCalledWith(expect.any(Array), {})
    })

    it('does not throw when non-prefilled questions remain', async () => {
      mockedPrompt.mockResolvedValue({ a: 1, b: 2 })

      await expect(
        promptWithPrefill(
          [
            { type: 'input', name: 'a', message: '?' },
            { type: 'input', name: 'b', message: '?' }
          ],
          { prefill: { a: 1 } }
        )
      ).resolves.toEqual({ a: 1, b: 2 })
    })
  })

  describe('non-interactive mode', () => {
    it('throws listing all missing required values', async () => {
      await expect(
        promptWithPrefill(
          [
            { type: 'input', name: 'projectName', message: 'Project name?' },
            { type: 'list', name: 'structure', message: 'Structure?' },
            { type: 'input', name: 'mainBranch', message: 'Branch?' }
          ],
          { nonInteractive: true, prefill: { projectName: 'acme' } }
        )
      ).rejects.toThrow(/Missing required values in --non-interactive mode: structure, mainBranch/)
    })

    it('does not call inquirer when values are missing', async () => {
      await expect(promptWithPrefill([{ type: 'input', name: 'missing', message: '?' }], { nonInteractive: true })).rejects.toThrow()

      expect(mockedPrompt).not.toHaveBeenCalled()
    })

    it('passes through when every applicable question has a prefilled value', async () => {
      mockedPrompt.mockResolvedValue({ name: 'acme', branch: 'main' })

      const result = await promptWithPrefill(
        [
          { type: 'input', name: 'name', message: '?' },
          { type: 'input', name: 'branch', message: '?' }
        ],
        { nonInteractive: true, prefill: { name: 'acme', branch: 'main' } }
      )

      expect(result).toEqual({ name: 'acme', branch: 'main' })
      expect(mockedPrompt).toHaveBeenCalledTimes(1)
    })

    it('ignores questions whose `when` evaluates to false', async () => {
      mockedPrompt.mockResolvedValue({ emailService: 'none' })

      const questions: DistinctQuestion[] = [
        { type: 'list', name: 'emailService', message: '?' },
        {
          type: 'input',
          name: 'mailersendApiKey',
          message: '?',
          when: (answers) => answers.emailService === 'mailersend'
        }
      ]

      await expect(promptWithPrefill(questions, { nonInteractive: true, prefill: { emailService: 'none' } })).resolves.toEqual({ emailService: 'none' })
    })

    it('reports conditional questions as missing when the `when` evaluates to true', async () => {
      const questions: DistinctQuestion[] = [
        { type: 'list', name: 'emailService', message: '?' },
        {
          type: 'input',
          name: 'mailersendApiKey',
          message: '?',
          when: (answers) => answers.emailService === 'mailersend'
        }
      ]

      await expect(promptWithPrefill(questions, { nonInteractive: true, prefill: { emailService: 'mailersend' } })).rejects.toThrow(/mailersendApiKey/)
    })

    it('resolves nested dot-notation paths in prefill (e.g. dbCredentials.host)', async () => {
      mockedPrompt.mockResolvedValue({ 'dbCredentials.host': 'localhost' })

      await expect(promptWithPrefill([{ type: 'input', name: 'dbCredentials.host', message: '?' }], { nonInteractive: true, prefill: { dbCredentials: { host: 'localhost' } } })).resolves.toBeDefined()
    })

    it('treats `when` callbacks returning undefined as falsy (matches Inquirer)', async () => {
      mockedPrompt.mockResolvedValue({})

      const questions: DistinctQuestion[] = [
        {
          type: 'input',
          name: 'nested',
          message: '?',
          when: (answers) => answers.parent
        }
      ]

      await expect(promptWithPrefill(questions, { nonInteractive: true })).resolves.toBeDefined()
    })

    it('deduplicates missing names when multiple questions share the same name', async () => {
      const questions: DistinctQuestion[] = [
        { type: 'list', name: 'setupRepo', message: 'Monorepo repo?', when: (a) => a.isMonorepo === true },
        { type: 'list', name: 'setupRepo', message: 'Multirepo repo?', when: (a) => a.isMonorepo === false }
      ]

      await expect(promptWithPrefill(questions, { nonInteractive: true, prefill: { isMonorepo: true } })).rejects.toThrow(/setupRepo(?!.*setupRepo)/s)
    })

    it('treats async `when` callbacks as applicable (safer to ask)', async () => {
      const questions: DistinctQuestion[] = [
        {
          type: 'input',
          name: 'asyncField',
          message: '?',
          when: async () => true
        }
      ]

      await expect(promptWithPrefill(questions, { nonInteractive: true })).rejects.toThrow(/asyncField/)
    })
  })
})
