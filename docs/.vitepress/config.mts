import { defineConfig } from 'vitepress'
import { discoverLocaleRoutes, localizedRoute, routeForPage } from './config/locale-routes'
import { createThemeConfig } from './config/navigation'

const translatedRoutes = discoverLocaleRoutes('fr')
const base = process.env.SF_DOCS_BASE || '/'
const publishedRoute = (route: string): string => `${base}${route.replace(/^\//, '')}`

export default defineConfig({
  title: 'SaaSFoundryAI',
  description: 'Production-ready SaaS foundation and guarded delivery harness for human + AI teams',
  lang: 'en-US',
  // The bundled `sf docs` build and a future custom domain stay at `/`.
  // GitHub Pages sets SF_DOCS_BASE to the repository subpath until that domain exists.
  base,

  /**
   * Built outside `.vitepress/` so the output can ship in the npm package.
   *
   * `files` in package.json would have to name a path inside a dotted directory otherwise,
   * which is exactly the kind of packing edge case that fails quietly in a published
   * tarball and never locally (#626).
   */
  outDir: '../docs-dist',
  ignoreDeadLinks: [/^https?:\/\/localhost/],

  vite: {
    server: {
      port: 5176
    }
  },

  // The tab icon is a THIRD asset on purpose: at 16px the S and F on the cube faces
  // stop being letters and start being dirt, so the favicon drops them. `icon.svg`
  // keeps them for the nav bar, where there is enough room to read them. See #567.
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }]],

  transformHead({ pageData }) {
    const current = routeForPage(pageData.relativePath)
    const englishRoute = publishedRoute(localizedRoute('en', current.route))
    const frenchRoute = publishedRoute(localizedRoute('fr', current.route))
    const canonical = current.locale === 'fr' ? frenchRoute : englishRoute
    const alternate = [
      ['link', { rel: 'canonical', href: canonical }],
      ['link', { rel: 'alternate', hreflang: 'en', href: englishRoute }],
      ['link', { rel: 'alternate', hreflang: 'x-default', href: englishRoute }]
    ] as const

    return translatedRoutes.includes(current.route) ? [...alternate, ['link', { rel: 'alternate', hreflang: 'fr', href: frenchRoute }]] : [...alternate]
  },

  markdown: {
    languageAlias: {
      env: 'bash'
    }
  },
  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      title: 'SaaSFoundryAI',
      description: 'Production-ready SaaS foundation and guarded delivery harness for human + AI teams',
      themeConfig: createThemeConfig('en', translatedRoutes)
    },
    fr: {
      label: 'Français',
      lang: 'fr-FR',
      title: 'SaaSFoundryAI',
      description: 'Fondation SaaS prête pour la production et harness de livraison sécurisé pour les équipes humaines et IA',
      themeConfig: createThemeConfig('fr', translatedRoutes)
    }
  }
})
