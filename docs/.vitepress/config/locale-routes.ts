import { readdirSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'
import { markdownPathToRoute, type DocumentationLocale } from './locale-paths'

export { documentationLink, localizedRoute, markdownPathToRoute, routeForPage, routeWithoutLocale } from './locale-paths'

const docsRoot = resolve(process.cwd(), 'docs')

const markdownFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name)
    return entry.isDirectory() ? markdownFiles(absolute) : extname(entry.name) === '.md' ? [absolute] : []
  })

export const discoverLocaleRoutes = (locale: DocumentationLocale): string[] => {
  const localeRoot = locale === 'en' ? docsRoot : resolve(docsRoot, locale)
  return markdownFiles(localeRoot)
    .filter((file) => locale !== 'en' || relative(localeRoot, file).split(sep)[0] !== 'fr')
    .map((file) => markdownPathToRoute(relative(localeRoot, file).split(sep).join('/')))
    .sort()
}
