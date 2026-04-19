import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'SaaSFoundry',
  description: 'AI-First SaaS Platform Generator',
  base: '/SaaSFoundry/',
  ignoreDeadLinks: [/^https?:\/\/localhost/],

  vite: {
    server: {
      port: 5176
    }
  },

  themeConfig: {
    logo: '/icon.svg',

    nav: [
      { text: 'Guide', link: '/guide/project-structure' },
      { text: 'CLI', link: '/cli/sf-new' },
      { text: 'Skills', link: '/skills/overview' },
      { text: 'Modules', link: '/modules/email' },
      {
        text: 'v1.0.0-beta',
        items: [
          { text: 'Changelog', link: '/changelog' },
          { text: 'Contributing', link: '/contributing/development' }
        ]
      }
    ],

    sidebar: {
      '/getting-started/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Installation', link: '/getting-started/installation' },
            { text: 'Development Tools', link: '/getting-started/tools' },
            { text: 'Quick Start', link: '/getting-started/quick-start' },
            { text: 'First Project', link: '/getting-started/first-project' }
          ]
        }
      ],

      '/cli/': [
        {
          text: 'CLI Commands',
          items: [
            { text: 'sf new', link: '/cli/sf-new' },
            { text: 'sf update', link: '/cli/sf-update' },
            { text: 'sf modules', link: '/cli/sf-modules' },
            { text: 'sf skill', link: '/cli/sf-skill' },
            { text: 'sf feedback', link: '/cli/sf-feedback' },
            { text: 'sf tools', link: '/cli/sf-tools' },
            { text: 'sf workflow', link: '/cli/sf-workflow' },
            { text: 'sf uninstall', link: '/cli/sf-uninstall' }
          ]
        }
      ],

      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Project Structure', link: '/guide/project-structure' },
            { text: 'Monorepo vs Multirepo', link: '/guide/monorepo-vs-multirepo' },
            { text: 'Workflow System', link: '/guide/workflow-system' },
            { text: 'Skills System', link: '/guide/skills-system' },
            { text: 'Module System', link: '/guide/module-system' }
          ]
        }
      ],

      '/skills/': [
        {
          text: 'Skills',
          items: [
            { text: 'Overview', link: '/skills/overview' },
            { text: 'Core Skills', link: '/skills/core-skills' },
            { text: 'Tool Skills', link: '/skills/tool-skills' },
            { text: 'Creating Skills', link: '/skills/creating-skills' }
          ]
        }
      ],

      '/modules/': [
        {
          text: 'Modules',
          items: [
            { text: 'Email (MailerSend)', link: '/modules/email' },
            { text: 'Storage (S3)', link: '/modules/storage' },
            { text: 'Analytics (Umami)', link: '/modules/analytics' }
          ]
        }
      ],

      '/workflow/': [
        {
          text: 'Workflow System',
          items: [
            { text: 'Introduction', link: '/workflow/introduction' },
            { text: '7-Status System', link: '/workflow/7-status-system' },
            { text: 'Complexity System', link: '/workflow/complexity-system' },
            { text: 'AI Rules', link: '/workflow/ai-rules' },
            { text: 'GitHub Integration', link: '/workflow/github-integration' }
          ]
        }
      ],

      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Types', link: '/api/types' },
            { text: 'Builders', link: '/api/builders' },
            { text: 'Installers', link: '/api/installers' },
            { text: 'Runners', link: '/api/runners' }
          ]
        }
      ]
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/DiamondForgeFr/SaaSFoundry' }],

    search: {
      provider: 'local'
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 DiamondForge'
    }
  }
})
