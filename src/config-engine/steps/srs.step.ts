import { promptSrsConfiguration, promptSrsIngestion } from '../../prompts/srs.prompts'
import { StepDefinition } from '../types'

/**
 * SRS bootstrap + ingestion opt-ins. `promptSrsConfiguration` receives the
 * accumulated state so an already-collected Notion token is not asked twice.
 */
export const srsStep: StepDefinition = {
  id: 'srs',
  title: 'SRS workspace',
  collect: async ({ state, prefill, nonInteractive }) => {
    const options = { prefill, nonInteractive }
    const srsAnswers = await promptSrsConfiguration(state, options)
    const ingestionAnswers = srsAnswers.srsEnable ? await promptSrsIngestion(options) : { srsIngestEnable: false as const }

    return { ...srsAnswers, ...ingestionAnswers }
  },
  decisions: (collected) => [{ stepId: 'srs', name: 'srsEnable', value: collected.srsEnable ?? false }]
}
