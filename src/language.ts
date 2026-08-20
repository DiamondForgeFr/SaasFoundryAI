import type { LanguageConfig, LanguageTag, SaaSFoundryManifest } from './types'

/**
 * Every artefact the AI produces ships in English unless the project says
 * otherwise. The language of the conversation is not a signal: a session held
 * in French must still yield English SRS pages, tickets and code comments.
 */
export const DEFAULT_OUTPUT_LANGUAGE: LanguageTag = 'en'

/** The three surfaces, in the order they are presented to users and agents. */
export const OUTPUT_LANGUAGE_SURFACES = ['srs', 'tickets', 'codeComments'] as const

export type OutputLanguageSurface = (typeof OUTPUT_LANGUAGE_SURFACES)[number]

/** Same shape as `LanguageConfig`, with every surface resolved to a concrete tag. */
export type ResolvedOutputLanguages = Record<OutputLanguageSurface, LanguageTag>

/** Human-readable label for the tags we offer in prompts. Unknown tags render as-is. */
const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
  de: 'Deutsch',
  it: 'Italiano',
  pt: 'Português',
  nl: 'Nederlands'
}

/**
 * Label a tag for display. Falls back to the tag itself so a project pinning
 * `pt-BR` or `zh-Hans` reads sensibly without us shipping a locale database.
 */
export function languageLabel(tag: LanguageTag): string {
  const normalized = tag.trim().toLowerCase()
  return LANGUAGE_LABELS[normalized] ?? tag.trim()
}

function normalize(tag: LanguageTag | undefined): LanguageTag {
  const trimmed = tag?.trim()
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : DEFAULT_OUTPUT_LANGUAGE
}

/**
 * Resolve the output language of each surface from the manifest.
 *
 * The block is optional and so is every key inside it, because it was added
 * after projects were already in the wild — a manifest that predates it, or one
 * a user trimmed by hand, resolves to English rather than being rejected. That
 * is also why this needs no manifest migration: an absent block and an explicit
 * `en` block mean exactly the same thing.
 */
export function resolveOutputLanguages(manifest: Pick<SaaSFoundryManifest, 'language'> | null | undefined): ResolvedOutputLanguages {
  const configured: LanguageConfig | undefined = manifest?.language
  return {
    srs: normalize(configured?.srs),
    tickets: normalize(configured?.tickets),
    codeComments: normalize(configured?.codeComments)
  }
}

/**
 * True when every surface is English — the default. Callers use this to stay
 * quiet in the common case instead of restating the obvious on every run.
 */
export function isAllDefaultLanguages(languages: ResolvedOutputLanguages): boolean {
  return OUTPUT_LANGUAGE_SURFACES.every((surface) => languages[surface] === DEFAULT_OUTPUT_LANGUAGE)
}
