import type { DefaultTheme } from 'vitepress'
import { documentationLink, type DocumentationLocale } from './locale-paths'

export type { DocumentationLocale } from './locale-paths'

type Labels = {
  nav: {
    guide: string
    cli: string
    skills: string
    modules: string
    srs: string
    changelog: string
    contributing: string
  }
  groups: {
    gettingStarted: string
    cli: string
    guide: string
    skills: string
    features: string
    modules: string
    srs: string
    workflow: string
    api: string
  }
  pages: Record<string, string>
  interface: {
    outline: string
    previous: string
    next: string
    appearance: string
    lightMode: string
    darkMode: string
    menu: string
    returnToTop: string
    changeLanguage: string
    skipToContent: string
    search: string
    searchEmpty: string
    searchReset: string
    searchBack: string
    footerMessage: string
  }
}

const labels: Record<DocumentationLocale, Labels> = {
  en: {
    nav: {
      guide: 'Guide',
      cli: 'CLI',
      skills: 'Skills',
      modules: 'Modules',
      srs: 'SRS',
      changelog: 'Changelog',
      contributing: 'Contributing'
    },
    groups: {
      gettingStarted: 'Getting Started',
      cli: 'CLI Commands',
      guide: 'Guide',
      skills: 'Skills',
      features: 'SaaS foundation',
      modules: 'Modules',
      srs: 'SRS',
      workflow: 'Workflow System',
      api: 'API Reference'
    },
    pages: {
      installation: 'Installation',
      developmentTools: 'Development Tools',
      quickStart: 'Quick Start',
      firstProject: 'First Project',
      firstTicket: 'Shipping Your First Ticket',
      projectStructure: 'Project Structure',
      topology: 'Monorepo vs Multirepo',
      agentCoexistence: 'Agent Coexistence',
      hostCapabilities: 'Host Capabilities',
      localProfiles: 'Local Execution Profiles',
      localSetup: 'Local Execution Setup',
      localQualification: 'Local Execution Qualification',
      localRouting: 'Adaptive Local/Cloud Routing',
      executionCandidates: 'Execution Candidates',
      executionRequirements: 'Execution Requirements',
      executionPlanning: 'Execution Planning',
      executionBudgets: 'Execution Budgets',
      executionReplanning: 'Execution Replanning',
      executionExplanations: 'Execution Explanations',
      executionCalibration: 'Execution Calibration',
      workflowSystem: 'Workflow System',
      skillsSystem: 'Skills System',
      moduleSystem: 'Module System',
      updatingProjects: 'Updating Projects',
      overview: 'Overview',
      coreSkills: 'Core Skills',
      toolSkills: 'Tool Skills',
      creatingSkills: 'Creating Skills',
      rbac: 'RBAC and tenancy',
      yourTools: 'Connect your tools',
      email: 'Email',
      storage: 'Storage',
      analytics: 'Analytics',
      pwa: 'Installable app (PWA)',
      moduleOverview: 'Module overview',
      centralization: 'One source of truth',
      lifecycle: 'Lifecycle',
      walkthrough: 'Walkthrough',
      scannerFindings: 'Scanner findings',
      introduction: 'Introduction',
      sevenStatuses: '7-Status System',
      complexity: 'Complexity System',
      aiRules: 'AI Rules',
      github: 'GitHub Integration',
      types: 'Types',
      builders: 'Builders',
      installers: 'Installers',
      runners: 'Runners'
    },
    interface: {
      outline: 'On this page',
      previous: 'Previous page',
      next: 'Next page',
      appearance: 'Appearance',
      lightMode: 'Switch to light theme',
      darkMode: 'Switch to dark theme',
      menu: 'Menu',
      returnToTop: 'Return to top',
      changeLanguage: 'Change language',
      skipToContent: 'Skip to content',
      search: 'Search',
      searchEmpty: 'No results found',
      searchReset: 'Reset search',
      searchBack: 'Close search',
      footerMessage: 'Released under the MIT License.'
    }
  },
  fr: {
    nav: {
      guide: 'Guide',
      cli: 'CLI',
      skills: 'Skills',
      modules: 'Modules',
      srs: 'SRS',
      changelog: 'Journal des versions',
      contributing: 'Contribuer'
    },
    groups: {
      gettingStarted: 'Bien démarrer',
      cli: 'Commandes CLI',
      guide: 'Guide',
      skills: 'Skills',
      features: 'Fondation SaaS',
      modules: 'Modules',
      srs: 'SRS',
      workflow: 'Workflow de livraison',
      api: 'Référence API'
    },
    pages: {
      installation: 'Installation',
      developmentTools: 'Outils de développement',
      quickStart: 'Démarrage rapide',
      firstProject: 'Premier projet',
      firstTicket: 'Livrer votre premier ticket',
      projectStructure: 'Structure du projet',
      topology: 'Monorepo ou multirepo',
      agentCoexistence: 'Coexistence des agents',
      hostCapabilities: "Capacités de l'hôte",
      localProfiles: "Profils d'exécution locale",
      localSetup: "Installation de l'exécution locale",
      localQualification: "Qualification de l'exécution locale",
      localRouting: 'Routage local/cloud adaptatif',
      executionCandidates: "Candidats d'exécution",
      executionRequirements: "Exigences d'exécution",
      executionPlanning: "Planification de l'exécution",
      executionBudgets: "Budgets d'exécution",
      executionReplanning: 'Replanification',
      executionExplanations: 'Explication des décisions',
      executionCalibration: 'Calibration',
      workflowSystem: 'Workflow de livraison',
      skillsSystem: 'Système de skills',
      moduleSystem: 'Système de modules',
      updatingProjects: 'Mettre un projet à jour',
      overview: "Vue d'ensemble",
      coreSkills: 'Skills principaux',
      toolSkills: 'Skills outils',
      creatingSkills: 'Créer un skill',
      rbac: 'RBAC et multi-tenant',
      yourTools: 'Connecter vos outils',
      email: 'E-mail',
      storage: 'Stockage',
      analytics: 'Analytics',
      pwa: 'Application installable (PWA)',
      moduleOverview: "Vue d'ensemble du module",
      centralization: 'Une source de vérité',
      lifecycle: 'Cycle de vie',
      walkthrough: 'Parcours guidé',
      scannerFindings: 'Résultats du scanner',
      introduction: 'Introduction',
      sevenStatuses: 'Workflow à 7 statuts',
      complexity: 'Système de complexité',
      aiRules: "Règles de l'IA",
      github: 'Intégration GitHub',
      types: 'Types',
      builders: 'Builders',
      installers: 'Installateurs',
      runners: 'Runners'
    },
    interface: {
      outline: 'Sur cette page',
      previous: 'Page précédente',
      next: 'Page suivante',
      appearance: 'Apparence',
      lightMode: 'Passer au thème clair',
      darkMode: 'Passer au thème sombre',
      menu: 'Menu',
      returnToTop: 'Retour en haut',
      changeLanguage: 'Changer de langue',
      skipToContent: 'Aller au contenu',
      search: 'Rechercher',
      searchEmpty: 'Aucun résultat trouvé',
      searchReset: 'Réinitialiser la recherche',
      searchBack: 'Fermer la recherche',
      footerMessage: 'Publié sous licence MIT.'
    }
  }
}

