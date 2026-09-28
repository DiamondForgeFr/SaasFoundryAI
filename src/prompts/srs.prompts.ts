import chalk from 'chalk'

import { SrsAdapter } from '../builders/srs/types'
import { Answers } from '../types'
import { promptWithPrefill, PromptOptions } from './helpers'

export interface SrsPromptsOptions extends PromptOptions {
  adapterFactory?: (token: string) => SrsAdapter
}

export interface SrsPromptsAnswers {
  srsEnable: boolean
  srsBackend?: 'notion'
  srsParentPageInput?: string
  notionApiToken?: string
  notionApiVersion?: string
}

export interface SrsIngestionPromptsAnswers {
  srsIngestEnable: boolean
  srsIngestParentInput?: string
}

export async function promptSrsConfiguration(currentAnswers: Partial<Answers>, options: SrsPromptsOptions = {}): Promise<SrsPromptsAnswers> {
  const { prefill = {}, nonInteractive = false } = options

  const enableAnswer = await promptWithPrefill<Pick<Answers, 'srsEnable'>>(
    [
      {
        type: 'confirm',
        name: 'srsEnable',
        message: 'Would you like to centralise your Software Requirements Specifications (SRS)?',
        default: false
      }
    ],
    { prefill, nonInteractive }
  )

  if (!enableAnswer.srsEnable) {
    return { srsEnable: false }
  }

  const backendAnswer = await promptWithPrefill<Pick<Answers, 'srsBackend'>>(
    [
      {
        type: 'list',
        name: 'srsBackend',
        message: 'Which backend should host the SRS?',
        choices: [{ name: 'Notion (V1)', value: 'notion' }],
        default: 'notion'
      }
    ],
    { prefill, nonInteractive }
  )

  const tokenAlreadyCollected = currentAnswers.notionApiToken !== undefined
  const tokenPrompts = tokenAlreadyCollected
    ? []
    : [
        {
          type: 'password' as const,
          name: 'notionApiToken',
          message: 'Paste your Notion integration token (create one at https://www.notion.so/profile/integrations):',
          mask: '*',
          validate: (input: string) => (input && input.length > 0 ? true : 'Notion integration token is required')
        }
      ]

  const parentPrompt = {
    type: 'input' as const,
    name: 'srsParentPageInput',
    message: 'Paste the URL or ID of the Notion page that will host the SRS (share it with your integration first):',
    validate: (input: string) => (input && input.trim().length > 0 ? true : 'Parent page URL or ID is required')
  }

  const credsAndParent = await promptWithPrefill<Pick<Answers, 'notionApiToken' | 'srsParentPageInput'>>([...tokenPrompts, parentPrompt], {
    prefill: { ...prefill, ...currentAnswers },
    nonInteractive
  })

  if (!nonInteractive) {
    console.log(chalk.gray('  The parent page will host the project root page. Epics will be created as direct children of that root.'))
  }

  return {
    srsEnable: true,
    srsBackend: backendAnswer.srsBackend ?? 'notion',
    srsParentPageInput: credsAndParent.srsParentPageInput,
    notionApiToken: credsAndParent.notionApiToken ?? currentAnswers.notionApiToken
  }
}

export async function promptSrsIngestion(options: PromptOptions = {}): Promise<SrsIngestionPromptsAnswers> {
  const { prefill = {}, nonInteractive = false } = options

  const enableAnswer = await promptWithPrefill<Pick<Answers, 'srsIngestEnable'>>(
    [
      {
        type: 'confirm',
        name: 'srsIngestEnable',
        message: 'Do you have existing notes or specs you would like to ingest into the SRS?',
        default: false
      }
    ],
    { prefill, nonInteractive }
  )

  if (!enableAnswer.srsIngestEnable) {
    return { srsIngestEnable: false }
  }

  const parentAnswer = await promptWithPrefill<Pick<Answers, 'srsIngestParentInput'>>(
    [
      {
        type: 'input',
        name: 'srsIngestParentInput',
        message: 'Paste the URL or ID of the Notion page that contains the existing notes to ingest (share it with your integration first):',
        validate: (input: string) => (input && input.trim().length > 0 ? true : 'Parent page URL or ID is required')
      }
    ],
    { prefill, nonInteractive }
  )

  if (!nonInteractive) {
    console.log(chalk.gray('  The ingestion workflow will run next time you open this project in Claude Code — the sf-srs skill will guide you through it.'))
  }

  return {
    srsIngestEnable: true,
    srsIngestParentInput: parentAnswer.srsIngestParentInput
  }
}
