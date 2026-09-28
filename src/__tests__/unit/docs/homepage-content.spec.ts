import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { routeWithoutLocale } from '../../../../docs/.vitepress/config/locale-paths'
import { discoverLocaleRoutes } from '../../../../docs/.vitepress/config/locale-routes'

const root = resolve(__dirname, '../../../..')
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8')
const english = read('docs/index.md')
const french = read('docs/fr/index.md')
const englishSetup = read('docs/getting-started/setup-paths.md')
const frenchSetup = read('docs/fr/getting-started/setup-paths.md')
const agentProfiles = JSON.parse(read('src/harness/agent-profiles.json')) as { profiles: Record<string, { displayName: string }> }
const agentProfileNames = Object.values(agentProfiles.profiles).map(({ displayName }) => displayName)
const systemMap = read('docs/.vitepress/theme/components/FoundrySystemMap.vue')
const theme = read('docs/.vitepress/theme/custom.css')
const englishRoutes = discoverLocaleRoutes('en')
const frenchRoutes = discoverLocaleRoutes('fr')

const relativeLuminance = (hex: string): number => {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

const contrast = (first: string, second: string): number => {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

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
    expect(content).toContain('class="sf-workflow-choice"')
    expect(content).toContain('class="sf-complexity-grid"')
    expect(content).toContain('class="sf-agent-grid"')
    expect(content).toContain('class="sf-execution-flow"')
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
  ])('keeps the complete Team route and workflow choices at the hero fold on the %s landing', (_locale, content) => {
    expect(content.indexOf('class="sf-status-flow"')).toBeLessThan(content.indexOf('class="sf-pillar-grid"'))
    expect(content.indexOf('class="sf-workflow-choice"')).toBeLessThan(content.indexOf('class="sf-pillar-grid"'))
    expect(content.match(/class="sf-human-gate"/g)).toHaveLength(3)
    expect(content).toMatch(/Team|Équipe/)
    expect(content).toContain('Solo')
    expect(content).toMatch(/Custom|Personnalisé/)
    expect(content).toMatch(/feature testing|test fonctionnel/)
    expect(content).toMatch(/code review|revue de code/)
  })

  it('shows the two product rails and their shared contract in the hero', () => {
    expect(systemMap).toContain('SaaS foundation')
    expect(systemMap).toContain('Development harness')
    expect(systemMap).toContain('Fondation SaaS')
    expect(systemMap).toContain('Harness de développement')
    expect(systemMap).toContain('.saasfoundry.json')
    expect(systemMap.indexOf('sf-map-rail--harness')).toBeLessThan(systemMap.indexOf('sf-map-rail--foundation'))
  })

  it.each([
    ['English', english, 'Robust engineering, from day one.', 'any SaaS codebase', 'independently', 'href="/features/built-in"'],
    ['French', french, "L'ingénierie robuste, dès le premier jour.", 'tout projet SaaS', 'séparément', 'href="/fr/features/built-in"']
  ])('positions the harness first and both products as independent in %s', (_locale, content, headline, anyProject, independence, foundationLink) => {
    expect(content).toContain(headline)
    expect(content.toLowerCase()).toContain(anyProject.toLowerCase())
    expect(content).toContain(independence)
    expect(content.indexOf('sf-pillar--harness')).toBeLessThan(content.indexOf(foundationLink))
    expect(content).not.toMatch(/Ship the product\. Not the boilerplate|Livrez le produit\. Pas le boilerplate|should never have been separated|n'auraient jamais dû être séparés/)
  })

  it.each([
    ['English', english, englishSetup],
    ['French', french, frenchSetup]
  ])('makes multi-agent support and adaptive execution explicit in %s', (_locale, landing, setup) => {
    for (const profile of ['Claude Code', 'Codex', 'Gemini CLI', 'Kimi Code', 'Qwen Code']) {
      expect(landing).toContain(profile)
      expect(setup).toContain(profile)
    }

    expect(landing).toMatch(/provider-neutral|indépendants? des fournisseurs/i)
    expect(landing).toMatch(/reasoning[- ]effort|effort\s+de\s+raisonnement/)
    expect(landing).toMatch(/host integration|hôte ou une intégration/)
    expect(setup).toMatch(/provider \+ runtime \+ model \+ reasoning-effort|fournisseur \+ runtime \+ modèle \+ effort de raisonnement/)
    expect(setup).toMatch(/primary agent|agent principal/)
    expect(setup).toMatch(/independent validation|validation indépendante/)
    expect(landing).toMatch(/not automatically wired together|ne sont pas reliées automatiquement/)
    expect(setup).toMatch(/does not include an automatic bridge|ne relie pas automatiquement/)
  })

  it('derives the English agent-profile claim from the canonical registry', () => {
    expect(agentProfileNames).toHaveLength(6)
    for (const displayName of agentProfileNames) {
      expect(english).toContain(displayName)
      expect(englishSetup).toContain(displayName)
    }
    expect(french).toContain('Agent de code générique')
  })

  it('keeps the foundry map accessible when motion is reduced', () => {
    expect(systemMap).toContain('<figure')
    expect(systemMap).toContain('<figcaption>')
    expect(theme).toContain('@media (prefers-reduced-motion: reduce)')
    expect(theme).toMatch(/\.sf-system-map::after,[\s\S]+animation: none/)
  })

  it('uses the compact documentation radius requested for rectangular surfaces', () => {
    expect(theme).toContain('--sf-radius: 3px')
    expect(theme).toMatch(/\.sf-system-map[\s\S]+border-radius: var\(--sf-radius\)/)
    expect(theme).toMatch(/\.sf-workflow-choice > div[\s\S]+border-radius: var\(--sf-radius\)/)
  })

  it('keeps the light-theme brand color readable for links, focus rings and buttons', () => {
    const brand = theme.match(/--vp-c-brand-1:\s*(#[0-9a-f]{6})/i)?.[1]
    const button = theme.match(/--vp-button-brand-bg:\s*(#[0-9a-f]{6})/i)?.[1]
    expect(brand).toBeDefined()
    expect(button).toBeDefined()
    expect(contrast(brand!, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrast(button!, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
})
