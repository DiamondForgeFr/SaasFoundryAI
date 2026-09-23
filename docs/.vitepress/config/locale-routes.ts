import { readdirSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const docsRoot = fileURLToPath(new URL('../..', import.meta.url))

const markdownFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name)
    return entry.isDirectory() ? markdownFiles(absolute) : extname(entry.name) === '.md' ? [absolute] : []
  })

export const markdownPathToRoute = (path: string): string => {
  const withoutExtension = path.replace(/\.md$/, '')
  const withoutIndex = withoutExtension.replace(/(^|\/)index$/, '$1')
  const normalized = `/${withoutIndex}`.replace(/\/+/g, '/').replace(/\/$/, '')
  return normalized || '/'
}

export const discoverLocaleRoutes = (locale: string): string[] => {
  const localeRoot = resolve(docsRoot, locale)
  return markdownFiles(localeRoot)
    .map((file) => markdownPathToRoute(relative(localeRoot, file).split(sep).join('/')))
    .sort()
}

export const routeForPage = (relativePath: string): { locale: 'en' | 'fr'; route: string } => {
  const locale = relativePath.startsWith('fr/') ? 'fr' : 'en'
  const localPath = locale === 'fr' ? relativePath.slice('fr/'.length) : relativePath
  return { locale, route: markdownPathToRoute(localPath) }
}

export const localizedRoute = (locale: 'en' | 'fr', route: string): string => {
  if (locale === 'en') return route
  return route === '/' ? '/fr/' : `/fr${route}`
}
