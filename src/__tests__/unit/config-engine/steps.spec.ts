import { computeDerivations } from '../../../config-engine/derivations'
import { assertStepRegistry, configSteps } from '../../../config-engine/registry'
import { emailCredentialsStep } from '../../../config-engine/steps/email-credentials.step'
import { projectStep } from '../../../config-engine/steps/project.step'
import { skillsStep } from '../../../config-engine/steps/skills.step'
import { srsStep } from '../../../config-engine/steps/srs.step'
import { storageStep } from '../../../config-engine/steps/storage.step'
import { workflowStep } from '../../../config-engine/steps/workflow.step'
import { ConfigState, FieldDefinition, StepContext } from '../../../config-engine/types'

jest.mock('../../../prompts/workflow.prompts', () => ({
  promptWorkflowConfiguration: jest.fn().mockResolvedValue({ workflow: { tool: 'github-projects' }, aiRules: {} })
}))
jest.mock('../../../prompts/skills.prompts', () => ({
  promptAdvancedSkills: jest.fn().mockResolvedValue(['context7']),
  collectAdvancedSkillsCredentials: jest.fn().mockResolvedValue({ context7ApiKey: undefined })
}))
jest.mock('../../../prompts/srs.prompts', () => ({
  promptSrsConfiguration: jest.fn().mockResolvedValue({ srsEnable: false }),
  promptSrsIngestion: jest.fn()
}))

import { promptWorkflowConfiguration } from '../../../prompts/workflow.prompts'
import { collectAdvancedSkillsCredentials, promptAdvancedSkills } from '../../../prompts/skills.prompts'
import { promptSrsConfiguration, promptSrsIngestion } from '../../../prompts/srs.prompts'

const stepContext = (overrides: Partial<StepContext> = {}): StepContext => ({
  state: {},
  prefill: {},
  nonInteractive: false,
  derived: {},
  render: jest.fn(async () => ({})),
  ...overrides
})

describe('configSteps registry', () => {
  it('passes the structural assertions', () => {
    expect(() => assertStepRegistry(configSteps)).not.toThrow()
  })

  it('keeps the historical batch order of sf new, profile first', () => {
    expect(configSteps.map((s) => s.id)).toEqual(['profile', 'project', 'harness-project', 'email-credentials', 'storage', 'analytics', 'workflow', 'skills', 'srs'])
  })

  it('declares effects on every step wrapping an external side effect', () => {
    expect(emailCredentialsStep.effects?.length).toBeGreaterThan(0)
    expect(workflowStep.effects?.length).toBeGreaterThan(0)
    expect(skillsStep.effects?.length).toBeGreaterThan(0)
  })
})

describe('projectStep', () => {
  it('asks the project name first with kebab-case validation', () => {
    const first = (projectStep.fields as FieldDefinition[])[0]
    expect(first.name).toBe('projectName')
    expect(first.validate?.('UpperCase')).toMatch(/lowercase/)
    expect(first.validate?.('acme-app')).toBe(true)
  })

  it('gates repo URL questions on structure + existing repo', () => {
    const monorepoUrl = projectStep.fields?.find((f) => f.name === 'monorepoUrl')
    expect(monorepoUrl?.when?.({ isMonorepo: true, setupRepo: 'existing' })).toBe(true)
    expect(monorepoUrl?.when?.({ isMonorepo: true, setupRepo: 'local' })).toBe(false)
    expect(monorepoUrl?.when?.({ isMonorepo: false, setupRepo: 'existing' })).toBe(false)
  })

  it('asks db credentials only for the relevant setups', () => {
    const host = projectStep.fields?.find((f) => f.name === 'dbCredentials.host')
    expect(host?.when?.({ dbSetup: 'credentials' })).toBe(true)
    expect(host?.when?.({ dbSetup: 'docker' })).toBe(false)

    const user = projectStep.fields?.find((f) => f.name === 'dbCredentials.user')
    expect(user?.when?.({ dbSetup: 'docker' })).toBe(true)
    expect(user?.when?.({ dbSetup: 'manual' })).toBe(false)
  })
})

describe('emailCredentialsStep', () => {
  it('applies only when MailerSend was selected', () => {
    const ctx = { prefill: {}, nonInteractive: false, derived: {} }
    expect(emailCredentialsStep.appliesTo?.({ emailService: 'mailersend' }, ctx)).toBe(true)
    expect(emailCredentialsStep.appliesTo?.({ emailService: 'none' }, ctx)).toBe(false)
  })

  it('renders the three credential fields directly when all credentials are prefilled', async () => {
    const render = jest.fn<Promise<ConfigState>, [FieldDefinition[]]>(async () => ({ mailersendApiKey: 'k' }))
    const ctx = stepContext({
      state: { projectName: 'acme', emailService: 'mailersend' },
      prefill: { mailersendApiKey: 'k', mailersendSenderEmail: 'e@acme.com', mailersendSenderName: 'Acme' },
      render
    })

    await emailCredentialsStep.collect?.(ctx)

    expect(render).toHaveBeenCalledTimes(1)
    const fields = render.mock.calls[0][0]
    expect(fields.map((f) => f.name)).toEqual(['mailersendApiKey', 'mailersendSenderEmail', 'mailersendSenderName'])
  })

  it('derives sender defaults from the project name', async () => {
    const render = jest.fn<Promise<ConfigState>, [FieldDefinition[]]>(async () => ({}))
    const ctx = stepContext({
      state: { projectName: 'acme', emailService: 'mailersend' },
      prefill: { mailersendApiKey: 'k', mailersendSenderEmail: 'e@acme.com', mailersendSenderName: 'Acme' },
      render
    })

    await emailCredentialsStep.collect?.(ctx)

    const fields = render.mock.calls[0][0]
    expect(fields.find((f) => f.name === 'mailersendSenderEmail')?.default).toBe('noreply@acme.com')
    expect(fields.find((f) => f.name === 'mailersendSenderName')?.default).toBe('Acme')
  })
})

