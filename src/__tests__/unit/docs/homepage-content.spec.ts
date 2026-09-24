import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { routeWithoutLocale } from '../../../../docs/.vitepress/config/locale-paths'
import { discoverLocaleRoutes } from '../../../../docs/.vitepress/config/locale-routes'

const root = resolve(__dirname, '../../../..')
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8')
const english = read('docs/index.md')
const french = read('docs/fr/index.md')
const systemMap = read('docs/.vitepress/theme/components/FoundrySystemMap.vue')
const theme = read('docs/.vitepress/theme/custom.css')
const englishRoutes = discoverLocaleRoutes('en')
const frenchRoutes = discoverLocaleRoutes('fr')

const localLinks = (content: string): string[] => [...content.matchAll(/(?:href=["']|link:\s*)(\/(?!\/)[^"'\s<]+)/g)].map((match) => match[1]).filter(Boolean)
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

const sourceForRoute = (locale: 'en' | 'fr', route: string): string => {
  const localRoute = routeWithoutLocale(route)
  const relativeRoute = localRoute === '/' ? 'index' : localRoute.slice(1)
  return resolve(root, 'docs', locale === 'fr' ? 'fr' : '', `${relativeRoute}.md`)
}

const missingLinkTargets = (locale: 'en' | 'fr', content: string): string[] => {
  const routes = locale === 'fr' ? frenchRoutes : englishRoutes

  return localLinks(content).filter((link) => {
    const [route, fragment] = link.split('#', 2)
    const localRoute = routeWithoutLocale(route)
    if (!routes.includes(localRoute)) return true
    if (!fragment) return false

    const source = sourceForRoute(locale, route)
    if (!existsSync(source)) return true
    const slugs = [...readFileSync(source, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => vitepressSlug(match[1]))
    return !slugs.includes(decodeURIComponent(fragment))
  })
}

describe('the bilingual product landing (#395)', () => {
  it.each([
    ['English', english],
    ['French', french]
  ])('keeps the %s landing focused and structurally complete', (_locale, content) => {
    expect(content.split('\n').length).toBeLessThanOrEqual(250)
    expect(content).toContain('class="sf-pillar-grid"')
    expect(content).toContain('class="sf-capability-grid"')
    expect(content).toContain('class="sf-path-grid"')
    expect(content).toContain('class="sf-status-flow"')
    expect(content).toContain('class="sf-complexity-grid"')
    expect(content).toContain('class="sf-evidence-grid"')
    expect(content).toContain('class="sf-final-cta"')
  })

  it.each([
    ['English', 'en', english],
    ['French', 'fr', french]
  ] as const)('keeps every local link on the %s landing in-locale with a real page and anchor', (_label, locale, content) => {
    const links = localLinks(content)
    if (locale === 'fr') expect(links.every((link) => link.startsWith('/fr/'))).toBe(true)
    else expect(links.every((link) => !link.startsWith('/fr/'))).toBe(true)

    expect([...new Set(missingLinkTargets(locale, content))].sort()).toEqual([])
  })

  it.each([
    ['English', english],
    ['French', french]
  ])('keeps the seven-stage workflow at the hero fold on the %s landing', (_locale, content) => {
    expect(content.indexOf('class="sf-status-flow"')).toBeLessThan(content.indexOf('class="sf-pillar-grid"'))
    expect(content.match(/class="sf-human-gate"/g)).toHaveLength(3)
  })

  it('shows the two product rails and their shared contract in the hero', () => {
    expect(systemMap).toContain('SaaS foundation')
    expect(systemMap).toContain('Development harness')
    expect(systemMap).toContain('Fondation SaaS')
    expect(systemMap).toContain('Harness de développement')
    expect(systemMap).toContain('.saasfoundry.json')
  })

  it('keeps the foundry map accessible when motion is reduced', () => {
    expect(systemMap).toContain('<figure')
    expect(systemMap).toContain('<figcaption>')
    expect(theme).toContain('@media (prefers-reduced-motion: reduce)')
    expect(theme).toMatch(/\.sf-system-map::after,[\s\S]+animation: none/)
  })
})
