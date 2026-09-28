import { DistinctQuestion } from 'inquirer'

import { promptWithPrefill } from '../../prompts/helpers'
import { Answers } from '../../types'
import { ConfigState, FieldDefinition, Renderer } from '../types'

/**
 * Inquirer renderer — the ONLY config-engine component that talks to
 * Inquirer. `FieldDefinition` is structurally compatible with Inquirer's
 * question shape, so fields pass straight through `promptWithPrefill`, which
 * provides the prefill-skip and non-interactive missing-value contract.
 */
export const inquirerRenderer: Renderer = {
  async render(fields: FieldDefinition[], { prefill, nonInteractive }): Promise<ConfigState> {
    const questions = fields as unknown as ReadonlyArray<DistinctQuestion<Answers>>
    return promptWithPrefill<Answers>(questions, { prefill, nonInteractive })
  }
}
