import { DEFAULT_OUTPUT_LANGUAGE, isAllDefaultLanguages, languageLabel, resolveOutputLanguages } from '../../language'

// The rule this file guards: what the AI produces follows the manifest, never
// the language of the conversation. Everything resolves to English unless the
// project opts a surface out, and an absent block is indistinguishable from one
// that pins "en" — which is what lets this ship without a manifest migration.

describe('resolveOutputLanguages', () => {
  it('resolves every surface to English when the manifest carries no language block', () => {
    expect(resolveOutputLanguages({})).toEqual({ srs: 'en', tickets: 'en', codeComments: 'en' })
  })

  it('treats a null or undefined manifest as English everywhere', () => {
    expect(resolveOutputLanguages(null)).toEqual({ srs: 'en', tickets: 'en', codeComments: 'en' })
    expect(resolveOutputLanguages(undefined)).toEqual({ srs: 'en', tickets: 'en', codeComments: 'en' })
  })

  it('resolves an absent block identically to one pinning "en" — the reason no migration is needed', () => {
    expect(resolveOutputLanguages({})).toEqual(resolveOutputLanguages({ language: { srs: 'en', tickets: 'en', codeComments: 'en' } }))
  })

  it('honours a surface the project opted out of, leaving the others English', () => {
    expect(resolveOutputLanguages({ language: { srs: 'fr' } })).toEqual({ srs: 'fr', tickets: 'en', codeComments: 'en' })
  })

  it('lets the three surfaces disagree', () => {
    expect(resolveOutputLanguages({ language: { srs: 'fr', tickets: 'fr', codeComments: 'en' } })).toEqual({ srs: 'fr', tickets: 'fr', codeComments: 'en' })
  })

  it('falls back to English on a blank or whitespace-only tag rather than emitting an empty language', () => {
    expect(resolveOutputLanguages({ language: { srs: '', tickets: '   ' } })).toEqual({ srs: 'en', tickets: 'en', codeComments: 'en' })
  })

  it('trims a padded tag instead of carrying the whitespace downstream', () => {
    expect(resolveOutputLanguages({ language: { srs: '  fr  ' } }).srs).toBe('fr')
  })

  it('passes a regional tag through untouched', () => {
    expect(resolveOutputLanguages({ language: { srs: 'pt-BR' } }).srs).toBe('pt-BR')
  })
})

describe('isAllDefaultLanguages', () => {
  it('is true when nothing was configured', () => {
    expect(isAllDefaultLanguages(resolveOutputLanguages({}))).toBe(true)
  })

  it('is false as soon as one surface is opted out', () => {
    expect(isAllDefaultLanguages(resolveOutputLanguages({ language: { tickets: 'fr' } }))).toBe(false)
  })
})

describe('languageLabel', () => {
  it('labels the tags offered in prompts', () => {
    expect(languageLabel('en')).toBe('English')
    expect(languageLabel('fr')).toBe('Français')
  })

  it('matches case-insensitively', () => {
    expect(languageLabel('FR')).toBe('Français')
  })

  it('renders an unknown tag as itself rather than shipping a locale database', () => {
    expect(languageLabel('pt-BR')).toBe('pt-BR')
  })
})

describe('DEFAULT_OUTPUT_LANGUAGE', () => {
  it('is English — the conversation language is never the signal', () => {
    expect(DEFAULT_OUTPUT_LANGUAGE).toBe('en')
  })
})
