import { readdirSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'
import { markdownPathToRoute, type DocumentationLocale } from './locale-paths'

export { documentationLink, localizedRoute, markdownPathToRoute, routeForPage, routeWithoutLocale } from './locale-paths'

const docsRoot = resolve(process.cwd(), 'docs')

/**
 * English-only maintainer pages kept out of the published site. `engineering/` holds what
 * MoltenTerm generates from `.molten/project.json` (#1115): it rewrites those pages on each
 * pipeline update, so they can neither be translated nor follow the site's locale parity.
 */
export const unpublishedDirectories = ['engineering']
export const unpublishedPatterns = unpublishedDirectories.map((directory) => `${directory}/**`)

const markdownFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name)
    return entry.isDirectory() ? markdownFiles(absolute) : extname(entry.name) === '.md' ? [absolute] : []
  })

export const discoverLocaleRoutes = (locale: DocumentationLocale): string[] => {
  const localeRoot = locale === 'en' ? docsRoot : resolve(docsRoot, locale)
  return markdownFiles(localeRoot)
    .filter((file) => {
      const topDirectory = relative(localeRoot, file).split(sep)[0]
      return !unpublishedDirectories.includes(topDirectory) && (locale !== 'en' || topDirectory !== 'fr')
    })
    .map((file) => markdownPathToRoute(relative(localeRoot, file).split(sep).join('/')))
    .sort()
}
