import { languageStep } from '../../../config-engine/steps/language.step'
import { ensureLanguageBlock, languageConfigFromAnswers, OUTPUT_LANGUAGE_OTHER } from '../../../language'
import type { ConfigState, SessionContext } from '../../../config-engine/types'
import type { LanguageConfig } from '../../../types'

const sessionCtx: SessionContext = { prefill: {}, nonInteractive: false, derived: {} }

function field(name: string) {
  const found = languageStep.fields?.find((f) => f.name === name)
  if (!found) throw new Error(`languageStep has no field "${name}"`)
  return found
}

describe('languageStep', () => {
  it('defaults to English — the conversation language is never the signal', () => {
    expect(field('outputLanguage').default).toBe('en')
  })

  it('offers English first so the default is the obvious pick', () => {
    expect(field('outputLanguage').choices?.[0]).toEqual({ name: 'English', value: 'en' })
  })

  it('ends the list with a free-text escape hatch, so the choices are not a ceiling', () => {
    expect(field('outputLanguage').choices?.at(-1)?.value).toBe(OUTPUT_LANGUAGE_OTHER)
  })

  it('reveals the tag input only when "Other" was picked', () => {
    const when = field('outputLanguageCustom').when
    expect(when?.({ outputLanguage: OUTPUT_LANGUAGE_OTHER } as ConfigState)).toBe(true)
    expect(when?.({ outputLanguage: 'fr' } as ConfigState)).toBe(false)
  })

  it('refuses an empty custom tag', () => {
    const validate = field('outputLanguageCustom').validate
    expect(validate?.('  ')).not.toBe(true)
    expect(validate?.('pt-BR')).toBe(true)
  })

  // The stack profile deposits no skills, no workflow and no SRS, so there is
  // nothing for the setting to govern — asking would be pure noise.
  it('is skipped on the stack profile and asked on the others', () => {
    expect(languageStep.appliesTo?.({ profile: 'stack' } as ConfigState, sessionCtx)).toBe(false)
    expect(languageStep.appliesTo?.({ profile: 'full' } as ConfigState, sessionCtx)).toBe(true)
    expect(languageStep.appliesTo?.({ profile: 'harness' } as ConfigState, sessionCtx)).toBe(true)
  })
})

describe('languageConfigFromAnswers', () => {
  it('applies the single answer to all three surfaces', () => {
    expect(languageConfigFromAnswers({ outputLanguage: 'fr' })).toEqual({ srs: 'fr', tickets: 'fr', codeComments: 'fr' })
  })

  it('writes the block even at English defaults — a knob nobody sees is a knob nobody uses', () => {
    expect(languageConfigFromAnswers({})).toEqual({ srs: 'en', tickets: 'en', codeComments: 'en' })
  })

  it('takes the free-text tag when "Other" was picked', () => {
    expect(languageConfigFromAnswers({ outputLanguage: OUTPUT_LANGUAGE_OTHER, outputLanguageCustom: 'pt-BR' }).srs).toBe('pt-BR')
  })

  it('never persists the "other" sentinel, falling back to English if the tag went missing', () => {
    expect(languageConfigFromAnswers({ outputLanguage: OUTPUT_LANGUAGE_OTHER })).toEqual({ srs: 'en', tickets: 'en', codeComments: 'en' })
  })

  // The stack profile never answers the step; its manifest must still carry the block.
  it('yields English defaults for a profile that skipped the step', () => {
    expect(languageConfigFromAnswers({ outputLanguage: undefined })).toEqual({ srs: 'en', tickets: 'en', codeComments: 'en' })
  })
})

describe('ensureLanguageBlock', () => {
  it('materialises the block on a manifest that predates it', () => {
    const manifest: { language?: LanguageConfig } = {}
    ensureLanguageBlock(manifest)
    expect(manifest.language).toEqual({ srs: 'en', tickets: 'en', codeComments: 'en' })
  })

  it('never overwrites a surface the project opted out of', () => {
    const manifest: { language?: LanguageConfig } = { language: { srs: 'fr' } }
    ensureLanguageBlock(manifest)
    expect(manifest.language).toEqual({ srs: 'fr', tickets: 'en', codeComments: 'en' })
  })

  it('is idempotent — a second sf update changes nothing', () => {
    const manifest: { language?: LanguageConfig } = { language: { tickets: 'fr' } }
    ensureLanguageBlock(manifest)
    const afterFirst = { ...manifest.language }
    ensureLanguageBlock(manifest)
    expect(manifest.language).toEqual(afterFirst)
  })
})
