import { defineConfig } from 'vitepress'
import { createThemeConfig } from './config/navigation'

export default defineConfig({
  title: 'SaaSFoundryAI',
  description: 'Production-ready SaaS foundation and guarded delivery harness for human + AI teams',
  lang: 'en-US',
  /**
   * Served from the root, not from a repository subpath.
   *
   * This said `/SaaSFoundryAI/` while the repository is `SaasFoundryAI` — a casing mismatch
   * nobody could have caught, because the site has never been deployed. Rather than fix the
   * casing and keep a subpath, `/` is the value that serves both things this documentation
   * is actually for: the copy bundled in the npm package, served from the root of a local
   * static server (#626), and a custom domain later. A `github.io/<repo>/` project site is
   * the only shape that would need the subpath back, and it is not the plan (#624).
   */
  base: '/',

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
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]],

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
      themeConfig: createThemeConfig('en')
    },
    fr: {
      label: 'Français',
      lang: 'fr-FR',
      title: 'SaaSFoundryAI',
      description: 'Fondation SaaS prête pour la production et harness de livraison sécurisé pour les équipes humaines et IA',
      themeConfig: createThemeConfig('fr')
    }
  }
})