const prefixPath = (locale: DocumentationLocale, path: string): string => (locale === 'fr' ? `/fr${path}` : path)

const item = (locale: DocumentationLocale, text: string, link: string, translatedRoutes: readonly string[]): DefaultTheme.SidebarItem => ({
  text,
  link: documentationLink(locale, link, translatedRoutes)
})

const createSidebar = (locale: DocumentationLocale, translatedRoutes: readonly string[]): DefaultTheme.Sidebar => {
  const { groups, pages } = labels[locale]
  const group = (text: string, items: DefaultTheme.SidebarItem[]): DefaultTheme.SidebarItem[] => [{ text, items }]
  const page = (text: string, link: string): DefaultTheme.SidebarItem => item(locale, text, link, translatedRoutes)

  return {
    [prefixPath(locale, '/getting-started/')]: group(groups.gettingStarted, [
      page(pages.installation, '/getting-started/installation'),
      page(pages.developmentTools, '/getting-started/tools'),
      page(pages.quickStart, '/getting-started/quick-start'),
      page(pages.firstProject, '/getting-started/first-project'),
      page(pages.firstTicket, '/getting-started/shipping-first-ticket')
    ]),
    [prefixPath(locale, '/cli/')]: group(
      groups.cli,
      ['new', 'update', 'resume', 'status', 'agents', 'docs', 'modules', 'skill', 'srs', 'feedback', 'tools', 'workflow', 'uninstall'].map((command) => page(`sf ${command}`, `/cli/sf-${command}`))
    ),
    [prefixPath(locale, '/guide/')]: group(groups.guide, [
      page(pages.projectStructure, '/guide/project-structure'),
      page(pages.topology, '/guide/monorepo-vs-multirepo'),
      page(pages.agentCoexistence, '/guide/agent-coexistence'),
      page(pages.hostCapabilities, '/guide/host-capabilities'),
      page(pages.localProfiles, '/guide/local-execution-profiles'),
      page(pages.localSetup, '/guide/local-execution-setup'),
      page(pages.localQualification, '/guide/local-execution-qualification'),
      page(pages.localRouting, '/guide/local-cloud-routing'),
      page(pages.executionCandidates, '/guide/execution-candidates'),
      page(pages.executionRequirements, '/guide/execution-requirements'),
      page(pages.executionPlanning, '/guide/execution-planning'),
      page(pages.executionBudgets, '/guide/execution-budgets'),
      page(pages.executionReplanning, '/guide/execution-replanning'),
      page(pages.executionExplanations, '/guide/execution-explanations'),
      page(pages.executionCalibration, '/guide/execution-calibration'),
      page(pages.workflowSystem, '/guide/workflow-system'),
      page(pages.skillsSystem, '/guide/skills-system'),
      page(pages.moduleSystem, '/guide/module-system'),
      page(pages.updatingProjects, '/guide/updating-projects')
    ]),
    [prefixPath(locale, '/skills/')]: group(groups.skills, [
      page(pages.overview, '/skills/overview'),
      page(pages.coreSkills, '/skills/core-skills'),
      page(pages.toolSkills, '/skills/tool-skills'),
      page(pages.creatingSkills, '/skills/creating-skills')
    ]),
    [prefixPath(locale, '/features/')]: group(groups.features, [page(pages.rbac, '/features/rbac'), page(pages.yourTools, '/features/your-tools')]),
    [prefixPath(locale, '/modules/')]: group(groups.modules, [
      page(pages.email, '/modules/email'),
      page(pages.storage, '/modules/storage'),
      page(pages.analytics, '/modules/analytics'),
      page(pages.pwa, '/modules/pwa'),
      page('SRS', '/modules/srs')
    ]),
    [prefixPath(locale, '/srs/')]: group(groups.srs, [
      page(pages.moduleOverview, '/modules/srs'),
      page(pages.centralization, '/srs/centralization'),
      page(pages.lifecycle, '/srs/lifecycle'),
      page(pages.walkthrough, '/srs/walkthrough'),
      page(pages.scannerFindings, '/srs/scanner-findings')
    ]),
    [prefixPath(locale, '/workflow/')]: group(groups.workflow, [
      page(pages.introduction, '/workflow/introduction'),
      page(pages.sevenStatuses, '/workflow/7-status-system'),
      page(pages.complexity, '/workflow/complexity-system'),
      page(pages.aiRules, '/workflow/ai-rules'),
      page(pages.github, '/workflow/github-integration')
    ]),
    [prefixPath(locale, '/api/')]: group(groups.api, [
      page(pages.types, '/api/types'),
      page(pages.builders, '/api/builders'),
      page(pages.installers, '/api/installers'),
      page(pages.runners, '/api/runners')
    ])
  }
}

