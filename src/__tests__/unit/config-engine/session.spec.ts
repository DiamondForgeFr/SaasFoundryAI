import { runConfigSession } from '../../../config-engine/session'
import { ConfigState, FieldDefinition, Renderer, StepDefinition } from '../../../config-engine/types'

/**
 * Test renderer: answers each field from a canned map (simulating user input)
 * after merging the provided prefill, mimicking Inquirer's native behaviour of
 * returning prefilled values as part of the answers object.
 */
const cannedRenderer = (cannedAnswers: Record<string, unknown>): Renderer & { calls: { fields: FieldDefinition[]; prefill: ConfigState; nonInteractive: boolean }[] } => {
  const calls: { fields: FieldDefinition[]; prefill: ConfigState; nonInteractive: boolean }[] = []
  return {
    calls,
    async render(fields, { prefill, nonInteractive }) {
      calls.push({ fields, prefill, nonInteractive })
      const out: Record<string, unknown> = { ...(prefill as Record<string, unknown>) }
      for (const field of fields) {
        if (out[field.name] === undefined && cannedAnswers[field.name] !== undefined) {
          out[field.name] = cannedAnswers[field.name]
        }
      }
      return out as ConfigState
    }
  }
}

const inputField = (name: string): FieldDefinition => ({ type: 'input', name, message: name })

describe('runConfigSession', () => {
  it('accumulates answers across steps and returns them as the validated config', async () => {
    const steps: StepDefinition[] = [
      { id: 'one', title: 'one', fields: [inputField('projectName')] },
      { id: 'two', title: 'two', fields: [inputField('projectDescription')] }
    ]
    const renderer = cannedRenderer({ projectName: 'acme', projectDescription: 'desc' })

    const { config } = await runConfigSession({ renderer, steps })

    expect(config).toMatchObject({ projectName: 'acme', projectDescription: 'desc' })
  })

  it('merges accumulated state into the prefill of later steps', async () => {
    const steps: StepDefinition[] = [
      { id: 'one', title: 'one', fields: [inputField('projectName')] },
      { id: 'two', title: 'two', fields: [inputField('projectDescription')] }
    ]
    const renderer = cannedRenderer({ projectName: 'acme', projectDescription: 'desc' })

    await runConfigSession({ renderer, steps, prefill: { mainBranch: 'main' } })

    expect(renderer.calls[1].prefill).toMatchObject({ mainBranch: 'main', projectName: 'acme' })
  })

  it('skips steps whose appliesTo returns false', async () => {
    const collect = jest.fn(async () => ({}))
    const steps: StepDefinition[] = [
      { id: 'one', title: 'one', fields: [inputField('emailService')] },
      { id: 'gated', title: 'gated', appliesTo: (state) => state.emailService === 'mailersend', collect }
    ]
    const renderer = cannedRenderer({ emailService: 'none' })

    await runConfigSession({ renderer, steps })

    expect(collect).not.toHaveBeenCalled()
  })

  it('exposes derivations computed from the accumulated state to later steps', async () => {
    let seenTool: string | undefined
    let seenSuggested: string[] | undefined
    const steps: StepDefinition[] = [
      { id: 'workflow', title: 'workflow', collect: async () => ({ workflow: { tool: 'jira' as const } }) },
      {
        id: 'skills',
        title: 'skills',
        collect: async ({ derived }) => {
          seenTool = derived.workflowTool
          seenSuggested = derived.suggestedSkills
          return {}
        }
      }
    ]

    await runConfigSession({ renderer: cannedRenderer({}), steps })

    expect(seenTool).toBe('jira')
    expect(seenSuggested).toEqual(['atlassian'])
  })

  it("derives workflowTool 'none' for steps running before any workflow decision", async () => {
    let seenTool: string | undefined
    const steps: StepDefinition[] = [
      {
        id: 'first',
        title: 'first',
        collect: async ({ derived }) => {
          seenTool = derived.workflowTool
          return {}
        }
      }
    ]

    await runConfigSession({ renderer: cannedRenderer({}), steps })

    expect(seenTool).toBe('none')
  })

  it('passes nonInteractive through to the renderer', async () => {
    const steps: StepDefinition[] = [{ id: 'one', title: 'one', fields: [inputField('projectName')] }]
    const renderer = cannedRenderer({})

    await runConfigSession({ renderer, steps, prefill: { projectName: 'acme' }, nonInteractive: true })

    expect(renderer.calls[0].nonInteractive).toBe(true)
  })

  it('merges collect results on top of rendered fields within the same step', async () => {
    const steps: StepDefinition[] = [
      {
        id: 'mixed',
        title: 'mixed',
        fields: [inputField('projectName')],
        collect: async () => ({ includeAnalytics: true })
      }
    ]
    const renderer = cannedRenderer({ projectName: 'acme' })

    const { config } = await runConfigSession({ renderer, steps })

    expect(config).toMatchObject({ projectName: 'acme', includeAnalytics: true })
  })

  it('lets a step render ad-hoc fields through ctx.render without merging them into state', async () => {
    const steps: StepDefinition[] = [
      {
        id: 'confirm-gate',
        title: 'confirm-gate',
        collect: async ({ render }) => {
          const { ready } = (await render([{ type: 'confirm', name: 'ready', message: 'ready?' }])) as { ready?: boolean }
          return ready ? { includeAnalytics: true } : {}
        }
      }
    ]
    const renderer = cannedRenderer({ ready: true })

    const { config } = await runConfigSession({ renderer, steps })

    expect(config).toMatchObject({ includeAnalytics: true })
    expect((config as unknown as Record<string, unknown>).ready).toBeUndefined()
  })

  it('records recap decisions per field root, collapsing dot-notation names', async () => {
    const steps: StepDefinition[] = [
      {
        id: 'db',
        title: 'db',
        fields: [inputField('dbSetup'), inputField('dbCredentials.host'), inputField('dbCredentials.port')],
        collect: async () => ({ dbCredentials: { host: 'h', port: '5432' } }) as ConfigState
      }
    ]
    const renderer = cannedRenderer({ dbSetup: 'credentials' })

    const { recap } = await runConfigSession({ renderer, steps })

    expect(recap).toEqual([
      { stepId: 'db', name: 'dbSetup', value: 'credentials' },
      { stepId: 'db', name: 'dbCredentials', value: { host: 'h', port: '5432' } }
    ])
  })

  it('uses the step decisions override when provided', async () => {
    const steps: StepDefinition[] = [
      {
        id: 'custom',
        title: 'custom',
        collect: async () => ({ includeAnalytics: false }),
        decisions: (collected) => [{ stepId: 'custom', name: 'analytics', value: collected.includeAnalytics }]
      }
    ]

    const { recap } = await runConfigSession({ renderer: cannedRenderer({}), steps })

    expect(recap).toEqual([{ stepId: 'custom', name: 'analytics', value: false }])
  })

  it('validates the step registry before running', async () => {
    const steps: StepDefinition[] = [
      { id: 'dup', title: 'a', fields: [inputField('x')] },
      { id: 'dup', title: 'b', fields: [inputField('y')] }
    ]

    await expect(runConfigSession({ renderer: cannedRenderer({}), steps })).rejects.toThrow(/duplicate step id/)
  })
})
