import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DefaultTheme } from 'vitepress'
import { documentationLink, localizedRoute, markdownPathToRoute, routeForPage, routeWithoutLocale } from '../../../../docs/.vitepress/config/locale-paths'
import { discoverLocaleRoutes } from '../../../../docs/.vitepress/config/locale-routes'
import { createThemeConfig } from '../../../../docs/.vitepress/config/navigation'
import { documentationLocaleParityMode, evaluateLocaleParity, type LocaleParityMode } from '../../../../docs/.vitepress/config/translation-policy'

const englishRoutes = discoverLocaleRoutes('en')
const frenchRoutes = discoverLocaleRoutes('fr')
const repositoryRoot = resolve(__dirname, '../../../..')

const collectSidebarLinks = (items: DefaultTheme.SidebarItem[]): string[] =>
  items.flatMap((item) => [item.link, ...(item.items ? collectSidebarLinks(item.items) : [])]).filter((link): link is string => Boolean(link))

type NavEntry = {
  link?: string
  items?: NavEntry[]
}

const collectNavLinks = (items: NavEntry[]): string[] => items.flatMap((item) => [item.link, ...(item.items ? collectNavLinks(item.items) : [])]).filter((link): link is string => Boolean(link))

const configuredLinks = (locale: 'en' | 'fr'): string[] => {
  const config = createThemeConfig(locale, frenchRoutes)
  const navLinks = collectNavLinks((config.nav ?? []) as NavEntry[])
  const sidebar = config.sidebar as DefaultTheme.SidebarMulti
  const sidebarLinks = Object.values(sidebar).flatMap((section) => collectSidebarLinks(Array.isArray(section) ? section : section.items))

  return [...new Set([...navLinks, ...sidebarLinks])].sort()
}

