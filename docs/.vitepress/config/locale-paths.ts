export type DocumentationLocale = 'en' | 'fr'

export const markdownPathToRoute = (path: string): string => {
  const withoutExtension = path.replace(/\.md$/, '')
  const withoutIndex = withoutExtension.replace(/(^|\/)index$/, '$1')
  const normalized = `/${withoutIndex}`.replace(/\/+/g, '/').replace(/\/$/, '')
  return normalized || '/'
}

export const routeForPage = (relativePath: string): { locale: DocumentationLocale; route: string } => {
  const locale = relativePath.startsWith('fr/') ? 'fr' : 'en'
  const localPath = locale === 'fr' ? relativePath.slice('fr/'.length) : relativePath
  return { locale, route: markdownPathToRoute(localPath) }
}

export const localizedRoute = (locale: DocumentationLocale, route: string): string => {
  if (locale === 'en') return route
  return route === '/' ? '/fr/' : `/fr${route}`
}

export const documentationLink = (locale: DocumentationLocale, route: string, translatedRoutes: readonly string[]): string =>
  locale === 'fr' && translatedRoutes.includes(route) ? localizedRoute('fr', route) : localizedRoute('en', route)

export const routeWithoutLocale = (route: string): string => {
  if (route === '/fr' || route === '/fr/') return '/'
  return route.startsWith('/fr/') ? route.slice('/fr'.length) : route
}
