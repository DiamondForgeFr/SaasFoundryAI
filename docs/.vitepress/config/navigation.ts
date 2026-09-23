import type { DefaultTheme } from 'vitepress'

export type DocumentationLocale = 'en' | 'fr'

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
      email: 'Email',
      storage: 'Storage',
      analytics: 'Analytics',
      pwa: 'Installable app (PWA)',
      moduleOverview: 'Module overview',
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
      email: 'E-mail',
      storage: 'Stockage',
      analytics: 'Analytics',
      pwa: 'Application installable (PWA)',
      moduleOverview: "Vue d'ensemble du module",
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

const item = (locale: DocumentationLocale, text: string, link: string): DefaultTheme.SidebarItem => ({
  text,
  link: prefixPath(locale, link)
})

const createSidebar = (locale: DocumentationLocale): DefaultTheme.Sidebar => {
  const { groups, pages } = labels[locale]
  const group = (text: string, items: DefaultTheme.SidebarItem[]): DefaultTheme.SidebarItem[] => [{ text, items }]

  return {
    [prefixPath(locale, '/getting-started/')]: group(groups.gettingStarted, [
      item(locale, pages.installation, '/getting-started/installation'),
      item(locale, pages.developmentTools, '/getting-started/tools'),
      item(locale, pages.quickStart, '/getting-started/quick-start'),
      item(locale, pages.firstProject, '/getting-started/first-project'),
      item(locale, pages.firstTicket, '/getting-started/shipping-first-ticket')
    ]),
    [prefixPath(locale, '/cli/')]: group(
      groups.cli,
      ['new', 'update', 'resume', 'status', 'agents', 'docs', 'modules', 'skill', 'srs', 'feedback', 'tools', 'workflow', 'uninstall'].map((command) =>
        item(locale, `sf ${command}`, `/cli/sf-${command}`)
      )
    ),
    [prefixPath(locale, '/guide/')]: group(groups.guide, [
      item(locale, pages.projectStructure, '/guide/project-structure'),
      item(locale, pages.topology, '/guide/monorepo-vs-multirepo'),
      item(locale, pages.agentCoexistence, '/guide/agent-coexistence'),
      item(locale, pages.hostCapabilities, '/guide/host-capabilities'),
      item(locale, pages.localProfiles, '/guide/local-execution-profiles'),
      item(locale, pages.localSetup, '/guide/local-execution-setup'),
      item(locale, pages.localQualification, '/guide/local-execution-qualification'),
      item(locale, pages.localRouting, '/guide/local-cloud-routing'),
      item(locale, pages.executionCandidates, '/guide/execution-candidates'),
      item(locale, pages.executionRequirements, '/guide/execution-requirements'),
      item(locale, pages.executionPlanning, '/guide/execution-planning'),
      item(locale, pages.executionBudgets, '/guide/execution-budgets'),
      item(locale, pages.executionReplanning, '/guide/execution-replanning'),
      item(locale, pages.executionExplanations, '/guide/execution-explanations'),
      item(locale, pages.executionCalibration, '/guide/execution-calibration'),
      item(locale, pages.workflowSystem, '/guide/workflow-system'),
      item(locale, pages.skillsSystem, '/guide/skills-system'),
      item(locale, pages.moduleSystem, '/guide/module-system'),
      item(locale, pages.updatingProjects, '/guide/updating-projects')
    ]),
    [prefixPath(locale, '/skills/')]: group(groups.skills, [
      item(locale, pages.overview, '/skills/overview'),
      item(locale, pages.coreSkills, '/skills/core-skills'),
      item(locale, pages.toolSkills, '/skills/tool-skills'),
      item(locale, pages.creatingSkills, '/skills/creating-skills')
    ]),
    [prefixPath(locale, '/modules/')]: group(groups.modules, [
      item(locale, pages.email, '/modules/email'),
      item(locale, pages.storage, '/modules/storage'),
      item(locale, pages.analytics, '/modules/analytics'),
      item(locale, pages.pwa, '/modules/pwa'),
      item(locale, 'SRS', '/modules/srs')
    ]),
    [prefixPath(locale, '/srs/')]: group(groups.srs, [
      item(locale, pages.moduleOverview, '/modules/srs'),
      item(locale, pages.lifecycle, '/srs/lifecycle'),
      item(locale, pages.walkthrough, '/srs/walkthrough'),
      item(locale, pages.scannerFindings, '/srs/scanner-findings')
    ]),
    [prefixPath(locale, '/workflow/')]: group(groups.workflow, [
      item(locale, pages.introduction, '/workflow/introduction'),
      item(locale, pages.sevenStatuses, '/workflow/7-status-system'),
      item(locale, pages.complexity, '/workflow/complexity-system'),
      item(locale, pages.aiRules, '/workflow/ai-rules'),
      item(locale, pages.github, '/workflow/github-integration')
    ]),
    [prefixPath(locale, '/api/')]: group(groups.api, [
      item(locale, pages.types, '/api/types'),
      item(locale, pages.builders, '/api/builders'),
      item(locale, pages.installers, '/api/installers'),
      item(locale, pages.runners, '/api/runners')
    ])
  }
}

export const createThemeConfig = (locale: DocumentationLocale, translatedRoutes: string[] = ['/']): DefaultTheme.Config => {
  const { nav, interface: ui } = labels[locale]

  return {
    logo: '/icon.svg',
    nav: [
      { text: nav.guide, link: prefixPath(locale, '/guide/project-structure') },
      { text: nav.cli, link: prefixPath(locale, '/cli/sf-new') },
      { text: nav.skills, link: prefixPath(locale, '/skills/overview') },
      { text: nav.modules, link: prefixPath(locale, '/modules/email') },
      { text: nav.srs, link: prefixPath(locale, '/modules/srs') },
      {
        text: 'v1.0.0-beta',
        items: [
          { text: nav.changelog, link: prefixPath(locale, '/changelog') },
          { text: nav.contributing, link: prefixPath(locale, '/contributing/development') }
        ]
      },
      { component: 'LocaleSwitch', props: { locale, translatedRoutes } }
    ],
    sidebar: createSidebar(locale),
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