const localRoute = (link: string): string | undefined => {
  if (!link.startsWith('/') || link.startsWith('//')) return undefined
  return routeWithoutLocale(link.split(/[?#]/, 1)[0])
}

const frenchSource = (route: string): string => resolve(repositoryRoot, 'docs/fr', route === '/' ? 'index.md' : `${route.slice(1)}.md`)
const localeSource = (locale: 'en' | 'fr', route: string): string => resolve(repositoryRoot, 'docs', locale === 'fr' ? 'fr' : '', route === '/' ? 'index.md' : `${route.slice(1)}.md`)

const vitepressSlug = (heading: string): string =>
  heading
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase()

const brokenInternalLinks = (locale: 'en' | 'fr'): string[] => {
  const routes = locale === 'fr' ? frenchRoutes : englishRoutes

  return routes.flatMap((sourceRoute) => {
    const source = localeSource(locale, sourceRoute)
    const content = readFileSync(source, 'utf8')
    const links = [...content.matchAll(/(?:\]\(|href=["']|link:\s*)(\/[^\s)"']+)/g)].map((match) => match[1])

    return links.flatMap((link) => {
      const [pathWithQuery, encodedFragment] = link.split('#', 2)
      const route = routeWithoutLocale(pathWithQuery.split('?', 1)[0])
      if (!routes.includes(route)) return [`${sourceRoute} -> ${link} (missing route)`]
      if (!encodedFragment) return []

      const target = localeSource(locale, route)
      if (!existsSync(target)) return [`${sourceRoute} -> ${link} (missing source)`]
      const slugs = [...readFileSync(target, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => vitepressSlug(match[1]))
      const fragment = vitepressSlug(decodeURIComponent(encodedFragment))
      return slugs.includes(fragment) ? [] : [`${sourceRoute} -> ${link} (missing anchor)`]
    })
  })
}

const crossLocaleLinks = (route: string): string[] => {
  const content = readFileSync(frenchSource(route), 'utf8')
  return [...content.matchAll(/(?:\]\(|href=["']|link:\s*)(\/[^\s)"'#?]*)/g)]
    .map((match) => match[1])
    .filter((link) => link !== '/' && !link.startsWith('/fr/') && !link.startsWith('/assets/') && !link.startsWith('/favicon') && !link.startsWith('/logo'))
}

describe('documentation locale routes (#796)', () => {
  it.each([
    ['index.md', '/'],
    ['guide/index.md', '/guide'],
    ['guide/project-structure.md', '/guide/project-structure'],
    ['nested//page.md', '/nested/page']
  ])('normalizes %s to %s', (path, route) => {
    expect(markdownPathToRoute(path)).toBe(route)
  })

  it('identifies the locale and route represented by a VitePress page', () => {
    expect(routeForPage('index.md')).toEqual({ locale: 'en', route: '/' })
    expect(routeForPage('fr/index.md')).toEqual({ locale: 'fr', route: '/' })
    expect(routeForPage('fr/guide/setup.md')).toEqual({ locale: 'fr', route: '/guide/setup' })
  })

  it('builds canonical localized routes without duplicating the locale prefix', () => {
    expect(localizedRoute('en', '/guide/setup')).toBe('/guide/setup')
    expect(localizedRoute('fr', '/')).toBe('/fr/')
    expect(localizedRoute('fr', '/guide/setup')).toBe('/fr/guide/setup')
  })

  it('falls back to English until an equivalent French route exists', () => {
    expect(documentationLink('fr', '/', ['/'])).toBe('/fr/')
    expect(documentationLink('fr', '/guide/setup', ['/'])).toBe('/guide/setup')
    expect(documentationLink('fr', '/guide/setup', ['/', '/guide/setup'])).toBe('/fr/guide/setup')
  })

  it('inventories both public locale trees', () => {
    expect(englishRoutes).toContain('/')
    expect(englishRoutes).toContain('/guide/project-structure')
    expect(englishRoutes).not.toContain('/fr')
    expect(frenchRoutes).toContain('/')
  })

  it('never permits a French page without an English source page', () => {
    expect(frenchRoutes.filter((route) => !englishRoutes.includes(route))).toEqual([])
  })
})

describe('documentation locale parity policy (#796)', () => {
  it.each<LocaleParityMode>(['staged', 'strict'])('always rejects orphaned translations in %s mode', (mode) => {
    expect(evaluateLocaleParity(['/'], ['/', '/orphan'], mode)).toEqual({
      missingTranslations: [],
      orphanedTranslations: ['/orphan'],
      valid: false
    })
  })

  it('allows known missing translations only while delivery is staged', () => {
    expect(evaluateLocaleParity(['/', '/guide'], ['/'], 'staged').valid).toBe(true)
    expect(evaluateLocaleParity(['/', '/guide'], ['/'], 'strict').valid).toBe(false)
  })

  it(`keeps the repository valid in ${documentationLocaleParityMode} mode`, () => {
    const parity = evaluateLocaleParity(englishRoutes, frenchRoutes, documentationLocaleParityMode)
    expect(parity.orphanedTranslations).toEqual([])
    expect(parity.valid).toBe(true)

    if (documentationLocaleParityMode === 'strict') {
      expect(parity.missingTranslations).toEqual([])
    } else {
      expect(parity.missingTranslations.length).toBeGreaterThan(0)
    }
  })
})

describe('documentation navigation integrity (#796)', () => {
  it.each(['en', 'fr'] as const)('points %s navigation only at existing pages', (locale) => {
    const missing = configuredLinks(locale)
      .map(localRoute)
      .filter((route): route is string => route !== undefined)
      .filter((route) => !englishRoutes.includes(route))

    expect([...new Set(missing)].sort()).toEqual([])
  })

  it('keeps English and French navigation structurally aligned', () => {
    const englishLinks = configuredLinks('en')
      .map((link) => routeWithoutLocale(link))
      .sort()
    const configuredFrenchLinks = configuredLinks('fr')
    expect(configuredFrenchLinks.every((link) => link.startsWith('/fr/'))).toBe(true)

    const frenchLinks = configuredFrenchLinks.map((link) => routeWithoutLocale(link)).sort()
    expect(frenchLinks).toEqual(englishLinks)
  })

  it('keeps every internal link in the complete French tree inside the French locale', () => {
    const offenders = frenchRoutes.flatMap((route) => crossLocaleLinks(route).map((link) => `${route} -> ${link}`))
    expect(offenders).toEqual([])
  })

  it.each(['en', 'fr'] as const)('keeps every %s internal route and heading anchor valid', (locale) => {
    expect(brokenInternalLinks(locale)).toEqual([])
  })
})
