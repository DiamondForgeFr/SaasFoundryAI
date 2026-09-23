export type LocaleParityMode = 'staged' | 'strict'

/**
 * Keep this in staged mode while the v1 documentation epic is translating page families.
 * Ticket #793 switches it to strict only after every public English route has a French peer.
 */
export const documentationLocaleParityMode: LocaleParityMode = 'staged'

export type LocaleParity = {
  missingTranslations: string[]
  orphanedTranslations: string[]
  valid: boolean
}

export const evaluateLocaleParity = (englishRoutes: readonly string[], frenchRoutes: readonly string[], mode: LocaleParityMode): LocaleParity => {
  const english = new Set(englishRoutes)
  const french = new Set(frenchRoutes)
  const missingTranslations = [...english].filter((route) => !french.has(route)).sort()
  const orphanedTranslations = [...french].filter((route) => !english.has(route)).sort()

  return {
    missingTranslations,
    orphanedTranslations,
    valid: orphanedTranslations.length === 0 && (mode === 'staged' || missingTranslations.length === 0)
  }
}
