/**
 * Resources & configs
 */
import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import ResourcesToBackend from 'i18next-resources-to-backend'
import yaml from 'js-yaml'
import { initReactI18next } from 'react-i18next'

/**
 * Methods
 */
const loadYaml = (lng: string, ns: string) => {
  const key = `/src/locales/${lng}/${ns}.yml`
  const modules: Record<string, string> = import.meta.glob('/src/locales/**/*.yml', {
    eager: true,
    query: '?raw',
    import: 'default'
  })

  if (modules[key]) return yaml.load(modules[key])
  else throw new Error(`Namespace ${ns} not found for language ${lng}`)
}

/**
 * Declaration
 */
i18n
  .use(ResourcesToBackend((lng: string, ns: string) => loadYaml(lng, ns)))
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'fr'],
    nonExplicitSupportedLngs: true,
    debug: false,
    interpolation: { escapeValue: false },
    // Eager-loaded namespaces only — those rendered on the layout shell or every route
    // (sidebar/topbar via `nav`, breadcrumbs/buttons via `common`, the global error boundary via `page-errors`).
    // Feature namespaces (auth, account, dashboard, profile, …) are lazy-loaded by `i18next-resources-to-backend`
    // the first time `useTranslation('<ns>')` is called — keeps the initial bundle minimal.
    ns: ['common', 'nav', 'page-errors'],
    defaultNS: 'common',
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'i18nextLng',
      caches: ['localStorage']
    }
  })

export default i18n