describe('storageStep', () => {
  it('derives the bucket default from the accumulated project name', () => {
    const bucket = storageStep.fields?.find((f) => f.name === 's3Credentials.bucket')
    expect((bucket?.default as (c: ConfigState) => string)({ projectName: 'acme' })).toBe('acme-uploads')
  })

  it('asks endpoint/keys/region only for existing servers', () => {
    const endpoint = storageStep.fields?.find((f) => f.name === 's3Credentials.endpoint')
    expect(endpoint?.when?.({ s3Setup: 'credentials' })).toBe(true)
    expect(endpoint?.when?.({ s3Setup: 'docker' })).toBe(false)

    const bucket = storageStep.fields?.find((f) => f.name === 's3Credentials.bucket')
    expect(bucket?.when?.({ s3Setup: 'docker' })).toBe(true)
  })
})

describe('workflowStep', () => {
  beforeEach(() => jest.clearAllMocks())

  it('non-interactive: returns the prefilled workflow as-is', async () => {
    const workflow = { tool: 'github-projects' as const }
    const result = await workflowStep.collect?.(stepContext({ nonInteractive: true, prefill: { workflow } }))

    expect(result).toEqual({ workflow, aiRules: undefined })
    expect(promptWorkflowConfiguration).not.toHaveBeenCalled()
  })

  it('non-interactive: skips silently without a prefilled workflow', async () => {
    const result = await workflowStep.collect?.(stepContext({ nonInteractive: true }))

    expect(result).toEqual({})
    expect(promptWorkflowConfiguration).not.toHaveBeenCalled()
  })

  it('interactive: delegates to promptWorkflowConfiguration with the repo URL from state', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const render = jest.fn(async () => ({ configureWorkflow: true }) as unknown as ConfigState)

    const result = await workflowStep.collect?.(stepContext({ state: { projectName: 'acme', backendRepoUrl: 'https://git/acme' }, render }))

    expect(promptWorkflowConfiguration).toHaveBeenCalledWith('acme', 'https://git/acme')
    expect(result).toMatchObject({ workflow: { tool: 'github-projects' } })
    logSpy.mockRestore()
  })

  it('interactive: declining leaves the workflow unset', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const render = jest.fn(async () => ({ configureWorkflow: false }) as unknown as ConfigState)

    const result = await workflowStep.collect?.(stepContext({ render }))

    expect(result).toEqual({})
    expect(promptWorkflowConfiguration).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })
})

describe('skillsStep', () => {
  beforeEach(() => jest.clearAllMocks())

  it('passes the derived workflow tool to the skills pre-selection', async () => {
    const derived = computeDerivations({ workflow: { tool: 'jira' } })

    await skillsStep.collect?.(stepContext({ derived }))

    expect(promptAdvancedSkills).toHaveBeenCalledWith('jira', expect.objectContaining({ nonInteractive: false }))
  })

  it('collects credentials for the selected skills and merges them', async () => {
    const result = await skillsStep.collect?.(stepContext())

    expect(collectAdvancedSkillsCredentials).toHaveBeenCalledWith(['context7'], expect.any(Object))
    expect(result).toMatchObject({ advancedSkills: ['context7'] })
  })
})

describe('srsStep', () => {
  beforeEach(() => jest.clearAllMocks())

  it('skips the ingestion question when SRS is declined', async () => {
    const result = await srsStep.collect?.(stepContext())

    expect(promptSrsIngestion).not.toHaveBeenCalled()
    expect(result).toMatchObject({ srsEnable: false, srsIngestEnable: false })
  })

  it('asks for ingestion when SRS is enabled', async () => {
    ;(promptSrsConfiguration as jest.Mock).mockResolvedValueOnce({ srsEnable: true, srsBackend: 'notion' })
    ;(promptSrsIngestion as jest.Mock).mockResolvedValueOnce({ srsIngestEnable: true, srsIngestParentInput: 'page' })

    const result = await srsStep.collect?.(stepContext({ state: { projectName: 'acme' } }))

    expect(promptSrsIngestion).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ srsEnable: true, srsIngestEnable: true })
  })

  it('hands the accumulated state to promptSrsConfiguration so collected tokens are reused', async () => {
    const state = { projectName: 'acme', notionApiToken: 'secret' }

    await srsStep.collect?.(stepContext({ state }))

    expect(promptSrsConfiguration).toHaveBeenCalledWith(state, expect.any(Object))
  })
})
