export type LocaleParityMode = 'staged' | 'strict'

/**
 * Ticket #793 completed route parity. New public English or French pages now require a peer.
 */
export const documentationLocaleParityMode: LocaleParityMode = 'strict'

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
