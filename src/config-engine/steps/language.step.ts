import { DEFAULT_OUTPUT_LANGUAGE, OFFERED_OUTPUT_LANGUAGES, OUTPUT_LANGUAGE_OTHER, languageLabel } from '../../language'
import { StepDefinition } from '../types'

/**
 * Language of what the AI writes — SRS pages, tickets, code comments.
 *
 * Asked once and applied to all three surfaces, because wanting them to differ
 * is the rare case and `sf new` is already a long session. The manifest keeps
 * the three keys separate, so a project that does want a French SRS with
 * English code comments edits `language.*` afterwards.
 *
 * Skipped on the `stack` profile, which deposits no AI harness — no skills, no
 * workflow, no SRS, so nothing to write in any language. Its manifest still gets
 * the block at English defaults, since an unanswered step resolves to English.
 */
export const languageStep: StepDefinition = {
  id: 'language',
  title: 'Output language',
  appliesTo: (state) => state.profile !== 'stack',
  fields: [
    {
      type: 'list',
      name: 'outputLanguage',
      message: 'Language the AI writes in (SRS, tickets, code comments) — not the language you chat in:',
      choices: [...OFFERED_OUTPUT_LANGUAGES.map((tag) => ({ name: languageLabel(tag), value: tag })), { name: 'Other (BCP-47 tag)', value: OUTPUT_LANGUAGE_OTHER }],
      default: DEFAULT_OUTPUT_LANGUAGE
    },
    {
      type: 'input',
      name: 'outputLanguageCustom',
      message: 'BCP-47 language tag (e.g. pt-BR, zh-Hans):',
      when: (current) => current.outputLanguage === OUTPUT_LANGUAGE_OTHER,
      validate: (input: string) => (input.trim().length > 0 ? true : 'Enter a language tag, e.g. pt-BR')
    }
  ]
}
