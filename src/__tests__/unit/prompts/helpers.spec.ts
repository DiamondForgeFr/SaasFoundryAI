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

/**
 * #607 — a field whose step declares a default was still reported as missing in
 * non-interactive mode, so a scripted run had to supply values the CLI already knew how to
 * choose: `--s3-bucket` under `--s3-setup docker`, `--db-user/--db-password/--db-name`
 * under `--db-setup docker`, `--db-type` under `--db-setup credentials`.
 *
 * Interactive runs never saw it, because inquirer applies those defaults itself. The rule
 * here only makes the two paths agree.
 */
describe('a declared default is an answer (#607)', () => {
  beforeEach(() => {
    mockedPrompt.mockReset()
    mockedPrompt.mockResolvedValue({})
  })

  const resolved = () => mockedPrompt.mock.calls[0][1]

  it('resolves a field that has a default instead of refusing', async () => {
    await promptWithPrefill([{ type: 'input', name: 'region', message: 'Region?', default: 'us-east-1' }], { nonInteractive: true })

    expect(resolved()).toEqual({ region: 'us-east-1' })
  })

  it('still refuses a field that has neither prefill nor default', async () => {
    const questions: DistinctQuestion[] = [
      { type: 'input', name: 'endpoint', message: 'Endpoint?' },
      { type: 'input', name: 'region', message: 'Region?', default: 'us-east-1' }
    ]

    await expect(promptWithPrefill(questions, { nonInteractive: true })).rejects.toThrow(/Missing required values in --non-interactive mode: endpoint$|endpoint\n/)
  })

  it('names only the fields that genuinely cannot be guessed', async () => {
    const questions: DistinctQuestion[] = [
      { type: 'input', name: 'host', message: 'Host?' },
      { type: 'input', name: 'port', message: 'Port?' },
      { type: 'input', name: 'user', message: 'User?', default: 'db_dev_user' }
    ]

    await expect(promptWithPrefill(questions, { nonInteractive: true })).rejects.toThrow(/: host, port\n/)
  })

  it('lets an explicit value win over the default', async () => {
    await promptWithPrefill([{ type: 'input', name: 'region', message: 'Region?', default: 'us-east-1' }], { nonInteractive: true, prefill: { region: 'eu-west-3' } })

    expect(resolved()).toEqual({ region: 'eu-west-3' })
  })

  it('evaluates a function default against the answers collected so far', async () => {
    const questions: DistinctQuestion[] = [
      { type: 'input', name: 'projectName', message: 'Name?' },
      { type: 'input', name: 'bucket', message: 'Bucket?', default: (current: { projectName?: string }) => `${current.projectName}-uploads` }
    ]

    await promptWithPrefill(questions, { nonInteractive: true, prefill: { projectName: 'acme' } })

    expect(resolved()).toEqual({ projectName: 'acme', bucket: 'acme-uploads' })
  })

  it("lets a resolved default satisfy a later question's `when`", async () => {
    const questions: DistinctQuestion[] = [
      { type: 'list', name: 'mode', message: 'Mode?', default: 'docker' },
      { type: 'input', name: 'bucket', message: 'Bucket?', when: (current) => current.mode === 'docker', default: 'b' },
      { type: 'input', name: 'endpoint', message: 'Endpoint?', when: (current) => current.mode === 'credentials' }
    ]

    // `endpoint` must stay inapplicable: the resolved `mode` is what decides that.
    await promptWithPrefill(questions, { nonInteractive: true })

    expect(resolved()).toEqual({ mode: 'docker', bucket: 'b' })
  })

  describe('dot-notation fields', () => {
    it('resolves into the nested shape inquirer expects', async () => {
      await promptWithPrefill([{ type: 'input', name: 's3Credentials.bucket', message: 'Bucket?', default: 'demo-uploads' }], { nonInteractive: true })

      expect(resolved()).toEqual({ s3Credentials: { bucket: 'demo-uploads' } })
    })

    it('keeps a sibling the caller already provided', async () => {
      const questions: DistinctQuestion[] = [
        { type: 'input', name: 'dbCredentials.host', message: 'Host?' },
        { type: 'input', name: 'dbCredentials.dbType', message: 'Type?', default: 'postgresql' }
      ]

      await promptWithPrefill(questions, { nonInteractive: true, prefill: { dbCredentials: { host: 'db.example.com' } } })

      expect(resolved()).toEqual({ dbCredentials: { host: 'db.example.com', dbType: 'postgresql' } })
    })

    it("does not write back into the caller's prefill", async () => {
      const prefill = { dbCredentials: { host: 'db.example.com' } }

      await promptWithPrefill([{ type: 'input', name: 'dbCredentials.dbType', message: 'Type?', default: 'postgresql' }], { nonInteractive: true, prefill })

      expect(prefill).toEqual({ dbCredentials: { host: 'db.example.com' } })
    })
  })

  describe('a default that cannot be honoured reads as absent', () => {
    it('reports the field missing rather than crashing when the default throws', async () => {
      const questions: DistinctQuestion[] = [
        {
          type: 'input',
          name: 'bucket',
          message: 'Bucket?',
          default: () => {
            throw new Error('nope')
          }
        }
      ]

      await expect(promptWithPrefill(questions, { nonInteractive: true })).rejects.toThrow(/: bucket\n/)
    })

    it('does not resolve a field to a Promise', async () => {
      const questions: DistinctQuestion[] = [{ type: 'input', name: 'bucket', message: 'Bucket?', default: async () => 'later' }]

      await expect(promptWithPrefill(questions, { nonInteractive: true })).rejects.toThrow(/: bucket\n/)
    })
  })
})