export const createThemeConfig = (locale: DocumentationLocale, translatedRoutes: string[] = ['/']): DefaultTheme.Config => {
  const { nav, interface: ui } = labels[locale]

  return {
    logo: '/icon.svg',
    nav: [
      { text: nav.guide, link: documentationLink(locale, '/guide/project-structure', translatedRoutes) },
      { text: nav.cli, link: documentationLink(locale, '/cli/sf-new', translatedRoutes) },
      { text: nav.skills, link: documentationLink(locale, '/skills/overview', translatedRoutes) },
      { text: nav.modules, link: documentationLink(locale, '/modules/email', translatedRoutes) },
      { text: nav.srs, link: documentationLink(locale, '/modules/srs', translatedRoutes) },
      {
        text: 'v1.0.0-beta',
        items: [
          { text: nav.changelog, link: documentationLink(locale, '/changelog', translatedRoutes) },
          { text: nav.contributing, link: documentationLink(locale, '/contributing/development', translatedRoutes) }
        ]
      },
      { component: 'LocaleSwitch', props: { locale, translatedRoutes } }
    ],
    sidebar: createSidebar(locale, translatedRoutes),
    outline: { label: ui.outline },
    docFooter: { prev: ui.previous, next: ui.next },
    darkModeSwitchLabel: ui.appearance,
    lightModeSwitchTitle: ui.lightMode,
    darkModeSwitchTitle: ui.darkMode,
    sidebarMenuLabel: ui.menu,
    returnToTopLabel: ui.returnToTop,
    langMenuLabel: ui.changeLanguage,
    skipToContentLabel: ui.skipToContent,
    i18nRouting: false,
    socialLinks: [{ icon: 'github', link: 'https://github.com/DiamondForgeFr/SaasFoundryAI' }],
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: ui.search, buttonAriaLabel: ui.search },
          modal: {
            noResultsText: ui.searchEmpty,
            resetButtonTitle: ui.searchReset,
            backButtonTitle: ui.searchBack
          }
        }
      }
    },
    footer: {
      message: ui.footerMessage,
      copyright: 'Copyright © 2026 DiamondForge'
    }
  }
}
